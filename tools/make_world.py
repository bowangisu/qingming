#!/usr/bin/env python3
"""Bake one of the scroll's scenes for the 3D view (world.html?scene=<name>) from a spec in life/world-<name>.json,
merged over life/world-common.json (the porter, the silk swatch, the strollers).

The painting is read as an oblique view of a small world: water at Y = 0, the land raised to the bank height, and a
point (X, Y, Z) painted at u = X + a*Z, v = c - s*Z - Y. The viewer projects the painting itself back onto the river
and the banks, so the ground needs no texture of its own, only masks saying where the painting shows open water and
where it shows land, and blank water and blank silk for the rest: the swatches here, in the tone of the painting
around them. A scene without a river is all land. The Rainbow Bridge is designed rather than traced, and its faces
are painted by stretching the painted bridge between its own curves: the railing along the painted rail, the face
between the painted deck line and the arch.
Writes assets/world/<name>/: paint-0.webp and paint-1.webp (the region's two halves), masks.webp, tone.png, silk.webp,
water.webp (with a river), bridge-face.webp, bridge-soffit.webp, bridge-deck.webp (with the bridge), the porter's
pieces, the strollers, sprites.webp, scene.json; and a preview of the masks in tools/.
Usage: python3 tools/make_world.py life/world-bridge.json source/Alongtheriver_QingMing.jpg assets/world/bridge
"""
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from make_life import brushwork, fill_holes                        # noqa: E402  (the moving layer's ink detection)
import world_models as WM                                          # noqa: E402

Image.MAX_IMAGE_PIXELS = None
QUALITY = 88
MASK = 2            # the masks are kept at 1/2 of the painting
TONE = 8            # the tone of the painting under the fills, at 1/8
DENSE = .42         # brushwork density (blurred) above which the painting shows a thing rather than open water
HALO = 6            # px of silk kept round the brushwork for cut kind "halo"


def _box(a, k, axis):
    """running mean of width 2k+1 along axis, edges clamped"""
    pad = [(0, 0)] * a.ndim; pad[axis] = (k + 1, k)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis, dtype=np.float64)
    hi = [slice(None)] * a.ndim; lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * k + 1, None); lo[axis] = slice(0, -(2 * k + 1))
    return ((c[tuple(hi)] - c[tuple(lo)]) / (2 * k + 1)).astype(np.float32)


def blur(a, r):
    """about a Gaussian of radius r: three box passes each way"""
    k = max(1, round(r * .9))
    a = a.astype(np.float32)
    for _ in range(3): a = _box(_box(a, k, 0), k, 1)
    return a


def grow(a, px):
    """dilate a 0/1 mask by about px, in steps of at least 3 px (Pillow's rank filter can't take a 1 px one)"""
    img = Image.fromarray((a > .5).astype(np.uint8) * 255)
    while px > 0:
        k = min(px, 7) if px != 8 else 4
        k = max(k, 2); img = img.filter(ImageFilter.MaxFilter(2 * (k // 2) + 1)); px -= k
    return np.asarray(img, np.float32) / 255


def poly_mask(size, poly, origin):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon([(x - origin[0], y - origin[1]) for x, y in poly], fill=255)
    return np.asarray(m, np.float32) / 255


def cut(master, box, kind, halo=HALO):
    """the brushwork in box as a 0..1 mask: fill, ink, or halo (ink grown by halo px, what that encloses filled in,
    soft at its edge)"""
    if kind == 'halo':
        ink = np.asarray(brushwork(master, tuple(box), 'ink'), np.float32) / 255
        solid = np.asarray(fill_holes(Image.fromarray((grow(ink, halo) > .5).astype(np.uint8) * 255)), np.float32) / 255
        return np.clip(blur(solid, halo * .4) * 1.3, 0, 1)
    return np.asarray(brushwork(master, tuple(box), kind), np.float32) / 255


def line_alpha(master, box, lo=7, hi=26):
    """the brushwork in box as a continuous 0..1 alpha: how much darker than the silk around it each pixel is, so a
    stroke keeps its own soft edge and thin lines stay whole (for trees and lattices cut along their strokes)"""
    grey = master.crop(tuple(box)).convert('L')
    half = grey.resize((max(1, grey.width // 2), max(1, grey.height // 2)), Image.BOX)
    silk = np.asarray(half.filter(ImageFilter.MedianFilter(13)).resize(grey.size, Image.BILINEAR), np.float32)
    silk = blur(silk, 6)
    d = silk - blur(np.asarray(grey, np.float32), .7)
    a = np.clip((d - lo) / (hi - lo), 0, 1)
    return np.clip(np.maximum(a, blur(a, 1.2) * 1.25), 0, 1)


def save(rgb, path, alpha=None, q=QUALITY):
    px = np.clip(rgb, 0, 255).astype(np.uint8)
    if alpha is not None: px = np.dstack([px, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(px).save(path, quality=q, method=6) if str(path).endswith('.webp') else Image.fromarray(px).save(path, optimize=True)


def shrink(a, f):
    H, W = a.shape[:2]
    return a[:H - H % f, :W - W % f].reshape(H // f, f, W // f, f, *a.shape[2:]).mean((1, 3))


def fill_from(img, known):
    """img (H, W, 3) where known (0..1) is 1, carried smoothly into the rest (push-pull, coarse levels averaging the
    known pixels; cells with none at all take the overall mean)"""
    k = known.astype(np.float32)
    mean = (img * k[..., None]).sum((0, 1)) / max(k.sum(), 1)
    cols, alphas = [img * k[..., None]], [k]
    while min(alphas[-1].shape) > 2:
        c, a = cols[-1], alphas[-1]
        H, W = a.shape; H2, W2 = (H + 1) // 2, (W + 1) // 2
        cp = np.pad(c, ((0, H2 * 2 - H), (0, W2 * 2 - W), (0, 0)), mode='edge')
        ap = np.pad(a, ((0, H2 * 2 - H), (0, W2 * 2 - W)), mode='edge')
        cols.append(cp[0::2, 0::2] + cp[1::2, 0::2] + cp[0::2, 1::2] + cp[1::2, 1::2])
        alphas.append(ap[0::2, 0::2] + ap[1::2, 0::2] + ap[0::2, 1::2] + ap[1::2, 1::2])
    est = np.where(alphas[-1][..., None] > 0, cols[-1] / np.maximum(alphas[-1], 1e-6)[..., None], mean)
    for c, a in zip(reversed(cols[:-1]), reversed(alphas[:-1])):
        H, W = a.shape
        up = np.repeat(np.repeat(est, 2, 0), 2, 1)[:H, :W]
        up = np.stack([blur(up[..., i], 1) for i in range(3)], -1)
        avg = c / np.maximum(a, 1e-6)[..., None]
        w = np.clip(a, 0, 1)[..., None]
        est = avg * w + up * (1 - w)
    return est


def bilinear(img, u, v):
    """sample img (H, W, 3) at float pixel coords u, v (any shape), edges clamped"""
    H, W = img.shape[:2]
    u = np.clip(u, 0, W - 1.001); v = np.clip(v, 0, H - 1.001)
    x0 = u.astype(int); y0 = v.astype(int); fx = (u - x0)[..., None]; fy = (v - y0)[..., None]
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def flat_ratio(master, box):
    """a patch of the scan, mirrored to tile seamlessly, as a ratio to its own smoothed colour: texture without shading"""
    p = np.asarray(master.crop(tuple(box)).convert('RGB'), np.float32)
    p = p / np.stack([blur(p[..., c], 24) for c in range(3)], -1)
    top = np.concatenate([p, p[:, ::-1]], 1)
    return np.concatenate([top, top[::-1]], 0)


def arclen(pts):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    return d / d[-1]


def along(pts, t):
    """points at normalized arc length t along the polyline pts"""
    pts = np.asarray(pts, np.float64); s = arclen(pts)
    return np.stack([np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])], -1)


def smooth_line(pts, n=400):
    """the polyline through pts, resampled finely and eased (a few passes of averaging) so its corners don't show"""
    p = along(pts, np.linspace(0, 1, n))
    for _ in range(6): p[1:-1] = (p[:-2] + 2 * p[1:-1] + p[2:]) / 4
    return p


class Bridge:
    """the designed bridge: arc-length stations along the chord, deck, arch and rail heights"""
    def __init__(self, B, bank):
        (ax, az), (bx, bz) = B['feet']
        self.L = math.hypot(bx - ax, bz - az)
        self.bank, self.rise, self.sof, self.rail = bank, B['rise'], B['soffit'], B['rail']
        self.dp, self.sp = B['deck_power'], B['soffit_power']
        s = np.linspace(0, self.L, 2001)
        self.ss = s
        self.tD = arclen(np.stack([s, self.deck(s)], -1))     # normalized arc length of the deck, of the arch
        self.tS = arclen(np.stack([s, self.soffit(s)], -1))

    def deck(self, s):
        return self.bank + self.rise * np.sin(np.pi * np.clip(s / self.L, 0, 1)) ** self.dp

    def soffit(self, s):
        return self.sof * np.sin(np.pi * np.clip(s / self.L, 0, 1)) ** self.sp

    def t_deck(self, s): return np.interp(s, self.ss, self.tD)
    def t_soffit(self, s): return np.interp(s, self.ss, self.tS)


def bridge_textures(spec, master, out, silk_tone):
    B = spec['bridge']; P = B['paint']; br = Bridge(B, spec['bank'])
    # the painted bridge, cropped with a margin, and its curves in that crop's pixels
    xs = [p[0] for p in P['rail'] + P['soffit']]; ys = [p[1] for p in P['rail'] + P['soffit']]
    box = (int(min(xs)) - 140, int(min(ys)) - 60, int(max(xs)) + 60, int(max(ys)) + 140)
    img = np.asarray(master.crop(box).convert('RGB'), np.float32)
    o = np.array(box[:2], np.float64)
    rail = smooth_line(P['rail']) - o
    deckl = rail + [0, P['deck_drop']]
    sof = smooth_line(P['soffit']) - o

    # the face, in (station, height): the railing above the deck, the face between the deck and the arch below it.
    # The right end of the painted bridge is hidden behind the boat's mast and ropes, so it is painted with the left
    # end, mirrored, blending in over the last stretch.
    W = int(math.ceil(br.L)); Hh = int(math.ceil(br.bank + br.rise + br.rail + 2))
    s = (np.arange(W) + .5)[None, :].repeat(Hh, 0); y = (Hh - 1 - np.arange(Hh) + .5)[:, None].repeat(W, 1)
    dk, sf = br.deck(s), br.soffit(s)

    def paint_at(tD, tS):
        R = along(rail, tD); D = along(deckl, tD); S = along(sof, tS)
        f_rail = np.clip((y - dk) / br.rail, 0, 1)[..., None]
        f_face = np.clip((y - sf) / np.maximum(dk - sf, 1), 0, 1)[..., None]
        p = np.where((y >= dk)[..., None], D + (R - D) * f_rail, S + (D - S) * f_face)
        return bilinear(img, p[..., 0], p[..., 1])

    tD, tS = br.t_deck(s), br.t_soffit(s)
    col = paint_at(tD, tS)
    w = np.clip((tD - .8) / .12, 0, 1); w = (w * w * (3 - 2 * w))[..., None]
    col = col * (1 - w) + paint_at(1 - tD, 1 - tS) * w
    inside = (y <= dk + br.rail) & (y >= sf)
    alpha = np.clip(np.minimum(dk + br.rail - y, y - sf) + .5, 0, 1) * inside
    save(col, out / 'bridge-face.webp', alpha)

    # the arch's underside: the rafters painted under the middle of the arch, mirrored so they repeat twice along it
    U = P['underside']; depth = U['depth']
    nW, nD = 1400, 120
    t = np.linspace(0, 1, nW)[None, :].repeat(nD, 0); d = np.linspace(0, 1, nD)[:, None].repeat(nW, 1)
    tt = 1 - np.abs(1 - 2 * t)                                   # 0..1..0: mirrored once in the middle
    tau = U['from'] + (U['to'] - U['from']) * tt
    S0 = along(sof, tau); S1 = along(sof, np.clip(tau + .004, 0, 1))
    tg = S1 - S0; tg /= np.maximum(np.hypot(tg[..., 0], tg[..., 1]), 1e-6)[..., None]
    nrm = np.stack([-tg[..., 1], tg[..., 0]], -1)                # pointing into the arch (down, on the screen)
    nrm *= np.where(nrm[..., 1:2] < 0, -1, 1)
    p = S0 + nrm * (6 + d[..., None] * depth)
    save(bilinear(img, p[..., 0], p[..., 1]), out / 'bridge-soffit.webp')

    # the deck: planks across, in the tone of the painted timber, on the silk's weave
    ratio = flat_ratio(master, spec['swatch']['silk'])
    tone = np.asarray(silk_tone, np.float32) * .97                 # planks of the silk's own tone, so cut-outs sit on it
    dw, dh = 512, 256
    rr = np.tile(ratio, (dh // ratio.shape[0] + 1, dw // ratio.shape[1] + 1, 1))[:dh, :dw]
    deck = rr * tone
    rng = np.random.default_rng(7)
    ink = np.array([62, 50, 38], np.float32)
    X = np.arange(dw)[None, :].repeat(dh, 0).astype(np.float32); Y = np.arange(dh)[:, None].repeat(dw, 1).astype(np.float32)
    lines = np.zeros((dh, dw), np.float32)
    for x0 in np.arange(0, dw, 16):
        wob = x0 + rng.uniform(-1, 1) + 1.2 * np.sin(Y / rng.uniform(30, 60) + rng.uniform(0, 6))
        strength = rng.uniform(.18, .34) * (np.sin(Y / rng.uniform(18, 40) + rng.uniform(0, 6)) * .3 + .7)
        lines = np.maximum(lines, np.clip(1.1 - np.abs(X - wob), 0, 1) * strength)
    for y0 in (7, dh - 8):
        lines = np.maximum(lines, np.clip(1.4 - np.abs(Y - y0), 0, 1) * .45)
    deck = deck * (1 - lines[..., None]) + ink * lines[..., None]
    save(deck, out / 'bridge-deck.webp')
    return {'L': br.L, 'face': {'file': 'bridge-face.webp', 'size': [W, Hh]}, 'soffit_tex': {'file': 'bridge-soffit.webp', 'size': [nW, nD]},
            'deck_tex': {'file': 'bridge-deck.webp', 'size': [dw, dh]}, 'tone': [round(float(v), 1) for v in tone]}


def retone(col, alpha, target):
    """scale a cut-out's colours so the silk around it matches the scene's silk: its pale margin then disappears
    into whatever silk-toned ground it stands on"""
    around = col[alpha < .3]
    if len(around) < 20: return col
    k = np.clip(np.asarray(target, np.float32) / np.maximum(np.median(around, 0), 1), .8, 1.25)
    return col * k


def cutout(master, poly, kind, target, feather=1.5):
    box = [int(min(p[0] for p in poly)) - 3, int(min(p[1] for p in poly)) - 3, int(max(p[0] for p in poly)) + 3, int(max(p[1] for p in poly)) + 3]
    bw, bh = box[2] - box[0], box[3] - box[1]
    a = np.clip(blur(poly_mask((bw, bh), poly, box), feather), 0, 1)
    if kind != 'shape': a = np.clip(a * cut(master, box, kind), 0, 1)
    col = np.asarray(master.crop(tuple(box)).convert('RGB'), np.float32)
    return retone(col, a, target), a, box


def pack(sprites, width=2048, pad=3):
    """shelf-pack RGBA sprites (dict id -> (H, W, 4) uint8) into one atlas; returns the atlas and id -> [x0, y0, x1, y1]"""
    order = sorted(sprites, key=lambda k: -sprites[k].shape[0])
    x = y = shelf = 0; place = {}
    for k in order:
        h, w = sprites[k].shape[:2]
        if x + w + pad > width: x, y, shelf = 0, y + shelf + pad, 0
        place[k] = [x, y, x + w, y + h]; x += w + pad; shelf = max(shelf, h)
    H = y + shelf + pad
    atlas = np.zeros((H, width, 4), np.uint8)
    for k, (x0, y0, x1, y1) in place.items(): atlas[y0:y1, x0:x1] = sprites[k]
    return atlas, place


def person_cell(us, vs, uh, vh, bottom, k=1.0):
    """a standing figure's rough shape below its head centre (uh, vh): the head, widening to the shoulders, a body
    down to the row bottom (per column). k scales it: painted size (figures near the painter are drawn bigger), and
    width for a porter's pole and baskets"""
    kh, kw = k if isinstance(k, tuple) else (k, k)
    d = (vs - vh) / kh
    head = np.sqrt(np.clip(11 ** 2 - np.clip(d + 2, None, 0) ** 2 * .75, 0, None)) * kh   # rounded on top
    hw = np.where(d < 6, head, (np.minimum(10 + (d - 6) * .8, 17) + np.clip(d - 20, 0, None) * .05) * kw)
    return (d >= -14) & (vs <= bottom) & (np.abs(us - uh) <= np.minimum(hw, 19 * kw))


def robe(C, A, cu, ratio, rng):
    """carry a figure's robe down where the painting hides it (behind the railing, behind people in front): from the
    lowest painted row of each column to the sprite's bottom, in the colour just above, narrowing a little, with a
    hem, two folds and a pair of shoes drawn in the painting's ink"""
    h, w = A.shape
    vis = A > .35
    rows = np.where(vis.any(1))[0]
    if not len(rows): return C, A
    # the robe is as wide as the body is, on average, over the lower part of what is painted
    lo = rows.min() + int((rows.max() - rows.min()) * .35)
    ls, rs = [], []
    for y in range(lo, rows.max() + 1):
        c = np.where(vis[y])[0]
        if len(c) > 3: ls.append(c.min()); rs.append(c.max())
    left, right = (int(np.percentile(ls, 40)), int(np.percentile(rs, 60))) if ls else (cu - 10, cu + 10)
    left, right = max(left, cu - 16), min(right, cu + 16)
    if right - left < 16: left, right = min(left, cu - 8), max(right, cu + 8)
    tone = np.median(C[vis][-60:], 0) if vis.sum() > 10 else np.array([150, 125, 95], np.float32)
    ink = np.array([60, 48, 38], np.float32)
    e = np.array([np.where(vis[:, j])[0].max() if vis[:, j].any() else -1 for j in range(w)])
    start = int(np.median(e[left:right + 1][e[left:right + 1] >= 0])) if (e[left:right + 1] >= 0).any() else rows.max()
    if start >= h - 4: return C, A
    rr = np.tile(ratio, (h // ratio.shape[0] + 1, w // ratio.shape[1] + 1, 1))[:h, :w]
    for y in range(max(0, start - 2), h):
        k = (y - start) / max(1, h - start)
        l = left + (cu - left) * .12 * k; r = right - (right - cu) * .12 * k
        for j in range(int(np.floor(l)) - 1, int(np.ceil(r)) + 2):
            if j < 0 or j >= w or vis[y, j]: continue
            cover = np.clip(min(j - l + 1, r - j + 1), 0, 1)
            if cover <= 0: continue
            above = C[max(0, e[j] - 4):e[j] + 1, j].mean(0) if e[j] >= 0 and e[j] < y else tone
            col = (above * .5 + tone * .5) * rr[y, j] * (1 - .1 * k)
            line = 0.
            if abs(j - l) < 1.2 or abs(j - r) < 1.2: line = .5
            for f in (.36, .66):
                if abs(j - (l + (r - l) * f + 1.2 * np.sin(y * .3 + f * 9))) < .7: line = max(line, .22)
            if h - 6 <= y <= h - 5: line = max(line, .5)
            if y >= h - 3 and (abs(j - (cu - 4)) < 3 or abs(j - (cu + 4)) < 3): line = .8
            col = col * (1 - line) + ink * line
            a = max(A[y, j], cover)
            C[y, j] = (C[y, j] * A[y, j] + col * (a - A[y, j])) / max(a, 1e-3); A[y, j] = a
    return C, A


def stand_people(spec, master, silk_tone, br):
    """The painted people, stood up. Each group lists head centres (master px); each figure is cut along its own
    brushwork inside a rough figure shape below its head, the nearer figure taking whatever two figures share, and
    its robes are carried down to its feet where the painting hides them. On the deck, a figure stands behind the
    front railing, as far back across the deck as it is painted above the rail; on a bank, at its painted feet.
    Returns sprites, where each stands, and a mask (region px) of what was taken off the ground."""
    R = spec['region']; m = spec['map']
    if br is not None:
        Bd = spec['bridge']
        rail = smooth_line(Bd['paint']['rail'], 800)
        total = np.r_[0, np.cumsum(np.hypot(*np.diff(rail, axis=0).T))]; total /= total[-1]
        (ax, az), (bx, bz) = Bd['feet']; L = math.hypot(bx - ax, bz - az)
        nx, nz = (bz - az) / L, -(bx - ax) / L
        # how the painting shows a step back across the deck (to the far railing): up and to the left
        du, dv = -nx * Bd['width'] + m['a'] * -nz * Bd['width'], -m['s'] * -nz * Bd['width']
    ratio = flat_ratio(master, spec['swatch']['silk'])
    rng = np.random.default_rng(3)
    taken = np.zeros((R[3] - R[1], R[2] - R[0]), np.float32)
    out = []
    for G in spec['people']:
        x0, y0, x1, y1 = G['box']
        col = np.asarray(master.crop((x0, y0, x1, y1)).convert('RGB'), np.float32)
        halo = cut(master, (x0, y0, x1, y1), 'halo', G.get('halo', 4))
        H, Wd = halo.shape
        us = np.arange(x0, x1)[None, :].repeat(H, 0).astype(np.float32); vs = np.arange(y0, y1)[:, None].repeat(Wd, 1).astype(np.float32)
        tall = G.get('tall', 82)
        figs = []
        for hd in G['heads']:
            uh, vh = hd[0], hd[1]
            if G['on'] == 'deck':
                vr = float(np.interp(uh, rail[:, 0], rail[:, 1]))
                wf = hd[2] if len(hd) > 2 else float(np.clip((vr - vh - 50) / 62, .04, .9))
                foot = vr + Bd['rail'] + dv * wf
                bottom = np.minimum(np.interp(us[0], rail[:, 0], rail[:, 1]) + 1, foot)[None, :]
                tau = float(np.interp(uh - du * wf, rail[:, 0], total))
                where = {'on': 'deck', 's': round(float(np.interp(tau, br.tD, br.ss)), 1), 'w': round(wf, 3)}
                near = -wf
            else:
                foot = vh + (hd[2] if len(hd) > 2 else tall)
                bottom = np.full((1, Wd), foot + 2)
                gy = G.get('y', spec['bank'])                           # what they stand on: the bank, or a boat's deck
                Z = (m['c'] - foot - gy) / m['s']
                where = {'on': 'bank', 'p': [round(uh - m['a'] * Z, 1), gy, round(Z, 1)]}
                near = foot
            scale = (foot - vh) / 82 if G['on'] != 'deck' else 1.0                 # this figure's painted size
            wide = hd[3] if len(hd) > 3 else 1.0
            figs.append((near, uh, vh, foot, bottom, where, (max(1.0, scale), max(1.0, scale) * wide)))
        owner = np.full((H, Wd), -1, np.int32)
        for i in sorted(range(len(figs)), key=lambda i: -figs[i][0]):
            _, uh, vh, foot, bottom, _, k = figs[i]
            cell = person_cell(us, vs, uh, vh, bottom, k)
            owner[cell & (owner < 0)] = i
        for i, (_, uh, vh, foot, bottom, where, k) in enumerate(figs):
            own = blur((owner == i).astype(np.float32), 1.6)            # rounded where two figures meet
            a = np.clip(blur(own * halo, 1.0) * 1.1, 0, 1) * np.clip(own * 1.6, 0, 1)
            top = int(vh - 15 * k[0] - y0); bot = int(round(foot - y0)) + 1
            l = int(uh - 26 * k[1] - x0); r = int(uh + 27 * k[1] - x0)
            A = np.zeros((bot - top, r - l), np.float32); C = np.zeros((bot - top, r - l, 3), np.float32)
            sy0, sy1 = max(0, top), min(H, bot); sx0, sx1 = max(0, l), min(Wd, r)
            A[sy0 - top:sy1 - top, sx0 - l:sx1 - l] = a[sy0:sy1, sx0:sx1]
            C[sy0 - top:sy1 - top, sx0 - l:sx1 - l] = col[sy0:sy1, sx0:sx1]
            if A.sum() < 60: continue
            gy0, gx0 = y0 - R[1], x0 - R[0]
            taken[gy0 + sy0:gy0 + sy1, gx0 + sx0:gx0 + sx1] = np.maximum(taken[gy0 + sy0:gy0 + sy1, gx0 + sx0:gx0 + sx1], a[sy0:sy1, sx0:sx1])
            C = retone(C, A, silk_tone)
            if G['on'] == 'deck' or G.get('robes'):
                C, A = robe(C, A, int(uh - x0 - l), ratio, rng)
            # trim empty columns, keeping the feet's column as the anchor
            cols = np.where(A.max(0) > .02)[0]
            c0, c1 = cols.min(), cols.max() + 1
            out.append({'rgba': np.dstack([np.clip(C[:, c0:c1], 0, 255), np.clip(A[:, c0:c1], 0, 1) * 255]).astype(np.uint8),
                        'anchor': round(float(uh - x0 - l - c0), 1), 'group': G['id'], 'u': uh, **where})
    return out, taken


def strip(o):
    """a spec's value without its notes"""
    if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k != 'about'}
    if isinstance(o, list): return [strip(v) for v in o]
    return o


BUILD = {'traced': WM.traced, 'house': WM.house, 'awning': WM.awning, 'table': WM.awning, 'umbrella': WM.umbrella, 'block': WM.block}


def load_spec(path):
    """a scene's spec over the common one: its own keys win, its swatches join the common ones"""
    spec = json.loads(Path(path).read_text())
    common = json.loads((Path(path).parent / 'world-common.json').read_text())
    out = {**{k: v for k, v in common.items() if k != 'about'}, **spec}
    out['swatch'] = {**common.get('swatch', {}), **spec.get('swatch', {})}
    return out


def ground_at(m, bank, u, v):
    """the world (X, Z) of the ground point painted at (u, v)"""
    z = (m['c'] - v - bank) / m['s']
    return [round(u - m['a'] * z, 1), round(z, 1)]


def main(spec_path, master_path, out_dir):
    spec = load_spec(spec_path)
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    master = Image.open(master_path)
    R = spec['region']; W, H = R[2] - R[0], R[3] - R[1]
    rgb = np.asarray(master.crop(tuple(R)).convert('RGB'), np.float32)
    half = W // 2                                   # two textures, so each stays within what phones can hold
    save(rgb[:, :half], out / 'paint-0.webp'); save(rgb[:, half:], out / 'paint-1.webp')

    # where the painting shows open water: inside the river's outline, away from dense brushwork, and not under
    # anything rebuilt in 3D; where it shows land: outside the outline and not under anything rebuilt
    ink = np.asarray(brushwork(master, tuple(R), 'ink'), np.float32) / 255
    dense = blur(ink, 14)
    river = poly_mask((W, H), spec['water_paint']['poly'], R) if 'water_paint' in spec else np.zeros((H, W), np.float32)
    rebuilt = np.zeros((H, W), np.float32)
    for key in ('bridge', 'boat'):
        if key in spec and 'poly' in spec[key]: rebuilt = np.maximum(rebuilt, poly_mask((W, H), spec[key]['poly'], R))
    for Bt in spec.get('boats', []):          # a boat's painted outline: its waterline, and its gunwale raised by the cabin
        C = Bt.get('cabin'); u0, u1 = Bt['waterline'][0][0], Bt['waterline'][-1][0]
        top = [[u, v - ((C['wall'] + C['arch'] + 4) if C and C['from'] - .02 <= (u - u0) / (u1 - u0) <= C['to'] + .02 else 4)] for u, v in Bt['gunwale']]
        rebuilt = np.maximum(rebuilt, poly_mask((W, H), top + Bt['waterline'][::-1], R))
    for fig in spec.get('figures', []):
        rebuilt = np.maximum(rebuilt, poly_mask((W, H), fig['poly'], R) if 'poly' in fig else 0)
    rebuilt = grow(rebuilt, 6)

    # houses, sheds, awnings and umbrellas rebuilt as models: what they covered comes off the ground
    Wd = WM.World(spec['map']['a'], spec['map']['s'], spec['map']['c'], spec['bank'])
    models = []
    for Md in spec.get('models', []):
        built = BUILD[Md['type']](Wd, Md)
        for k, M in enumerate(built if isinstance(built, list) else [built]):     # a block through which a passage runs is two
            models.append(M.export(Wd, Md['id'] + ('-back' if k else ''), kind=Md['type'], **({'open': True} if Md.get('posts') or Md.get('open') else {}),
                                   **({'cull': True} if Md['type'] == 'block' else {})))
            if M.idx: rebuilt = np.maximum(rebuilt, grow((M.outline(Wd, (W, H), R) > .5).astype(np.float32), 3))

    # the painted people, stood up: what they covered comes off the ground too
    silk_tone = np.median(rgb[((1 - river) * (dense < .15) * (np.arange(H)[:, None] > 22)) > .5], 0)
    sprites, placed = {}, []
    if 'people' in spec:
        people, taken = stand_people(spec, master, silk_tone, Bridge(spec['bridge'], spec['bank']) if 'bridge' in spec else None)
        for k, d in enumerate(people):
            key = f"{d['group']}-{k}"; sprites[key] = d.pop('rgba')
            placed.append({'sprite': key, **d})
        rebuilt = np.maximum(rebuilt, grow((taken > .2).astype(np.float32), 3))
    # trees, stood up as cut-outs of their brushwork, at their trunk's foot
    trees = []
    for T in spec.get('trees', []) + spec.get('standees', []):
        xs = [p[0] for p in T['poly']]; ys = [p[1] for p in T['poly']]
        box = [max(R[0], int(min(xs))), max(R[1] + 22, int(min(ys))), min(R[2], int(max(xs))), min(R[3], int(max(ys)))]
        bw, bh = box[2] - box[0], box[3] - box[1]
        k = T.get('kind', 'halo')
        inner = {'halo': lambda: cut(master, box, 'halo', T.get('halo', 3)), 'ink': lambda: line_alpha(master, box)}[k]()
        a = np.clip(blur(poly_mask((bw, bh), T['poly'], box), 2) * inner, 0, 1)
        a *= np.clip((T['foot'][1] - (np.arange(bh)[:, None] + box[1])) / 4 + .5, 0, 1)        # nothing below the foot
        col = retone(np.asarray(master.crop(tuple(box)).convert('RGB'), np.float32), a, silk_tone)
        key = f"tree-{T['id']}"; sprites[key] = np.dstack([np.clip(col, 0, 255), a * 255]).astype(np.uint8)
        gy = T.get('y', spec['bank']); Z = (spec['map']['c'] - T['foot'][1] - gy) / spec['map']['s']
        if 'wheel' in T:                       # a cart's wheel, cut as a disc of its own so it can turn
            (wu, wv), wr = T['wheel']['at'], T['wheel']['r']
            wb = (int(wu - wr - 3), int(wv - wr - 3), int(wu + wr + 4), int(wv + wr + 4))
            yy, xx = np.mgrid[wb[1]:wb[3], wb[0]:wb[2]]
            wa = np.clip((wr + 1.5 - np.hypot(xx + .5 - wu, yy + .5 - wv)) / 2.5, 0, 1)
            wc = retone(np.asarray(master.crop(wb).convert('RGB'), np.float32), wa, silk_tone)
            sprites[f"wheel-{T['id']}"] = np.dstack([np.clip(wc, 0, 255), wa * 255]).astype(np.uint8)
        trees.append({'id': T['id'], 'sprite': key, 'anchor': [T['foot'][0] - box[0], T['foot'][1] - box[1]], 'sway': T.get('sway', 0), 'bob': T.get('bob', 0),
                      **({'fixed': True} if T.get('fixed') else {}),
                      **({'wheel': {'sprite': f"wheel-{T['id']}", 'at': [T['wheel']['at'][0] - T['foot'][0], T['foot'][1] - T['wheel']['at'][1]], 'r': T['wheel']['r']}} if 'wheel' in T else {}),
                      'p': [round(T['foot'][0] - spec['map']['a'] * Z, 1), gy, round(Z, 1)]})
        g = np.zeros((H, W), np.float32); g[box[1] - R[1]:box[3] - R[1], box[0] - R[0]:box[2] - R[0]] = a
        rebuilt = np.maximum(rebuilt, grow((g > .3).astype(np.float32), 3))
    thing = grow((dense > DENSE).astype(np.float32), 8)
    water = river * (1 - thing) * (1 - rebuilt)
    land = (1 - river) * (1 - rebuilt) * (np.arange(H)[:, None] > 22)      # not the scan's pale top edge
    water_s, land_s = np.clip(blur(water, 3), 0, 1), np.clip(blur(land, 3), 0, 1)
    busy = np.clip((dense - .12) / .25, 0, 1)                        # how much a stretch of land is a thing standing up
    m = np.dstack([shrink(water_s, MASK), shrink(land_s, MASK), np.zeros((H // MASK, W // MASK)), shrink(busy, MASK)])
    px = (np.clip(m, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(px, 'RGBA').save(out / 'masks.webp', lossless=True, method=6)

    # the tone under the fills: the painting's own colour, carried in from the water and the land nearby
    small = shrink(rgb, TONE)
    tl = fill_from(small, shrink(land * (1 - busy), TONE) > .9)
    tw = fill_from(small, shrink(water, TONE) > .9) if water.sum() > 100 else tl
    soft = lambda t: np.stack([blur(t[..., i], 2.5) for i in range(3)], -1)    # tone only: no brushwork in it
    save(np.concatenate([soft(tw), soft(tl)], 0), out / 'tone.png')

    silk = flat_ratio(master, spec['swatch']['silk'])
    # ratios around 1 are stored around 128 (x 0.5), so the shader reads them back with a * 2
    save(silk * 128, out / 'silk.webp')
    scene = {'map': spec['map'], 'region': R, 'bank': spec['bank'],
             'paint': {'files': ['paint-0.webp', 'paint-1.webp'], 'size': [W, H]}, 'masks': {'file': 'masks.webp', 'scale': MASK},
             'tone': {'file': 'tone.png', 'scale': TONE}, 'silk': {'file': 'silk.webp', 'size': list(silk.shape[1::-1]), 'tone': [round(float(v), 1) for v in silk_tone]}}
    if 'river' in spec:
        wat = flat_ratio(master, spec['swatch']['water']); save(wat * 128, out / 'water.webp')
        water_tone = np.median(rgb[water > .5], 0)
        scene['river'] = spec['river']['poly']
        scene['water'] = {'file': 'water.webp', 'size': list(wat.shape[1::-1]), 'tone': [round(float(v), 1) for v in water_tone]}
    b = None
    if 'bridge' in spec:
        b = bridge_textures(spec, master, out, silk_tone)
        scene['bridge'] = {k: spec['bridge'][k] for k in ('feet', 'width', 'rise', 'soffit', 'rail', 'deck_power', 'soffit_power')} | b
    # the page round the view, where the view opens, where the porter may go, the notes, the sounds: as written
    for k in ('page', 'home', 'walk', 'pois', 'sound', 'drama', 'decks', 'nogo'):
        if k in spec: scene[k] = strip(spec[k])

    # the porter, in pieces (body, swinging baskets) at full resolution
    Wk = spec['walker']; pieces = []
    for Pc in Wk['pieces']:
        col, mm, box = cutout(master, Pc['poly'], Pc['kind'], silk_tone)
        save(col, out / f"walker-{Pc['id']}.png", alpha=mm)
        pieces.append({'id': Pc['id'], 'file': f"walker-{Pc['id']}.png", 'box': box, **({'pivot': Pc['pivot']} if 'pivot' in Pc else {})})
    scene['walker'] = {'height': Wk['height'], 'feet': Wk['feet'], 'pieces': pieces}

    # people from elsewhere on the scroll, to cross the bridge or walk the streets: cut along a traced outline, feet
    # at the bottom
    crowd = []
    for C in spec.get('crowd', []) if 'bridge' in spec or 'strollers' in spec else []:
        col, a, box = cutout(master, C['poly'], 'shape', silk_tone, 1.6)
        save(col, out / f"crowd-{C['id']}.png", alpha=a)
        ys = [p[1] for p in C['poly']]; xs = [p[0] for p in C['poly']]
        crowd.append({'id': C['id'], 'file': f"crowd-{C['id']}.png", 'box': box, 'feet': [round((min(xs) + max(xs)) / 2), max(ys)], 'top': min(ys),
                      'faces': C.get('faces', 'left')})
    scene['crowd'] = {'height': spec.get('crowd_height', 52), 'people': crowd}
    if 'strollers' in spec:                  # away from the bridge, they walk lanes along the streets (painted, on the ground)
        St = spec['strollers']
        scene['crowd'] |= {'n': St.get('n', 9), 'lanes': [{'path': [ground_at(spec['map'], spec['bank'], u, v) for u, v in Ln['path']], 'width': Ln.get('width', 60)} for Ln in St['lanes']]}
    elif 'bridge' not in spec: del scene['crowd']

    if placed: scene['people'] = placed
    if trees: scene['trees'] = trees
    if 'walks' in spec: scene['walks'] = {k: v for k, v in spec['walks'].items() if k != 'about'}
    if models: scene['models'] = models
    if sprites:
        atlas, place = pack(sprites)
        save(atlas[..., :3], out / 'sprites.webp', alpha=atlas[..., 3] / 255)
        scene['sprites'] = {'file': 'sprites.webp', 'size': [atlas.shape[1], atlas.shape[0]],
                            'rects': {k: v for k, v in place.items()}}
    if 'boat' in spec: scene['boat'] = {k: v for k, v in spec['boat'].items() if k not in ('poly', 'about')}
    if 'boats' in spec: scene['boats'] = [{k: v for k, v in Bt.items() if k != 'about'} for Bt in spec['boats']]
    (out / 'scene.json').write_text(json.dumps(scene, separators=(',', ':'), ensure_ascii=False))

    # a preview of what the masks decided, for checking by eye
    prev = shrink(rgb, 4) * .55
    mw, ml = shrink(water_s, 4)[..., None], shrink(land_s, 4)[..., None]
    prev = prev + mw * np.array([0, 60, 120]) + ml * np.array([90, 60, 0])
    name = out.name
    Image.fromarray(np.clip(prev, 0, 255).astype(np.uint8)).save(Path(__file__).parent / ('world-masks-preview.png' if name == 'bridge' else f'world-masks-preview-{name}.png'))
    print(name, *(['bridge L', round(b['L']), 'face', b['face']['size']] if b else []), 'water px', int(water.sum()), 'land px', int(land.sum()),
          'models', len(models), 'people', len(placed), 'trees', len(trees), 'sprites', len(sprites))


if __name__ == '__main__':
    main(*sys.argv[1:4])

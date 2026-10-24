#!/usr/bin/env python3
"""Cut a scene of the scan into the layers of a painted diorama (diorama.html), from a spec in life/.

Each layer is a stretch of the painting that will stand up in 3D at its own depth. It is cut out of the scan along its
outline (kind "shape"), or along the brushwork inside the outline: "fill" (the ink lines, with the shapes they enclose
filled in), "ink" (the lines only) or "halo" (the lines with a thin margin of silk). Whatever a layer hides of the
layers behind it, and the ground under all of them, is filled with blank silk: the silk's own tone, interpolated from
the unpainted pixels around it, with a woven texture, so what the camera uncovers looks like the painting's empty
silk rather than a hole or a smear. The walker is cut into pieces (body, swinging baskets) at full resolution.
Writes assets/diorama/<name>/: ground.webp, water.png, one RGBA .webp per layer and walker piece, scene.json.
Usage: python3 tools/make_diorama.py life/diorama-bridge.json source/Alongtheriver_QingMing.jpg assets/diorama/bridge
"""
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from make_life import brushwork, fill_holes          # noqa: E402  (same ink detection as the moving layer)

Image.MAX_IMAGE_PIXELS = None
MARGIN = 40          # how far (px) a layer is filled in behind the layers in front of it
SWATCH = (8892, 452, 9148, 708)   # a speck-free stretch of blank silk on the scan (near the gate), the texture for every fill
HALO = 6             # px of silk kept around the brushwork for kind "halo"
QUALITY = 86


def poly_mask(size, poly, origin):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon([(x - origin[0], y - origin[1]) for x, y in poly], fill=255)
    return np.asarray(m, np.float32) / 255


def cut(master, box, kind):
    """the brushwork in box as a 0..1 mask: fill, ink, or halo (ink grown by HALO px, soft at its edge)"""
    if kind == 'halo':     # grown by HALO, and whatever that encloses filled (a dark tunic, a basket's insides)
        ink = np.asarray(brushwork(master, tuple(box), 'ink'), np.float32) / 255
        solid = np.asarray(fill_holes(Image.fromarray((grow(ink, HALO) > .5).astype(np.uint8) * 255)), np.float32) / 255
        return np.clip(blur(solid, HALO * .4) * 1.3, 0, 1)
    return np.asarray(brushwork(master, tuple(box), kind), np.float32) / 255


def ink_mask(master, region, box, kind):
    """brushwork (0..1) for box, placed in region coordinates"""
    out = np.zeros((region[3] - region[1], region[2] - region[0]), np.float32)
    b = [max(box[0], region[0]), max(box[1], region[1]), min(box[2], region[2]), min(box[3], region[3])]
    ink = cut(master, b, kind)
    out[b[1] - region[1]:b[3] - region[1], b[0] - region[0]:b[2] - region[0]] = ink
    return out


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
    """dilate a 0/1 mask by about px"""
    img = Image.fromarray((a > .5).astype(np.uint8) * 255)
    while px > 0:
        k = min(px, 7); img = img.filter(ImageFilter.MaxFilter(2 * (k // 2) + 1)); px -= k
    return np.asarray(img, np.float32) / 255


def resize(a, size):
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize(size, Image.BILINEAR), np.float32)


def pushpull(img, known):
    """fill img (H, W, 3) where known (H, W, 0..1) is 0, from coarse averages of the known pixels"""
    cols, alphas = [img], [known]
    while min(cols[-1].shape[:2]) > 4:
        c, a = cols[-1], alphas[-1]
        H, W = a.shape; H2, W2 = (H + 1) // 2, (W + 1) // 2
        cp = np.pad(c * a[..., None], ((0, H2 * 2 - H), (0, W2 * 2 - W), (0, 0)), mode='edge')
        ap = np.pad(a, ((0, H2 * 2 - H), (0, W2 * 2 - W)), mode='edge')
        cs = cp[0::2, 0::2] + cp[1::2, 0::2] + cp[0::2, 1::2] + cp[1::2, 1::2]
        asum = ap[0::2, 0::2] + ap[1::2, 0::2] + ap[0::2, 1::2] + ap[1::2, 1::2]
        cols.append(cs / np.maximum(asum, 1e-6)[..., None]); alphas.append(np.clip(asum / 4 * 2, 0, 1))
    est = cols[-1]
    for c, a in zip(reversed(cols[:-1]), reversed(alphas[:-1])):
        H, W = a.shape
        up = np.stack([resize(est[..., i], (W, H)) for i in range(3)], -1)
        est = c * a[..., None] + up * (1 - a[..., None])
    return est


def swatch_ratio(master):
    """the blank-silk swatch, mirrored to tile seamlessly, as a ratio to its own mean colour"""
    p = np.asarray(master.crop(SWATCH).convert('RGB'), np.float32)
    p = p / np.stack([blur(p[..., c], 20) for c in range(3)], -1)      # the weave only: no shading to repeat
    top = np.concatenate([p, p[:, ::-1]], 1)
    return np.concatenate([top, top[::-1]], 0)


def silk(rgb, covered, painted, ratio):
    """blank silk for the covered pixels: the real weave of the swatch, in the tone of the unpainted silk nearby"""
    tone = pushpull(rgb, (1 - covered) * (1 - painted))
    H, W = covered.shape
    reps = (H // ratio.shape[0] + 1, W // ratio.shape[1] + 1, 1)
    return tone * np.tile(ratio, reps)[:H, :W]


def foot_rows(foot, us):
    (ua, va), (ub, vb) = foot
    return va + (vb - va) * (us - ua) / (ub - ua)


def save_rgba(rgb, alpha, path, pad=2):
    ys, xs = np.nonzero(alpha > .004)
    y0, y1 = max(0, ys.min() - pad), min(alpha.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(alpha.shape[1], xs.max() + pad + 1)
    a = np.clip(alpha[y0:y1, x0:x1], 0, 1)
    px = np.dstack([np.clip(rgb[y0:y1, x0:x1], 0, 255), a * 255]).astype(np.uint8)
    Image.fromarray(px, 'RGBA').save(path, quality=QUALITY, method=6)
    return [int(x0), int(y0), int(x1), int(y1)]


def main(spec_path, master_path, out_dir):
    spec = json.loads(Path(spec_path).read_text())
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    master = Image.open(master_path)
    R = spec['region']; W, H = R[2] - R[0], R[3] - R[1]
    rgb = np.asarray(master.crop(tuple(R)).convert('RGB'), np.float32)
    us = np.arange(W, dtype=np.float32) + R[0]
    rows = np.arange(H, dtype=np.float32)[:, None] + R[1]

    # each layer's own mask: outline, brushwork, extra pieces; nothing below its foot line (that stays on the ground)
    hard, soft = [], []
    painted = grow(ink_mask(master, R, R, 'ink'), 3)          # anything with brushwork, to keep it out of the silk tone
    for L in spec['layers']:
        m = poly_mask((W, H), L['poly'], R)
        if L.get('kind', 'shape') != 'shape':
            m = m * ink_mask(master, R, [int(min(p[0] for p in L['poly'])), int(min(p[1] for p in L['poly'])), int(max(p[0] for p in L['poly'])), int(max(p[1] for p in L['poly']))], L['kind'])
        for P in L.get('plus', []):
            m = np.maximum(m, ink_mask(master, R, P['box'], P['kind']))
        m = m * (rows <= foot_rows(L['foot'], us)[None, :] + 2)
        hard.append((m > .5).astype(np.float32)); soft.append(np.clip(blur(m, 1.2), 0, 1))

    scene = {'region': R, 'view': spec['view'], 'layers': [], 'size': [W, H]}
    # the ground: the whole region, with blank silk where the layers stood
    covered = grow(np.maximum.reduce(hard), 4)
    ratio = swatch_ratio(master)
    blank = silk(rgb, covered, painted, ratio)
    # the silk's overall tone, and the swatch in that tone for the sky and the table-top beyond the scroll's edges
    known = ((1 - covered) * (1 - painted)) > .5
    tone = np.median(rgb[known], 0)
    Image.fromarray(np.clip(ratio * tone, 0, 255).astype(np.uint8)).save(out / 'silk.webp', quality=QUALITY, method=6)
    scene['silk'] = {'file': 'silk.webp', 'tone': [round(float(v), 1) for v in tone], 'size': ratio.shape[1]}
    ground = rgb * (1 - covered[..., None]) + blank * covered[..., None]
    Image.fromarray(np.clip(ground, 0, 255).astype(np.uint8)).save(out / 'ground.webp', quality=QUALITY, method=6)
    scene['ground'] = {'file': 'ground.webp', **spec.get('ground', {})}

    for i, L in enumerate(spec['layers']):
        front = np.maximum.reduce(hard[i + 1:]) if i + 1 < len(hard) else np.zeros_like(hard[i])
        ext = grow(hard[i], MARGIN) * front * (1 - hard[i])
        ext = ext * (rows <= foot_rows(L['foot'], us)[None, :] + 2)
        alpha = np.maximum(soft[i], np.clip(blur(ext, 5) * 1.4, 0, 1) * (ext > 0))
        col = rgb * hard[i][..., None] + blank * (1 - hard[i][..., None])     # behind what's in front: blank silk
        bbox = save_rgba(col, alpha, out / f"{L['id']}.webp")
        entry = {'id': L['id'], 'file': f"{L['id']}.webp", 'bbox': [bbox[0] + R[0], bbox[1] + R[1], bbox[2] + R[0], bbox[3] + R[1]], 'foot': L['foot']}
        if 'rock' in L: entry['rock'] = L['rock']
        scene['layers'].append(entry)
        print(L['id'], 'own px', int(hard[i].sum()), 'filled behind', int((ext > 0).sum()), 'bbox', entry['bbox'])

    # open water, from the scroll-wide mask (assets/water-mask.png, 1/8 scale)
    wm = Image.open(Path(master_path).parents[1] / 'assets' / 'water-mask.png')
    sx = wm.width / master.width
    water = wm.crop((round(R[0] * sx), round(R[1] * sx), round(R[2] * sx), round(R[3] * sx)))
    water.save(out / 'water.png', optimize=True)
    scene['water'] = 'water.png'

    # the walker, in pieces at full resolution (the viewer scales him to the scene)
    Wk = spec['walker']; s = Wk['scale']; pieces = []
    for P in Wk['pieces']:
        parts = P.get('parts') or [{'kind': P['kind'], 'poly': P['poly']}]
        allpts = [p for part in parts for p in part['poly']]
        box = [int(min(p[0] for p in allpts)) - 3, int(min(p[1] for p in allpts)) - 3, int(max(p[0] for p in allpts)) + 3, int(max(p[1] for p in allpts)) + 3]
        bw, bh = box[2] - box[0], box[3] - box[1]
        m = np.zeros((bh, bw), np.float32)
        for part in parts:
            pm = blur(poly_mask((bw, bh), part['poly'], box), 1.5) * cut(master, box, part['kind'])
            m = np.maximum(m, pm)
        m = np.clip(m, 0, 1)
        col = np.asarray(master.crop(tuple(box)).convert('RGB'), np.float32)
        px = np.dstack([col, m * 255]).astype(np.uint8)
        Image.fromarray(px, 'RGBA').save(out / f"walker-{P['id']}.png", optimize=True)
        pieces.append({'id': P['id'], 'file': f"walker-{P['id']}.png", 'box': box, **({'pivot': P['pivot']} if 'pivot' in P else {})})
    scene['walker'] = {'scale': s, 'feet': Wk['feet'], 'pieces': pieces}
    scene['path'] = spec['path']
    scene['terraces'] = spec.get('terraces')
    scene['front'] = next(L['foot'] for L in spec['layers'] if L['id'] == 'bridge-front')
    (out / 'scene.json').write_text(json.dumps(scene, separators=(',', ':')))
    print('walker pieces', [p['id'] for p in pieces])


if __name__ == '__main__':
    main(*sys.argv[1:4])

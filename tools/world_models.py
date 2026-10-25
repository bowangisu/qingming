"""Simple 3D models fitted to things the painting shows: houses, open sheds, mat awnings, umbrellas, and trees and
boats as flat cut-outs elsewhere. Every model is given in the painting's own terms (master px, as painted) and built
in the world of tools/make_world.py, where a point (X, Y, Z) is painted at u = X + a·Z, v = c − s·Z − Y.

Every vertex carries the painting px it shows. A face the painter could see shows the painting at its own painted
position, so from his direction the model is the painting exactly. A face he could not see (the back of a house,
the far slope of a roof, the far gable) shows the face opposite it, mirrored through the model's middle, as a
symmetric building would. Posts and poles are plain timber."""
import numpy as np
from PIL import Image, ImageDraw

TIMBER = [0.33, 0.26, 0.19]


class World:
    def __init__(self, a, s, c, bank):
        self.a, self.s, self.c, self.bank = a, s, c, bank
        h = np.array([a, s, -1.0]); self.home = h / np.linalg.norm(h)    # toward the painter

    def at(self, u, v, y):
        """the world point at height y that is painted at (u, v)"""
        z = (self.c - v - y) / self.s
        return np.array([u - self.a * z, y, z], np.float64)

    def paint(self, p):
        p = np.asarray(p, np.float64)
        return np.stack([p[..., 0] + self.a * p[..., 2], self.c - self.s * p[..., 2] - p[..., 1]], -1)


class Mesh:
    """faces with painted px per vertex; plain-coloured parts kept apart"""
    def __init__(self):
        self.pos, self.uv, self.nrm, self.idx = [], [], [], []
        self.plain = {'pos': [], 'nrm': [], 'idx': []}
        self.faces = []                               # painted outlines, for taking the model off the ground

    def face(self, pts, uvs, n=None):
        pts = [np.asarray(p, np.float64) for p in pts]
        if n is None:
            n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
            n = n / (np.linalg.norm(n) or 1)
        base = len(self.pos)
        for p, t in zip(pts, uvs):
            self.pos.append(p); self.uv.append(np.asarray(t, np.float64)); self.nrm.append(n)
        for k in range(1, len(pts) - 1): self.idx += [base, base + k, base + k + 1]

    def timber(self, a, b, r=2.5):
        """a square post from a to b"""
        a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
        d = b - a; d /= np.linalg.norm(d)
        e1 = np.cross(d, [0, 0, 1.0]) if abs(d[2]) < .9 else np.cross(d, [1.0, 0, 0]); e1 /= np.linalg.norm(e1)
        e2 = np.cross(d, e1)
        ring = [e1 * r, e2 * r, -e1 * r, -e2 * r]
        P = self.plain; base = len(P['pos'])
        for k in range(4):
            for q in (a, b): P['pos'].append(q + ring[k]); P['nrm'].append(ring[k] / r); P.setdefault('axis', []).append(q)
        for k in range(4):
            i, j = base + k * 2, base + ((k + 1) % 4) * 2
            P['idx'] += [i, j, i + 1, i + 1, j, j + 1]

    def export(self, W, id, shade=1.0, **extra):
        r = lambda a, k=1: [round(float(x), k) for x in np.ravel(a)]
        out = {'id': id, 'shade': shade, 'pos': r(self.pos), 'uv': r(self.uv), 'nrm': r(self.nrm, 3), 'idx': self.idx, **extra}
        if self.plain['idx']:
            # each post shows the painting along its own axis, so seen as painted it is the painted post
            out['plain'] = {'pos': r(self.plain['pos']), 'uv': r(W.paint(np.array(self.plain['axis']))), 'nrm': r(self.plain['nrm'], 3),
                            'idx': self.plain['idx'], 'color': TIMBER}
        return out

    def outline(self, W, size, origin):
        """the painted silhouette of the model (every face projected), as a 0..1 mask over a region"""
        m = Image.new('L', size, 0); d = ImageDraw.Draw(m)
        for tri in np.reshape(self.idx, (-1, 3)):
            pts = W.paint(np.array([self.pos[i] for i in tri]))
            d.polygon([(x - origin[0], y - origin[1]) for x, y in pts], fill=255)
        for tri in np.reshape(self.plain['idx'], (-1, 3)) if self.plain['idx'] else []:
            pts = W.paint(np.array([self.plain['pos'][i] for i in tri]))
            d.polygon([(x - origin[0], y - origin[1]) for x, y in pts], fill=255)
        return np.asarray(m, np.float32) / 255


def painted_face(M, W, pts, mirror=None, n=None, up=False):
    """a face showing the painting: at its own painted position if the painter saw it, else at its mirror image"""
    pts = [np.asarray(p, np.float64) for p in pts]
    if n is None:
        n = np.cross(pts[1] - pts[0], pts[2] - pts[0]); n /= np.linalg.norm(n) or 1
        if n[1] < 0: n = -n                              # roofs face up
    seen = np.dot(n, W.home) > 0.02
    src = pts if seen or mirror is None else [mirror(p) for p in pts]
    M.face(pts, [W.paint(p) for p in src], n)


def house(W, H):
    """A house standing on the bank. base: the front wall's foot as painted, left and right corners (u, v);
    depth: how far back it goes (world units); wall: wall height; roof: {type hip|gable|shed, rise, eave, hip}.
    posts: true for an open shed (posts instead of walls). y: ground height (default the bank)"""
    y0 = H.get('y', W.bank)
    P1, P2 = W.at(*H['base'][0], y0), W.at(*H['base'][1], y0)
    f = P2 - P1; L = np.linalg.norm(f); f /= L
    if 'recede' in H:                                    # the way the painter drew it going back, (du, dv) on the silk
        du, dv = H['recede']; nz = -dv / W.s; n = np.array([du - W.a * nz, 0, nz])
    else:
        n = np.array([-f[2], 0, f[0]])
    n /= np.linalg.norm(n)
    if n[2] < 0: n = -n                                  # back: away from the painter
    D, Hw = H['depth'], H['wall']
    C = (P1 + P2) / 2 + n * D / 2
    # local coordinates (along the front, back from it), so a house drawn askew still mirrors onto itself
    Minv = np.linalg.inv(np.array([[f[0], n[0]], [f[2], n[2]]]))
    def local(p):
        t, d = Minv @ np.array([p[0] - P1[0], p[2] - P1[2]]); return t, d
    def world(t, d, y): return np.array([P1[0] + f[0] * t + n[0] * d, y, P1[2] + f[2] * t + n[2] * d])
    def mir_d(p): t, d = local(p); return world(t, D - d, p[1])          # front <-> back
    def mir_l(p): t, d = local(p); return world(L - t, d, p[1])          # left <-> right
    up = np.array([0, 1.0, 0])
    FL, FR, BR, BL = P1, P2, P2 + n * D, P1 + n * D
    M = Mesh()
    if H.get('posts'):
        k = H.get('bays', 2)
        for t in np.linspace(0, 1, k + 1):
            for q in (FL + (FR - FL) * t, BL + (BR - BL) * t): M.timber(q, q + up * Hw, H.get('post_r', 2.6))
        for a, b in ((FL, FR), (BL, BR), (FL, BL), (FR, BR)): M.timber(a + up * Hw, b + up * Hw, 2.2)
    else:
        for a, b, mir in ((FL, FR, mir_d), (FR, BR, mir_l), (BR, BL, mir_d), (BL, FL, mir_l)):
            pts = [a, b, b + up * Hw, a + up * Hw]
            nn = np.cross(pts[1] - pts[0], pts[3] - pts[0]); nn /= np.linalg.norm(nn)
            if np.dot(nn, ((a + b) / 2 - C) * [1, 0, 1]) < 0: nn = -nn      # outward
            painted_face(M, W, pts, mir, nn)
    R = H['roof']; o = R.get('eave', 12); ye = Hw; yr = Hw + R['rise']
    E = [q + up * ye for q in (FL - f * o - n * o, FR + f * o - n * o, BR + f * o + n * o, BL - f * o + n * o)]
    t = R.get('type', 'hip')
    if t == 'shed':                                      # one slope, high at the back
        E2 = [E[0], E[1], E[2] + up * R['rise'], E[3] + up * R['rise']]
        painted_face(M, W, E2, mir_d)
        if not H.get('posts'):
            for a, b in ((FR, BR), (BL, FL)):
                pts = [a + up * Hw, b + up * Hw, b + up * yr] if np.allclose(b, BR) or np.allclose(b, BL) else None
                if pts: painted_face(M, W, pts, mir_l)
        return M
    inset = (L / 2 + o) * R.get('hip', .45) if t == 'hip' else 0
    R1 = C - f * (L / 2 + o - inset) + up * yr; R2 = C + f * (L / 2 + o - inset) + up * yr
    painted_face(M, W, [E[0], E[1], R2, R1], mir_d)     # the front slope, and the back one wearing it
    painted_face(M, W, [E[2], E[3], R1, R2], mir_d)
    if t == 'hip':
        painted_face(M, W, [E[3], E[0], R1], mir_l); painted_face(M, W, [E[1], E[2], R2], mir_l)
    else:                                                # gable: the roof's ends are walls up to the ridge
        g = lambda a, b, r: painted_face(M, W, [a, b, r], mir_l)
        g(BL + up * Hw, FL + up * Hw, C - f * L / 2 + up * yr); g(FR + up * Hw, BR + up * Hw, C + f * L / 2 + up * yr)
    return M


def awning(W, A):
    """A mat awning on poles: its four corners as painted (u, v), front pair then back pair, at heights y (world,
    above the water: front, back)."""
    yf, yb = A['y']
    P = [W.at(*A['corners'][0], yf), W.at(*A['corners'][1], yf), W.at(*A['corners'][2], yb), W.at(*A['corners'][3], yb)]
    M = Mesh()
    M.face([P[0], P[1], P[2], P[3]], [W.paint(p) for p in P])
    g = A.get('ground', W.bank)
    for p in P: M.timber(p, np.array([p[0], g, p[2]]), 2.0)
    return M


def umbrella(W, U):
    """A market umbrella: the canopy's centre as painted (u, v) at height y, its radius, and a pole to the ground."""
    C = W.at(*U['at'], U['y']); r = U['r']; g = U.get('ground', W.bank)
    apex = C + np.array([0, r * .22, 0])
    M = Mesh(); N = 16
    rim = [C + np.array([np.cos(t) * r, -r * .06, np.sin(t) * r]) for t in np.linspace(0, 2 * np.pi, N + 1)]
    for k in range(N):
        a, b = rim[k], rim[k + 1]
        M.face([apex, a, b], [W.paint(apex), W.paint(a), W.paint(b)], np.cross(b - apex, a - apex) / (np.linalg.norm(np.cross(b - apex, a - apex)) or 1) * -1)
    M.timber(np.array([C[0], g, C[2]]), apex, 1.6)
    return M


def fit_preview(master, W, models, box, scale, path, extra=()):
    """the models' edges drawn over the painting, to fit them by eye"""
    x0, y0, x1, y1 = box
    im = master.crop(box).resize((int((x1 - x0) * scale), int((y1 - y0) * scale)), Image.LANCZOS).convert('RGB')
    d = ImageDraw.Draw(im)
    P = lambda q: ((q[0] - x0) * scale, (q[1] - y0) * scale)
    for M in models:
        pos = np.array(M.pos) if M.pos else np.zeros((0, 3))
        for tri in np.reshape(M.idx, (-1, 3)):
            pts = W.paint(pos[tri]); d.line([P(q) for q in pts] + [P(pts[0])], fill=(0, 255, 255), width=1)
        pp = np.array(M.plain['pos']) if M.plain['pos'] else np.zeros((0, 3))
        for tri in np.reshape(M.plain['idx'], (-1, 3)) if M.plain['idx'] else []:
            pts = W.paint(pp[tri]); d.line([P(q) for q in pts], fill=(255, 120, 0), width=1)
    for (u, v) in extra: d.ellipse([P((u, v))[0] - 3, P((u, v))[1] - 3, P((u, v))[0] + 3, P((u, v))[1] + 3], outline=(255, 0, 255))
    step = 50
    for x in range((x0 // step + 1) * step, x1, step):
        d.text(((x - x0) * scale + 2, 2), str(x), fill=(255, 255, 0))
        d.line([((x - x0) * scale, 0), ((x - x0) * scale, 6)], fill=(255, 255, 0))
    for y in range((y0 // step + 1) * step, y1, step):
        d.text((2, (y - y0) * scale + 2), str(y), fill=(255, 255, 0))
        d.line([(0, (y - y0) * scale), (6, (y - y0) * scale)], fill=(255, 255, 0))
    im.save(path)

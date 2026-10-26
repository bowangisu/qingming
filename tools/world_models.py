"""Simple 3D models fitted to things the painting shows: houses (boxes with hip, gable or shed roofs, or traced off
the painted roof's own corners), open sheds and pavilions on posts, mat awnings and tables, umbrellas, and masonry
blocks with sloping walls (a city gate's platform, its passage through it). Every model is
given in the painting's own terms (master px, as painted) and built in the world of tools/make_world.py, where a point
(X, Y, Z) is painted at u = X + a·Z, v = c − s·Z − Y.

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
        self.edges = {}                               # outline edges, for the viewer's ink lines (deduplicated)
        self.foot = None                              # what it stands on: a ground quad, or a disc, for its shadow
        self.arch = None                              # how the viewer draws it where the painting shows nothing

    def edge(self, a, b):
        key = tuple(sorted((tuple(np.round(a, 0)), tuple(np.round(b, 0)))))
        if key[0] != key[1]: self.edges[key] = True

    def outline_face(self, pts):
        for i in range(len(pts)): self.edge(pts[i], pts[(i + 1) % len(pts)])

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
        if self.edges: out['edges'] = r([list(a) + list(b) for a, b in self.edges])
        if self.foot: out['foot'] = self.foot
        if self.arch: out['arch'] = self.arch
        if getattr(self, 'solids', None): out['solids'] = self.solids
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


def arch(style, y0, ye, yr, bay=80):
    """the viewer's own drawing of a building, under the painting: style (house: plaster and timber, lattice windows;
    shop: plank doors below, lattice above; brick; thatch; mat; boards), its ground, eave and ridge heights, its bay width"""
    return {'style': style, 'y': [round(float(y0), 1), round(float(ye), 1), round(float(yr), 1)], 'bay': round(float(bay), 1)}


def eaves_underside(M, W, E, wl, ye, fascia=8):
    """under a roof's overhang: the soffit between the eaves and the walls' tops, facing down, and a fascia board
    along the eaves' edge, so the roof has a thickness"""
    down = np.array([0, -1.0, 0])
    for i in range(len(E)):
        a, b = E[i], E[(i + 1) % len(E)]
        M.face([a, b, wl[(i + 1) % len(E)], wl[i]], [W.paint(q) for q in (a, b, wl[(i + 1) % len(E)], wl[i])], down)
        n = np.cross(b - a, down); n /= np.linalg.norm(n) or 1
        if np.dot(n, (a + b) / 2 - np.mean(E, 0)) < 0: n = -n
        lo = [a + down * fascia, b + down * fascia]
        M.face([lo[0], lo[1], b, a], [W.paint(q) for q in (lo[0], lo[1], b, a)], n)
        M.edge(lo[0], lo[1])


def painted_face(M, W, pts, mirror=None, n=None, up=False):
    """a face showing the painting: at its own painted position if the painter saw it, else at its mirror image"""
    pts = [np.asarray(p, np.float64) for p in pts]
    if n is None:
        n = np.cross(pts[1] - pts[0], pts[2] - pts[0]); n /= np.linalg.norm(n) or 1
        if n[1] < 0: n = -n                              # roofs face up
    seen = np.dot(n, W.home) > 0.02
    src = pts if seen or mirror is None else [mirror(p) for p in pts]
    M.face(pts, [W.paint(p) for p in src], n)
    M.outline_face(pts)


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
    M.foot = {'kind': 'box', 'y': round(float(y0), 1), 'pts': [[round(float(q[0]), 1), round(float(q[2]), 1)] for q in (FL, FR, BR, BL)]}
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
    R = H['roof']
    o = R.get('eave', 12); ye = Hw; yr = Hw + R['rise']
    E = [q + up * ye for q in (FL - f * o - n * o, FR + f * o - n * o, BR + f * o + n * o, BL - f * o + n * o)]
    t = R.get('type', 'hip')
    M.arch = arch(H.get('style', 'shop' if H.get('posts') else 'house'), y0, y0 + Hw, y0 + yr, H.get('bay', max(50, L / max(2, round(L / 90)))))
    eaves_underside(M, W, E, [q + up * Hw for q in (FL, FR, BR, BL)], ye)
    if not H.get('posts'):
        for q in (FL, FR, BR, BL): M.timber(q, q + up * Hw, 3.5)
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
    M.timber(R1 + up * 3, R2 + up * 3, 4.5)                # the ridge
    painted_face(M, W, [E[0], E[1], R2, R1], mir_d)     # the front slope, and the back one wearing it
    painted_face(M, W, [E[2], E[3], R1, R2], mir_d)
    if t == 'hip':
        painted_face(M, W, [E[3], E[0], R1], mir_l); painted_face(M, W, [E[1], E[2], R2], mir_l)
    else:                                                # gable: the roof's ends are walls up to the ridge
        g = lambda a, b, r: painted_face(M, W, [a, b, r], mir_l)
        g(BL + up * Hw, FL + up * Hw, C - f * L / 2 + up * yr); g(FR + up * Hw, BR + up * Hw, C + f * L / 2 + up * yr)
    return M


def traced(W, T):
    """A building traced off the painting: its roof's four eave corners as painted (u, v) (front-left, front-right,
    back-right, back-left) at height eave_y, its ridge's two ends as painted at height ridge_y (both world heights
    above the water). A hip roof has its ridge ends inside the eaves; a gable has them above the middle of the left
    and right eaves, which makes those ends upright gables. Seen from the painter's direction it lands exactly on the
    painted roof, whatever heights it is given; the heights decide how deep and how tall it is. walls: the walls stand
    that far in from the eaves (world units), from the ground (y, default the bank) up to the eaves."""
    ye, yr = T['eave_y'], T['ridge_y']
    E = [W.at(u, v, ye) for u, v in T['eaves']]
    R = [W.at(u, v, yr) for u, v in T['ridge']]
    if len(E) == 2:                                       # only the front eaves given: the back mirrors them across the ridge
        r0, r1 = R[0] * [1, 0, 1], R[1] * [1, 0, 1]; dr = (r1 - r0) / np.linalg.norm(r1 - r0)
        def across(e):
            q = e * [1, 0, 1]; foot = r0 + dr * np.dot(q - r0, dr); b = 2 * foot - q; return np.array([b[0], ye, b[2]])
        E = [E[0], E[1], across(E[1]), across(E[0])]
    # affine local coordinates on the eave quad: p = E0 + t (E1 - E0) + d (E3 - E0)
    A = np.array([[E[1][0] - E[0][0], E[3][0] - E[0][0]], [E[1][2] - E[0][2], E[3][2] - E[0][2]]]); Ai = np.linalg.inv(A)
    def local(p): return Ai @ np.array([p[0] - E[0][0], p[2] - E[0][2]])
    def world(t, d, y): q = A @ np.array([t, d]); return np.array([E[0][0] + q[0], y, E[0][2] + q[1]])
    def mir_d(p): t, d = local(p); return world(t, 1 - d, p[1])
    def mir_l(p): t, d = local(p); return world(1 - t, d, p[1])
    M = Mesh()
    M.foot = {'kind': 'box', 'y': T.get('y', W.bank), 'pts': [[round(float(e[0]), 1), round(float(e[2]), 1)] for e in E]}
    span = np.linalg.norm((E[1] - E[0]) * [1, 0, 1])
    M.arch = arch(T.get('style', 'house'), T.get('y', W.bank), ye, yr, T.get('bay', max(50, span / max(2, round(span / 95)))))
    M.timber(R[0] + [0, 3, 0], R[1] + [0, 3, 0], 5.0)       # the ridge
    painted_face(M, W, [E[0], E[1], R[1], R[0]], mir_d)
    painted_face(M, W, [E[2], E[3], R[0], R[1]], mir_d)
    painted_face(M, W, [E[1], E[2], R[1]], mir_l)
    painted_face(M, W, [E[3], E[0], R[0]], mir_l)
    if 'walls' in T or 'open' in T or 'wall_at' in T:
        g = T.get('y', W.bank); k = T.get('walls', T.get('open', 0))
        # the wall loop: the eave loop pulled in by k world units, or the walls' feet as painted (u, v) at the ground
        c = np.mean(E, 0)
        wl = [c + (e - c) * (1 - k / max(np.linalg.norm((e - c) * [1, 0, 1]), 1)) for e in E]
        if 'wall_at' in T:
            wl = [W.at(u, v, g) * [1, 0, 1] + [0, ye, 0] for u, v in T['wall_at']]
            M.foot['pts'] = [[round(float(q[0]), 1), round(float(q[2]), 1)] for q in wl]
        eaves_underside(M, W, E, wl, ye)
        if 'open' in T:                                   # a pavilion: a post at each corner instead of walls
            for e in wl: M.timber(np.array([e[0], g, e[2]]), np.array([e[0], ye, e[2]]), 3.0)
            return M
        for e in wl: M.timber(np.array([e[0], g, e[2]]), np.array([e[0], ye, e[2]]), 4.0)      # corner posts
        for i in range(4):
            a, b = wl[i], wl[(i + 1) % 4]
            pts = [np.array([a[0], g, a[2]]), np.array([b[0], g, b[2]]), np.array([b[0], ye, b[2]]), np.array([a[0], ye, a[2]])]
            nn = np.cross(pts[1] - pts[0], pts[3] - pts[0]); nn /= np.linalg.norm(nn)
            if np.dot(nn, ((a + b) / 2 - c) * [1, 0, 1]) < 0: nn = -nn
            painted_face(M, W, pts, mir_d if i % 2 == 0 else mir_l, nn)
    for P in T.get('posts', []):                          # posts as painted: their foot (u, v) on the ground
        q = W.at(*P, T.get('y', W.bank)); M.timber(q, q + np.array([0, ye - q[1], 0]), 2.4)
    return M


def awning(W, A):
    """A mat awning on poles: its four corners as painted (u, v), front pair then back pair, at heights y (world,
    above the water: front, back)."""
    yf, yb = A['y']
    P = [W.at(*A['corners'][0], yf), W.at(*A['corners'][1], yf), W.at(*A['corners'][2], yb), W.at(*A['corners'][3], yb)]
    M = Mesh(); M.arch = arch(A.get('style', 'mat'), A.get('ground', W.bank), min(yf, yb), max(yf, yb))
    nn = np.cross(P[1] - P[0], P[3] - P[0]); nn /= np.linalg.norm(nn) or 1
    M.face([P[0], P[1], P[2], P[3]], [W.paint(p) for p in P], nn if nn[1] > 0 else -nn); M.outline_face([P[0], P[1], P[3], P[2]])
    M.foot = {'kind': 'box', 'y': A.get('ground', W.bank), 'pts': [[round(float(q[0]), 1), round(float(q[2]), 1)] for q in (P[0], P[1], P[3], P[2])]}
    g = A.get('ground', W.bank)
    for p in P: M.timber(p, np.array([p[0], g, p[2]]), 2.0)
    return M


def umbrella(W, U):
    """A market umbrella: the canopy's centre as painted (u, v) at height y, its radius, and a pole to the ground."""
    C = W.at(*U['at'], U['y']); r = U['r']; g = U.get('ground', W.bank)
    apex = C + np.array([0, r * .22, 0])
    M = Mesh(); N = 16; M.arch = arch('mat', g, U['y'], U['y'] + r * .22)
    rim = [C + np.array([np.cos(t) * r, -r * .06, np.sin(t) * r]) for t in np.linspace(0, 2 * np.pi, N + 1)]
    M.foot = {'kind': 'disc', 'y': g, 'c': [round(float(C[0]), 1), round(float(C[2]), 1)], 'r': r}
    for k in range(N): M.edge(rim[k], rim[k + 1])
    for k in range(0, N, 4): M.edge(apex, rim[k])
    for k in range(N):
        a, b = rim[k], rim[k + 1]
        nn = np.cross(b - apex, a - apex); nn /= np.linalg.norm(nn) or 1
        M.face([apex, a, b], [W.paint(apex), W.paint(a), W.paint(b)], nn if nn[1] > 0 else -nn)      # facing up and out
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


def block(W, B):
    """A masonry block with sloping walls: a city gate's platform. base: its four corners at the ground as painted (u, v)
    (front-left, front-right, back-right, back-left); h: its height; batter: how far each wall leans in by the top
    (front, right, back, left; world units). passage: {d: [from, to], h} a passage running through it from the left
    face to the right, between those fractions of its depth and that high. Returns the block, with the part in front
    of the passage as its footprint, and a second, empty model whose footprint is the part behind it."""
    g = B.get('y', W.bank); H = B['h']; bf, br, bb, bl = B.get('batter', [0, 0, 0, 0])
    base = [W.at(u, v, g) for u, v in B['base']]
    f = base[1] - base[0]; f /= np.linalg.norm(f); n = base[3] - base[0]; n /= np.linalg.norm(n)
    # the top: each wall pulled in along its own normal (in the plane), corners where neighbouring walls meet
    ins = [n * bf, -f * br, -n * bb, f * bl]                # front, right, back, left
    top = [base[0] + ins[0] + ins[3], base[1] + ins[0] + ins[1], base[2] + ins[1] + ins[2], base[3] + ins[2] + ins[3]]
    top = [q + [0, H, 0] for q in top]
    def Q(tt, d, y):                                      # a point on the block: tt along the front, d back, at height y
        k = y / H
        c = [base[i] + (top[i] - base[i]) * k for i in range(4)]
        a = c[0] + (c[1] - c[0]) * tt; b = c[3] + (c[2] - c[3]) * tt
        return a + (b - a) * d
    M = Mesh(); M.foot = None; M.arch = arch(B.get('style', 'brick'), g, g + H, g + H)
    def quad(corners, src=None, n=None):
        """corners as (tt, d, y); src maps each to the point whose painted px it shows (default: itself)"""
        pts = [Q(*c) for c in corners]
        uv = [W.paint(Q(*(src(c) if src else c))) for c in corners]
        if n is None:
            n = np.cross(pts[1] - pts[0], pts[3] - pts[0]); n /= np.linalg.norm(n) or 1
        M.face(pts, uv, n)
    P = B.get('passage'); d0, d1 = P['d'] if P else (0, 0); hp = P['h'] if P else 0
    seen = lambda c: c                                    # the front, the right face and the top: as painted
    back = lambda c: (c[0], 1 - c[1], c[2])               # the back wears the front, the left face the right
    left = lambda c: (1 - c[0], c[1], c[2])
    def face(corners, src, outward):
        # wound so it faces outward: the viewer drops faces seen from behind, so a camera inside the masonry sees
        # through it into the passage
        pts = [Q(*c) for c in corners]; nn = np.cross(pts[1] - pts[0], pts[3] - pts[0]); nn /= np.linalg.norm(nn) or 1
        if np.dot(nn, outward) < 0: nn = -nn; corners = corners[::-1]
        quad(corners, src, nn)
    fwd, side = -n, f
    face([(0, 0, 0), (1, 0, 0), (1, 0, H), (0, 0, H)], seen, fwd)                     # front
    face([(0, 1, 0), (1, 1, 0), (1, 1, H), (0, 1, H)], back, -fwd)                    # back
    face([(0, 0, H), (1, 0, H), (1, 1, H), (0, 1, H)], seen, np.array([0, 1.0, 0]))   # top
    for tt, src, out in ((1, seen, side), (0, left, -side)):                          # the right and left faces, round the passage
        parts = [(0, d0, 0, H), (d1, 1, 0, H), (d0, d1, hp, H)] if P else [(0, 1, 0, H)]
        for a, b, y0, y1 in parts:
            if b > a: face([(tt, a, y0), (tt, b, y0), (tt, b, y1), (tt, a, y1)], src, out)
    if P:
        # inside the passage: its walls and vault in the brickwork of the painted right face beside the opening,
        # a strip of it repeated along the passage, a little darker for the shade in there
        k = max(4, int(round(np.linalg.norm(base[1] - base[0]) / 60)))
        strip = (max(0.0, d0 - 0.1), max(0.02, d0 - 0.01))
        for j in range(k):
            a, b = j / k, (j + 1) / k
            brick = lambda c, a=a: (1, strip[0] + (strip[1] - strip[0]) * (c[0] - a) * k, c[2])
            vault = lambda c, a=a: (1, strip[0] + (strip[1] - strip[0]) * (c[0] - a) * k, hp * (.55 + .4 * (c[1] - d0) / (d1 - d0)))
            face([(a, d0, 0), (b, d0, 0), (b, d0, hp), (a, d0, hp)], brick, n)
            face([(a, d1, 0), (b, d1, 0), (b, d1, hp), (a, d1, hp)], brick, -n)
            face([(a, d0, hp), (b, d0, hp), (b, d1, hp), (a, d1, hp)], vault, np.array([0, -1.0, 0]))
    # ink lines: the block's edges and the passage's mouth on each side
    for i in range(4):
        M.edge(base[i], base[(i + 1) % 4]); M.edge(top[i], top[(i + 1) % 4]); M.edge(base[i], top[i])
    if P:
        for tt in (0, 1):
            for a, b in (((tt, d0, 0), (tt, d0, hp)), ((tt, d0, hp), (tt, d1, hp)), ((tt, d1, hp), (tt, d1, 0))):
                M.edge(Q(*a), Q(*b))
    box = lambda a, b: {'kind': 'box', 'y': round(float(g), 1), 'pts': [[round(float(q[0]), 1), round(float(q[2]), 1)] for q in (Q(0, a, 0), Q(1, a, 0), Q(1, b, 0), Q(0, b, 0))]}
    M.foot = box(0, d0) if P else box(0, 1)
    # what the camera must keep out of: the masonry in front of and behind the passage, and over it
    span = lambda a, b, lo: {'pts': box(a, b)['pts'], 'y': [round(float(g + lo), 1), round(float(g + H), 1)]}
    M.solids = [span(0, d0, 0), span(d1, 1, 0), {**span(d0, d1, hp), 'axis': [round(float(f[0]), 4), round(float(f[2]), 4)]}] if P else [span(0, 1, 0)]
    rest = None
    if P:
        rest = Mesh(); rest.foot = box(d1, 1)
    return [M, rest] if rest else M

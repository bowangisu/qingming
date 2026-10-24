// The Rainbow Bridge as a paper theatre. The painting is drawn in an oblique view looking down at about 38°: a point on
// the ground at picture row v lies at depth z = (v − c) / sin θ, and a point standing y high above ground at depth z shows
// at row v = c + z·sin θ − y·cos θ. tools/make_diorama.py cuts the scene into layers that stand up at their own foot
// rows; here they are placed in 3D by those two formulas, so that seen from the painting's own direction everything
// lines up with the scroll, and any other camera gives parallax. A porter from elsewhere on the scroll walks the deck.
// The moving layer's rigs (life/rigs.json) still play on the cut-outs, and the river ripples as it does on the scroll.

const params = new URLSearchParams(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('still');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const rad = d => d * Math.PI / 180;
const $ = s => document.querySelector(s);

// ------------------------------------------------------------------------------------------------------------- GL
const VS = `#version 300 es
in float aIdx;
uniform vec3 uP[4];        // corners in world space: top-left, top-right, bottom-left, bottom-right
uniform vec2 uM[4];        // the same corners in master-scan px (or the texture's own px)
uniform mat4 uVP;
out vec2 vM;
void main() { int i = int(aIdx); vM = uM[i]; gl_Position = uVP * vec4(uP[i], 1.); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vM;
uniform int uMode;          // 0 painting, 1 soft shadow, 2 plain silk (tiled), 3 the porter's pale outline, 4 his marker
uniform float uTile;        // px per repeat of the silk swatch
uniform sampler2D uTex;
uniform vec4 uTexRect;      // the px rectangle the texture covers
uniform float uTime;
uniform float uAlpha;
uniform sampler2D uWater;   // water mask over the region
uniform vec4 uRegion;
uniform float uWaterOn;
#define MAX_RIGS 32
uniform int uRigN;
uniform vec4 uRigAll;
uniform vec4 uRigBox[MAX_RIGS];
uniform vec4 uRigUV[MAX_RIGS];
uniform vec4 uRigA[MAX_RIGS];
uniform vec4 uRigB[MAX_RIGS];
uniform sampler2D uLife;
out vec4 fragColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v / .9375; }

vec2 rigs(vec2 p, float t) {
  vec2 d = vec2(0.);
  for (int i = 0; i < MAX_RIGS; i++) {
    if (i >= uRigN) break;
    vec4 bx = uRigBox[i];
    if (p.x < bx.x || p.y < bx.y || p.x > bx.z || p.y > bx.w) continue;
    vec4 uv = uRigUV[i];
    float w = textureLod(uLife, mix(uv.xy, uv.zw, (p - bx.xy) / (bx.zw - bx.xy)), 0.).r;
    if (w < .003) continue;
    vec4 a = uRigA[i], b = uRigB[i];
    float ph = 6.2832 * a.y * t + a.z;
    vec2 o;
    if (a.x < .5) o = vec2(b.z * sin(ph), -b.w * abs(sin(ph)));
    else if (a.x < 1.5) {
      float th = radians(a.w) * sin(ph); vec2 r = p - b.xy;
      o = vec2(cos(th) * r.x - sin(th) * r.y, sin(th) * r.x + cos(th) * r.y) - r + vec2(b.z * sin(ph * .5 + 2.), b.w * sin(ph * .7 + 1.));
    } else {
      float h = clamp((b.y - p.y) / max(1., b.y - bx.y), 0., 1.); h *= h;
      float gust = .6 + .4 * sin(ph * .37 + p.x * .002);
      o = a.w * h * gust * vec2(sin(ph + p.x * .006) + .35 * sin(ph * 2.3 + p.y * .03), .15 * sin(ph * 1.7 + p.x * .01));
    }
    d += w * o;
  }
  return d;
}

void main() {
  if (uMode == 1) {
    float r = length((vM - .5) * 2.);
    float a = .34 * (1. - smoothstep(.15, 1., r)) * uAlpha;
    fragColor = vec4(0., 0., 0., a);
    return;
  }
  if (uMode == 2) { fragColor = vec4(texture(uTex, vM / uTile).rgb, 1.); return; }
  if (uMode == 3) {                     // the shadow a paper cut-out casts on what stands behind it
    vec2 sz = uTexRect.zw - uTexRect.xy, o = vec2(-7., -5.);
    float a = 0.;
    for (int i = 0; i < 8; i++) {
      float th = float(i) * .7854;
      a += texture(uTex, (vM + o + vec2(cos(th), sin(th)) * 4. - uTexRect.xy) / sz).a;
    }
    a = a / 8. * .4 * uAlpha;
    if (a < .01) discard;
    fragColor = vec4(vec3(.12, .08, .05) * a, a);
    return;
  }
  if (uMode == 4) {                     // a small cinnabar lozenge with a pale edge
    vec2 q = abs((vM - .5) * 2.);
    float d = q.x + q.y * 1.35;
    if (d > 1.) discard;
    vec3 c = d > .72 ? vec3(.97, .93, .82) : vec3(.76, .26, .17);
    fragColor = vec4(c, 1.) * uAlpha;
    return;
  }
  vec2 p = vM, d = vec2(0.);
  float t = uTime, m = 0.;
  if (uWaterOn > .5) {
    m = texture(uWater, (p - uRegion.xy) / (uRegion.zw - uRegion.xy)).r;
    if (m > .01) {
      float ph = p.x * .021 + p.y * .006 + fbm(p * .004 + t * .05) * 6.;
      d = m * vec2(sin(ph - t * 1.1) * 2.2 + sin(p.y * .09 + t * 1.7) * .9, sin(p.x * .015 + t * .8 + p.y * .03) * 1.6);
    }
  }
  bool alive = uRigN > 0 && p.x >= uRigAll.x && p.y >= uRigAll.y && p.x <= uRigAll.z && p.y <= uRigAll.w;
  vec2 q = p + d - (alive ? rigs(p, t) : vec2(0.));
  vec4 c = texture(uTex, (q - uTexRect.xy) / (uTexRect.zw - uTexRect.xy));
  if (c.a < .02) discard;
  if (m > .01) c.rgb *= 1. + m * (.045 * sin(p.x * .05 - t * 1.6 + fbm(p * .01) * 5.) + .02);
  fragColor = c * uAlpha;
}`;

function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: params.has('shot') });
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'aIdx'); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = {};
  for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(prog, i); U[a.name] = gl.getUniformLocation(prog, a.name); }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 2, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
  gl.uniform1i(U.uTex, 0); gl.uniform1i(U.uWater, 1); gl.uniform1i(U.uLife, 2);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  function texture(bmp, mip = true, wrap = gl.CLAMP_TO_EDGE) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return t;
  }
  const P = new Float32Array(12), M = new Float32Array(8);
  // one quad: corners [tl, tr, bl, br] in world space, their px coordinates, a texture and the px rect it covers
  function quad(q) {
    q.corners.forEach((c, i) => P.set(c, i * 3)); q.px.forEach((c, i) => M.set(c, i * 2));
    gl.uniform3fv(U['uP[0]'], P); gl.uniform2fv(U['uM[0]'], M);
    gl.uniform1i(U.uMode, q.mode || 0); gl.uniform1f(U.uAlpha, q.alpha ?? 1); gl.uniform1f(U.uTile, q.tile ?? 512);
    gl.uniform1f(U.uWaterOn, q.water ? 1 : 0);
    gl.uniform1i(U.uRigN, q.rigs ? state.rigN : 0);
    if (q.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, q.tex); gl.uniform4f(U.uTexRect, ...q.texRect); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const state = { rigN: 0 };
  function setRigs(rigs, atlas) {
    state.rigN = rigs.length;
    for (const [name, key] of [['uRigBox[0]', 'box'], ['uRigUV[0]', 'uv'], ['uRigA[0]', 'a'], ['uRigB[0]', 'b']]) {
      const v = new Float32Array(Math.max(1, rigs.length) * 4); rigs.forEach((r, i) => v.set(r[key], i * 4)); gl.uniform4fv(U[name], v);
    }
    const all = rigs.reduce((m, r) => [Math.min(m[0], r.box[0]), Math.min(m[1], r.box[1]), Math.max(m[2], r.box[2]), Math.max(m[3], r.box[3])], [1e9, 1e9, -1e9, -1e9]);
    gl.uniform4f(U.uRigAll, ...all);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, atlas);
  }
  return { gl, U, texture, quad, setRigs, REPEAT: gl.REPEAT };
}

// ------------------------------------------------------------------------------------------------------ matrices
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(e, t, up) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

// --------------------------------------------------------------------------------------------------------- scene
const BASE = 'assets/diorama/bridge';
let S, G, geo, tex = {}, walker, life;

function setupGeometry() {
  const th = rad(S.view), sn = Math.sin(th), cs = Math.cos(th), R = S.region, c = R[3], X0 = (R[0] + R[2]) / 2;
  const ground = (u, v) => [u - X0, 0, (v - c) / sn];
  const standing = (u, v, v0) => [u - X0, (v0 - v) / cs, (v0 - c) / sn];
  const footRow = (foot, u) => { const [[ua, va], [ub, vb]] = foot; return va + (vb - va) * (u - ua) / (ub - ua); };
  const bend = S.ground.bend ?? 230;
  const quads = [];
  // beyond the painted region: more blank silk, a wall of it behind the backdrop and a floor of it all round
  const zb = (bend - c) / sn, T = S.silk.size;
  quads.push({ name: 'sky', mode: 2, tex: 'silk', texRect: [0, 0, 1, 1], corners: [[-6000, 6000, zb - 4], [6000, 6000, zb - 4], [-6000, -2, zb - 4], [6000, -2, zb - 4]],
    px: [[-6000, -6000], [6000, -6000], [-6000, 0], [6000, 0]] });
  quads.push({ name: 'floor', mode: 2, tex: 'silk', texRect: [0, 0, 1, 1], corners: [[-6000, -2, zb - 4], [6000, -2, zb - 4], [-6000, -2, 4000], [6000, -2, 4000]],
    px: [[-6000, zb * sn], [6000, zb * sn], [-6000, 4000 * sn], [6000, 4000 * sn]] });
  // the ground, and the far bank above the bend standing up as a backdrop
  quads.push({ name: 'ground', tex: 'ground', water: true, rigs: true, texRect: R,
    px: [[R[0], bend], [R[2], bend], [R[0], R[3]], [R[2], R[3]]], corners: [ground(R[0], bend), ground(R[2], bend), ground(R[0], R[3]), ground(R[2], R[3])] });
  const top = R[1] + 18;                                  // below the scan's pale top edge
  quads.push({ name: 'backdrop', tex: 'ground', rigs: true, texRect: R,
    px: [[R[0], top], [R[2], top], [R[0], bend], [R[2], bend]], corners: [standing(R[0], top, bend), standing(R[2], top, bend), standing(R[0], bend, bend), standing(R[2], bend, bend)] });
  // the crowded left bank in standing strips, far ones first
  const strips = [];
  for (const [x0, v0, x1, v1] of S.terraces?.zones || []) {
    for (let vb = v1; vb > v0; vb -= S.terraces.step) {
      const va = Math.max(v0, vb - S.terraces.step - 6);           // a little overlap so no seam shows
      strips.push({ name: 'strip', tex: 'ground', rigs: true, water: true, texRect: R, foot: vb,
        px: [[x0, va], [x1, va], [x0, vb], [x1, vb]], corners: [standing(x0, va, vb), standing(x1, va, vb), standing(x0, vb, vb), standing(x1, vb, vb)] });
    }
  }
  strips.sort((a, b) => a.foot - b.foot);
  const layers = S.layers.map(L => {
    const [x0, y0, x1, y1] = L.bbox, f = u => footRow(L.foot, u);
    return { name: L.id, tex: L.id, rigs: true, texRect: L.bbox, rock: L.rock, foot: L.foot,
      px: [[x0, y0], [x1, y0], [x0, y1], [x1, y1]], corners: [standing(x0, y0, f(x0)), standing(x1, y0, f(x1)), standing(x0, y1, f(x0)), standing(x1, y1, f(x1))] };
  });
  // the porter's path along the deck: just behind the front railing, his feet at about the rail line
  const front = u => footRow(S.front, u), deck = S.path.deck;
  const path = S.path.rail.map(([u, vr]) => {
    const z = (front(u) - c) / sn - deck, y = Math.max(0, (c + z * sn - (vr + 2)) / cs);
    return [u - X0, y, z];
  });
  return { th, sn, cs, X0, c, ground, standing, quads, strips, layers, path, ends: S.path.ends.map(u => u - X0) };
}

function pathAt(x) {   // position on the deck at world x
  const P = geo.path;
  if (x <= P[0][0]) return P[0].slice();
  for (let i = 1; i < P.length; i++) if (x <= P[i][0]) { const t = (x - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return [x, lerp(P[i - 1][1], P[i][1], t), lerp(P[i - 1][2], P[i][2], t)]; }
  return P[P.length - 1].slice();
}

async function bitmap(url, opts = {}) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return createImageBitmap(await r.blob(), opts);
}

// ------------------------------------------------------------------------------------------------------- the walk
const W0 = { x: 0, dir: -1, vel: 0, phase: 0, swingL: 0, swingLv: 0, swingR: 0, swingRv: 0 };
const input = { left: false, right: false, wheel: 0 };
const SPEED = 78;            // world units per second, about a brisk walk at the scroll's scale

function stepWalker(dt) {
  const want = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  let target = want * SPEED;
  if (input.wheel) { target = clamp(input.wheel * 8, -SPEED * 1.6, SPEED * 1.6); input.wheel *= Math.exp(-dt * 6); if (Math.abs(input.wheel) < .5) input.wheel = 0; }
  const acc = (target - W0.vel) * (1 - Math.exp(-dt * 7));
  W0.vel += acc;
  const [lo, hi] = geo.ends;
  const nx = clamp(W0.x + W0.vel * dt, lo, hi);
  if (nx === lo || nx === hi) W0.vel *= .5;
  const moved = nx - W0.x; W0.x = nx;
  if (Math.abs(W0.vel) > 4) W0.dir = Math.sign(W0.vel);
  W0.phase += Math.abs(moved) / 34;                 // one step every 34 units
  // the baskets hang from the pole ends and swing like pendulums, pushed by the walk
  // speeding up forward, the baskets lag behind; each step rocks them a little, one against the other
  const kick = acc / Math.max(dt, 1e-3) * .0009 * W0.dir, gait = Math.abs(W0.vel) / SPEED * .05 * Math.sin(W0.phase * Math.PI);
  for (const k of ['L', 'R']) {
    const a = 'swing' + k, v = a + 'v';
    W0[v] += (-W0[a] * 26 - W0[v] * 2.6 + (kick + gait * (k === 'L' ? 1 : -1)) * 26) * dt;
    W0[a] = clamp(W0[a] + W0[v] * dt, -.35, .35);
  }
}

// the porter as three pieces, each a billboard turned to face the camera
function walkerQuads(yaw, t) {
  const pos = pathAt(W0.x), sc = S.walker.scale, [fx, fy] = S.walker.feet;
  const speed = Math.abs(W0.vel) / SPEED, flip = W0.dir > 0 ? -1 : 1;  // drawn walking left; mirrored to walk right
  const s = Math.sin(W0.phase * Math.PI);
  const bob = (REDUCED ? 0 : Math.abs(s) * 5 * speed) + (REDUCED ? 0 : Math.sin(t * 1.7) * .6 * (1 - speed));
  const tilt = rad((REDUCED ? 0 : s * 2.6 * speed) + 3.5 * speed);   // puppet space faces left: lean that way
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);       // the camera's right, flattened
  // puppet space: source px relative to the feet, y up; body turns about the feet
  const body = (x, y) => { const c = Math.cos(tilt), sn = Math.sin(tilt); return [x * c - y * sn, x * sn + y * c + bob / sc]; };
  const toWorld = ([x, y]) => [pos[0] + rx * x * sc * flip, pos[1] + y * sc, pos[2] + rz * x * sc * flip];
  const out = [{ mode: 1, alpha: 1, corners: shadow(pos), px: [[0, 0], [1, 0], [0, 1], [1, 1]], texRect: [0, 0, 1, 1] }];
  const rims = [];
  for (const P of S.walker.pieces) {
    const [x0, y0, x1, y1] = P.box, g = 7;       // the rim quad reaches a little past the piece
    let pts = [[x0 - g, y0 - g], [x1 + g, y0 - g], [x0 - g, y1 + g], [x1 + g, y1 + g]].map(([x, y]) => [x - fx, fy - y]);
    if (P.pivot) {
      const sw = P.id.endsWith('left') ? W0.swingL : W0.swingR, px = P.pivot[0] - fx, py = fy - P.pivot[1], c = Math.cos(sw), sn = Math.sin(sw);
      pts = pts.map(([x, y]) => [px + (x - px) * c - (y - py) * sn, py + (x - px) * sn + (y - py) * c]);
    }
    const q = { tex: 'w-' + P.id, texRect: P.box, px: [[x0 - g, y0 - g], [x1 + g, y0 - g], [x0 - g, y1 + g], [x1 + g, y1 + g]], corners: pts.map(p => toWorld(body(...p))) };
    out.push(q); rims.push({ ...q, mode: 3, corners: q.corners.map(([x, y, z]) => [x - Math.sin(yaw) * 6, y, z - Math.cos(yaw) * 6]) });
  }
  // a small marker over his head, bobbing a little
  const hy = fy - S.walker.pieces[0].box[1] + 34 + (REDUCED ? 0 : Math.sin(t * 2.4) * 3), m = 7;
  const mk = toWorld(body(0, hy));
  const marker = { mode: 4, px: [[0, 0], [1, 0], [0, 1], [1, 1]], texRect: [0, 0, 1, 1],
    corners: [[mk[0] - rx * m, mk[1] + m * 1.3, mk[2] - rz * m], [mk[0] + rx * m, mk[1] + m * 1.3, mk[2] + rz * m], [mk[0] - rx * m, mk[1] - m * 1.3, mk[2] - rz * m], [mk[0] + rx * m, mk[1] - m * 1.3, mk[2] + rz * m]] };
  // shadow, rims, then the baskets (they hang behind the body from this side of the pole), the body, the marker
  return [out[0], ...rims, out[2], out[3], out[1], marker];
}
function shadow(pos) {
  const w = 34, d = 12, y = pos[1] + .6;
  return [[pos[0] - w, y, pos[2] - d], [pos[0] + w, y, pos[2] - d], [pos[0] - w, y, pos[2] + d], [pos[0] + w, y, pos[2] + d]];
}

// --------------------------------------------------------------------------------------------------------- camera
// p: 0 = the painting as painted (a long lens from far away, nearly flat); 1 = following the porter from out in front
// of the stage, over the near rooftops, like watching a paper theatre from the stalls. The scene is deep (the bridge
// stands 900–1450 units behind the roofs), so the camera keeps its distance and the parallax comes from moving along.
const cam = { p: 0, pTarget: 1, dragYaw: 0, dragPitch: 0, dist: 1, tx: 0, ty: 0, tz: 0, snap: true, userFlat: false };
const STALLS = 160;          // the camera's depth (world z) when following: just in front of the nearest roofs
function camera(aspect, dt) {
  const e = ease(clamp(cam.p, 0, 1));
  const pos = pathAt(W0.x);
  const overview = [lerp(geo.ends[0], geo.ends[1], .5), 220, -1050];
  const follow = [pos[0] + W0.dir * 40, pos[1] + 30, pos[2]];
  const tgt = overview.map((v, i) => lerp(v, follow[i], e));
  const k = cam.snap ? 1 : 1 - Math.exp(-dt * 5);
  cam.tx += (tgt[0] - cam.tx) * k; cam.ty += (tgt[1] - cam.ty) * k; cam.tz += (tgt[2] - cam.tz) * k;
  cam.snap = false;
  const yaw = rad(cam.dragYaw * e + (REDUCED ? 0 : -W0.dir * 4 * Math.min(1, Math.abs(W0.vel) / SPEED) * e));
  const pitch = geo.th + rad(cam.dragPitch * e);
  const frameFollow = (aspect < 1 ? 560 : 470) * cam.dist;          // world units visible at the porter
  const dFollow = Math.max(500, (STALLS - cam.tz) / (Math.cos(pitch) * Math.cos(yaw)));
  const fovFollow = 2 * Math.atan(frameFollow / 2 / dFollow);
  const frameAll = aspect < 1 ? 1650 / aspect * .7 : Math.max(1050, 2050 / aspect);
  const fov = Math.exp(lerp(Math.log(rad(.35)), Math.log(fovFollow), e));     // from nearly orthographic, as painted
  const D = lerp(frameAll, frameFollow, e) / 2 / Math.tan(fov / 2);
  const eye = [cam.tx + D * Math.sin(yaw) * Math.cos(pitch), cam.ty + D * Math.sin(pitch), cam.tz + D * Math.cos(yaw) * Math.cos(pitch)];
  const vp = mul(perspective(fov, aspect, Math.max(10, D - 2800), D + 7000), lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]));
  return { vp, yaw, eye };
}

// ---------------------------------------------------------------------------------------------------------- frame
let canvas, last = 0, t0 = 0;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
}
function rockCorners(q, t) {
  if (!q.rock || REDUCED) return q.corners;
  const [pu, pv] = q.rock.pivot, f = u => { const [[ua, va], [ub, vb]] = q.foot; return va + (vb - va) * (u - ua) / (ub - ua); };
  const P = geo.standing(pu, pv, f(pu)), a = rad(q.rock.deg) * Math.sin(t * 6.2832 * q.rock.hz), heave = q.rock.heave * Math.sin(t * 6.2832 * q.rock.hz * .7 + 1);
  return q.corners.map(([x, y, z]) => { const dx = x - P[0], dy = y - P[1]; return [P[0] + dx * Math.cos(a) - dy * Math.sin(a), P[1] + dx * Math.sin(a) + dy * Math.cos(a) + heave, z]; });
}
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  if (!window.__dio.manual) render(dt, window.__dio.time ?? (REDUCED ? 9 : (now - t0) / 1000));
  requestAnimationFrame(frame);
}
function render(dt, t) {
  stepWalker(dt);
  if (!REDUCED) cam.p += (cam.pTarget - cam.p) * (1 - Math.exp(-dt * 1.1)) + Math.sign(cam.pTarget - cam.p) * dt * .05;
  else cam.p = cam.pTarget;
  cam.p = clamp(cam.p, 0, 1);
  const { gl, U } = G;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(26 / 255, 21 / 255, 17 / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const { vp, yaw } = camera(canvas.width / canvas.height, dt);
  gl.uniformMatrix4fv(U.uVP, false, new Float32Array(vp));
  gl.uniform1f(U.uTime, t);
  const draw = q => G.quad({ ...q, corners: rockCorners(q, t), tex: tex[q.tex] });
  // back to front: ground, backdrop, the standing street, the bridge's far side, the porter, the bridge's front, the rest
  for (const q of geo.quads) draw(q);
  for (const q of geo.strips) draw(q);
  const byId = Object.fromEntries(geo.layers.map(l => [l.name, l]));
  draw(byId['bridge-back']); draw(byId.underside);
  const [shade, ...pieces] = walkerQuads(yaw, t);
  gl.depthMask(false); G.quad(shade); gl.depthMask(true);
  for (const q of pieces) G.quad({ ...q, tex: tex[q.tex] });
  for (const L of geo.layers) if (L.name !== 'bridge-back' && L.name !== 'underside') draw(L);
  window.__dio.state = { x: W0.x, u: W0.x + geo.X0, dir: W0.dir, vel: W0.vel, p: cam.p, yaw: cam.dragYaw, pitch: cam.dragPitch };
  $('#where').style.setProperty('--at', `${(W0.x - geo.ends[0]) / (geo.ends[1] - geo.ends[0]) * 100}%`);
  document.body.classList.toggle('flat', cam.pTarget === 0);
}

// ---------------------------------------------------------------------------------------------------------- input
function bindInput() {
  const keys = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
  addEventListener('keydown', e => { if (keys[e.key]) { input[keys[e.key]] = true; e.preventDefault(); stepIn(); } });
  addEventListener('keyup', e => { if (keys[e.key]) input[keys[e.key]] = false; });
  addEventListener('blur', () => { input.left = input.right = false; });
  addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) { cam.dist = clamp(cam.dist * Math.exp(e.deltaY * .004), .6, 2.2); return; }
    input.wheel = clamp(input.wheel - (e.deltaY + e.deltaX) * .06, -25, 25);    // scrolling down reads on, to the left
    stepIn();
  }, { passive: false });
  // drag to look around a little
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: cam.dragYaw, pitch: cam.dragPitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.dragYaw = clamp(drag.yaw - (e.clientX - drag.x) * .12, -22, 22);
    cam.dragPitch = clamp(drag.pitch + (e.clientY - drag.y) * .08, -12, 3);
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  // hold-to-walk buttons
  for (const [sel, k] of [['#walk-left', 'left'], ['#walk-right', 'right']]) {
    const b = $(sel);
    b.addEventListener('pointerdown', e => { e.preventDefault(); input[k] = true; b.setPointerCapture(e.pointerId); stepIn(); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { input[k] = false; });
  }
  $('#flat').addEventListener('click', () => {
    cam.pTarget = cam.pTarget ? 0 : 1; cam.userFlat = !cam.pTarget; cam.dragYaw = cam.dragPitch = 0;
    $('#flat').textContent = cam.pTarget ? 'See it as painted' : 'Step back in';
  });
  $('#about-btn').addEventListener('click', () => { const a = $('#about'); a.hidden = !a.hidden; $('#about-btn').setAttribute('aria-expanded', String(!a.hidden)); });
}
function stepIn() { if (!cam.userFlat) cam.pTarget = 1; }

// ---------------------------------------------------------------------------------------------------------- start
async function start() {
  window.__dio = { ready: false };
  canvas = $('#gl');
  try { G = createGL(canvas); } catch (e) { $('#loader p').textContent = 'This needs WebGL 2, which this browser does not provide. A recent Chrome, Edge, Firefox or Safari will show it.'; return; }
  S = await (await fetch(`${BASE}/scene.json`)).json();
  geo = setupGeometry();
  const pre = { premultiplyAlpha: 'premultiply' }, raw = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const jobs = [['ground', `${BASE}/${S.ground.file}`, pre], ['water', `${BASE}/${S.water}`, raw], ['silk', `${BASE}/${S.silk.file}`, pre],
    ...S.layers.map(L => [L.id, `${BASE}/${L.file}`, pre]), ...S.walker.pieces.map(P => ['w-' + P.id, `${BASE}/${P.file}`, pre])];
  const bmps = await Promise.all(jobs.map(([, u, o]) => bitmap(u, o)));
  jobs.forEach(([k], i) => { tex[k] = G.texture(bmps[i], k !== 'water', k === 'silk' ? G.REPEAT : undefined); });
  G.gl.activeTexture(G.gl.TEXTURE1); G.gl.bindTexture(G.gl.TEXTURE_2D, tex.water);
  G.gl.uniform4f(G.U.uRegion, ...S.region);
  // the moving layer's rigs that fall in this scene (not the big boat: here the whole cut-out rocks instead)
  try {
    const lj = await (await fetch('assets/life.json')).json();
    const [r0, , r1] = S.region;
    const rigs = lj.rigs.filter(r => r.box[2] > r0 && r.box[0] < r1 && r.id !== 'bridge-boat').slice(0, 32);
    G.setRigs(rigs, G.texture(await bitmap(`assets/${lj.atlas}`, raw), false));
  } catch (e) { console.warn('no moving layer', e); }
  W0.x = clamp(19980 - geo.X0, ...geo.ends);
  resize(); addEventListener('resize', resize);
  bindInput();
  // open on the scene as painted, then step into it
  cam.p = cam.pTarget = 0;
  if (params.has('flat')) { cam.userFlat = true; $('#flat').textContent = 'Step back in'; }
  else setTimeout(stepIn, REDUCED ? 0 : 1400);
  Object.assign(window.__dio, {
    ready: true, geo,
    // recordings: __dio.manual = true stops the clock; tick(dt, t, {left, right}) then draws one frame
    tick: (dt, t, keys = {}) => { input.left = !!keys.left; input.right = !!keys.right; render(dt, t); },
    debug: () => { const c = camera(canvas.width / canvas.height, 0); return { pos: pathAt(W0.x), vp: c.vp, eye: c.eye, quads: walkerQuads(c.yaw, 0).map(q => q.corners), tex: Object.keys(tex) }; },
    set: o => { if ('u' in o) W0.x = clamp(o.u - geo.X0, ...geo.ends); if ('dir' in o) W0.dir = o.dir; if ('p' in o) cam.p = cam.pTarget = o.p; if ('yaw' in o) cam.dragYaw = o.yaw; if ('pitch' in o) cam.dragPitch = o.pitch; if ('vel' in o) W0.vel = o.vel; if ('phase' in o) W0.phase = o.phase; cam.snap = true; },
  });
  requestAnimationFrame(now => { last = t0 = now; document.body.classList.add('ready'); frame(now); });
}
start();

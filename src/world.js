// The Rainbow Bridge rebuilt in 3D, as a small world you can walk round. The painting is read as an oblique view of
// that world (tools/make_world.py): a point (X, Y, Z) is painted at u = X + a·Z, v = c − s·Z − Y, with the river at
// Y = 0 and the banks raised to Y = bank. So the river and the banks need no texture of their own: every fragment of
// them looks up the painting at its own painted position, and seen from the painter's direction the ground is the
// scroll exactly. Where the painting shows something that is rebuilt here (the bridge) or a strip it never shows
// (the water behind a bank), the ground is filled with the painting's blank water or silk in the tone around it.
// The bridge is a designed arch whose faces are the painted bridge, stretched between its curves; the porter is a
// cut-out that always turns to face you. The scene opens as the painting, flat, and lifts into 3D.

const params = new URLSearchParams(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('still');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const rad = d => d * Math.PI / 180;
const $ = s => document.querySelector(s);
const BASE = 'assets/world/bridge';

// ------------------------------------------------------------------------------------------------------- shaders
const VS = `#version 300 es
in vec3 aPos; in vec2 aUV; in vec3 aNrm;
uniform mat4 uVP, uModel;
out vec3 vPos; out vec2 vUV; out vec3 vNrm;
void main() {
  vec4 p = uModel * vec4(aPos, 1.);
  vPos = p.xyz; vUV = aUV; vNrm = mat3(uModel) * aNrm; gl_Position = uVP * p;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec2 vUV; in vec3 vNrm;
uniform int uMode;        // 0 river, 1 bank, 2 revetment, 3 textured mesh, 4 cut-out, 5 soft shadow, 6 marker, 7 flat colour,
                          // 8 the painting, flat, 9 painted surface (vUV holds the painting px it shows)
uniform vec3 uMap;        // a, s, c
uniform vec4 uRegion;     // the painting px the paint texture covers
uniform sampler2D uPaint, uMasks, uTone, uSilk, uWater, uTex;
uniform vec2 uSilkSize, uWaterSize;
uniform vec3 uEye, uHome; // the camera; the direction back toward the painter's own view
uniform vec3 uMist;
uniform vec4 uFog;        // distance fog start, end; fade round the scene's centre, start, end
uniform vec2 uCenter;
uniform float uTime, uAlpha, uShade;
uniform vec4 uColor;
out vec4 fragColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v / .9375; }

vec2 painted(vec3 p) { return vec2(p.x + uMap.x * p.z, uMap.z - uMap.y * p.z - p.y); }
vec2 inRegion(vec2 q) { return (q - uRegion.xy) / (uRegion.zw - uRegion.xy); }
vec3 tone(vec2 uv, float land) {      // the tone texture holds the water's tone above the land's
  return texture(uTone, vec2(uv.x, clamp(uv.y, .004, .996) * .5 + land * .5)).rgb;
}
vec3 weave(sampler2D t, vec2 q, vec2 size) { return texture(t, q / size).rgb * 2.; }

float light(vec3 n) {                 // a soft wash: faces turned from the light a little darker, never black
  n = normalize(n);
  return .84 + .16 * clamp(dot(n, normalize(vec3(.35, .8, -.55))) * .5 + .5, 0., 1.);
}
vec3 mist(vec3 col, float a) {
  float d = length(uEye - vPos);
  float f = max(smoothstep(uFog.x, uFog.y, d), smoothstep(uFog.z, uFog.w, length(vPos.xz - uCenter)));
  return mix(col, uMist * a, f);
}

void main() {
  vec3 col; float a = 1.;
  if (uMode <= 2) {
    vec2 q = painted(vPos);
    float n = 0.;
    if (uMode == 0) {                 // the painted water lines sway a little
      n = fbm(q * .004 + uTime * .05);
      float ph = q.x * .021 + q.y * .006 + n * 6.;
      q += vec2(sin(ph - uTime * 1.1) * 2. + sin(q.y * .09 + uTime * 1.7) * .8, sin(q.x * .015 + uTime * .8 + q.y * .03) * 1.4);
    }
    vec2 uv = inRegion(q);
    bool inside = uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.;
    vec2 out2 = max(uRegion.xy - q, q - uRegion.zw);
    float beyond = smoothstep(0., 260., max(max(out2.x, out2.y), 0.));    // past the painting's edge, into mist
    vec4 m = inside ? texture(uMasks, uv) : vec4(0.);
    vec3 paint = texture(uPaint, uv).rgb;
    if (uMode == 0) {
      vec3 fill = weave(uWater, q, uWaterSize) * tone(uv, 0.);
      col = mix(fill, paint, m.r);
      col *= 1. + .03 * sin(q.x * .05 - uTime * 1.6 + n * 9.);
    } else if (uMode == 1) {
      vec3 fill = weave(uSilk, q, uSilkSize) * tone(uv, 1.);
      // things standing up that are only painted on the ground fade, seen from far round the side
      float side = 1. - smoothstep(.78, .95, dot(normalize(uEye - vPos), uHome));
      col = mix(fill, paint, m.g * (1. - side * (.45 + .5 * m.a)));
    } else {
      // the revetment: as painted where the painter could see it, timber where he could not
      vec3 base = tone(uv, 1.) * (.8 + .1 * fbm(vUV * vec2(.01, .05)));
      float wob = fbm(vec2(vUV.x * .02, vPos.y * .05)) * 3.;
      float plank = smoothstep(.86, 1., abs(fract((vPos.y + wob) / 18.) - .5) * 2.) * (.5 + .5 * noise(vec2(vUV.x * .03, floor(vPos.y / 18.))));
      float post = smoothstep(.9, 1., abs(fract(vUV.x / 110.) - .5) * 2.);
      float wet = 1. - smoothstep(0., 22., vPos.y);
      vec3 timber = base * weave(uSilk, vUV * vec2(1., 1.6), uSilkSize) * (1. - .16 * wet);
      timber = mix(timber, vec3(.3, .24, .18), max(plank * .3, post * .38));
      float seen = smoothstep(.1, .45, dot(normalize(vNrm), uHome));
      col = mix(timber, mix(weave(uSilk, q, uSilkSize) * tone(uv, 1.), paint, m.g), seen * float(inside));
    }
    col = mix(col, uMist, beyond * .92);
  } else if (uMode == 3) {
    vec4 c = texture(uTex, vUV);
    if (c.a < .5) discard;
    col = c.rgb / max(c.a, 1e-3) * uShade * light(vNrm);
  } else if (uMode == 4) {
    vec4 c = texture(uTex, vUV);
    if (c.a < .01) discard;
    fragColor = vec4(mist(c.rgb, c.a), c.a) * uAlpha;
    return;
  } else if (uMode == 5) {
    float r = length((vUV - .5) * 2.);
    float s = .3 * (1. - smoothstep(.15, 1., r)) * uAlpha;
    fragColor = vec4(0., 0., 0., s);
    return;
  } else if (uMode == 6) {
    vec2 q = abs((vUV - .5) * 2.);
    float d = q.x + q.y * 1.35;
    if (d > 1.) discard;
    fragColor = vec4(d > .72 ? vec3(.97, .93, .82) : vec3(.76, .26, .17), 1.) * uAlpha;
    return;
  } else if (uMode == 7) {
    col = uColor.rgb * (.82 + .18 * clamp(dot(normalize(vNrm), normalize(vec3(.3, 1., -.4))), 0., 1.));
  } else if (uMode == 9) {
    col = texture(uPaint, inRegion(vUV)).rgb * uShade * light(vNrm) * (1. - .14 * (1. - smoothstep(0., 16., vPos.y)));
  } else {
    vec2 q = painted(vPos), uv = inRegion(q);
    if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) discard;
    // its edges, and the scan's pale top edge, melt into the mist round it
    vec2 e = min(q - uRegion.xy - vec2(0., 24.), uRegion.zw - q);
    float k = smoothstep(0., 120., min(e.x, e.y));
    fragColor = vec4(mix(uMist, texture(uPaint, uv).rgb, k), 1.) * uAlpha;
    return;
  }
  fragColor = vec4(mist(col, 1.), 1.);
}`;

// ------------------------------------------------------------------------------------------------------------ GL
function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: params.has('shot') });
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aUV'); gl.bindAttribLocation(prog, 2, 'aNrm');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = {};
  for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(prog, i); U[a.name] = gl.getUniformLocation(prog, a.name); }
  ['uPaint', 'uMasks', 'uTone', 'uSilk', 'uWater', 'uTex'].forEach((k, i) => gl.uniform1i(U[k], i));
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  function texture(bmp, { mip = true, repeat = false } = {}) {
    const t = gl.createTexture(), wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext && mip) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }
  // a mesh: interleaved x y z u v nx ny nz, and triangle indices
  function mesh(verts, idx, dynamic = false) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    for (const [loc, n, off] of [[0, 3, 0], [1, 2, 12], [2, 3, 20]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 32, off); }
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vb, n: idx.length };
  }
  const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function draw(m, o = {}) {
    gl.uniform1i(U.uMode, o.mode ?? 3); gl.uniform1f(U.uAlpha, o.alpha ?? 1); gl.uniform1f(U.uShade, o.shade ?? 1);
    gl.uniformMatrix4fv(U.uModel, false, o.model || I4);
    if (o.color) gl.uniform4fv(U.uColor, o.color);
    if (o.tex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, o.tex); }
    gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
  }
  // one quad with its corners given each frame: tl, tr, bl, br
  const quadVerts = new Float32Array(32);
  const quadMesh = mesh(new Array(32).fill(0), [0, 2, 1, 1, 2, 3], true);
  function quad(corners, o = {}, uv = [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    corners.forEach((c, i) => { quadVerts.set(c, i * 8); quadVerts.set(uv[i], i * 8 + 3); quadVerts.set([0, 1, 0], i * 8 + 5); });
    gl.bindBuffer(gl.ARRAY_BUFFER, quadMesh.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVerts);
    draw(quadMesh, { mode: 4, ...o });
  }
  return { gl, U, texture, mesh, draw, quad };
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
function apply(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w];
}
// the world's Z runs away from the painter, which makes it left-handed: mirror the picture so east stays on the right
const FLIP = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ---------------------------------------------------------------------------------------------------- geometry
// ear clipping for the banks' outlines (small polygons, no holes)
function triangulate(pts) {
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const idx = pts.map((_, i) => i); if (area < 0) idx.reverse();
  const out = [], cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const A = pts[ia], B = pts[ib], C = pts[ic];
      if (cross(A, B, C) <= 0) continue;
      if (idx.some(j => j !== ia && j !== ib && j !== ic && inTri(pts[j], A, B, C))) continue;
      out.push(ia, ib, ic); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(...idx);
  return out;
}

let S, G, tex = {}, world;

function buildWorld() {
  const B = S.bank, riv = S.river;
  // the river's two edges, carried on straight past the outline so the banks reach the mist
  const south = [[12000, riv[0][1] + 60], ...riv.slice(0, 12), [27000, riv[11][1] + 10]];
  const north = [[27000, riv[12][1]], ...riv.slice(12), [12000, riv[19][1] + 40]];
  const far = 7000, flat = (pts, y, nrm = [0, 1, 0]) => pts.flatMap(([x, z]) => [x, y, z, 0, 0, ...nrm]);
  const southLand = [[12000, -far], [27000, -far], ...south.slice().reverse()];
  const northLand = [[27000, 2000 + far], [12000, 2000 + far], ...north.slice().reverse()];
  const water = G.mesh(flat([[12000, -far], [27000, -far], [27000, 2000 + far], [12000, 2000 + far]], 0), [0, 1, 2, 0, 2, 3]);
  const banks = [southLand, northLand].map(p => G.mesh(flat(p, B), triangulate(p)));
  // the revetments: from the water up to the bank, facing the river
  const wv = [], wi = [];
  for (const edge of [south, north]) {
    let run = 0;
    for (let i = 0; i + 1 < edge.length; i++) {
      const [x0, z0] = edge[i], [x1, z1] = edge[i + 1], l = Math.hypot(x1 - x0, z1 - z0), n = [-(z1 - z0) / l, 0, (x1 - x0) / l];
      const k = wv.length / 8;
      wv.push(x0, 0, z0, run, 0, ...n, x1, 0, z1, run + l, 0, ...n, x0, B, z0, run, B, ...n, x1, B, z1, run + l, B, ...n);
      wi.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); run += l;
    }
  }
  const walls = G.mesh(wv, wi);
  const bridge = buildBridge();
  const boat = S.boat ? buildBoat() : null;
  // the painting, lying on the water: what the scene opens on, and fades from
  const R = S.region, { a, s, c } = S.map, ground = (u, v) => { const z = (c - v) / s; return [u - a * z, 0, z]; };
  const sheet = G.mesh([ground(R[0], R[1]), ground(R[2], R[1]), ground(R[0], R[3]), ground(R[2], R[3])].flatMap(p => [...p, 0, 0, 0, 1, 0]), [0, 2, 1, 1, 2, 3]);
  return { water, banks, walls, bridge, boat, sheet };
}

// the bridge: an arch between two feet on the river's edge. Stations run along the chord from the south foot; the
// front face is the one the painter saw, the back face stands a deck's width behind it
function bridgeShape() {
  const Bd = S.bridge, [[ax, az], [bx, bz]] = Bd.feet, L = Bd.L;
  const b = [(bx - ax) / L, (bz - az) / L], n = [b[1], -b[0]];       // along; out of the front face, toward the painter
  const sinp = s => Math.sin(Math.PI * clamp(s / L, 0, 1));
  const deck = s => S.bank + Bd.rise * sinp(s) ** Bd.deck_power;
  const soffit = s => Bd.soffit * sinp(s) ** Bd.soffit_power;
  const at = (s, off, y) => [ax + b[0] * s - n[0] * off, y, az + b[1] * s - n[1] * off];
  return { L, b, n, W: Bd.width, rail: Bd.rail, deck, soffit, at };
}

function buildBridge() {
  const sh = bridgeShape(), { L, W, rail, deck, soffit, at, n } = sh, N = 300;
  const face = S.bridge.face.size, Hh = face[1];
  const ss = Array.from({ length: N + 1 }, (_, i) => L * i / N);
  const len = f => { let d = 0; return ss.map((s, i) => (i ? (d += Math.hypot(s - ss[i - 1], f(s) - f(ss[i - 1]))) : 0)); };
  const dLen = len(deck), sLen = len(soffit), sTot = sLen[N];
  const strip = (rows) => {            // rows: per station, [bottom vertex, top vertex] as [pos, uv, nrm]
    const v = [], i = [];
    rows.forEach(([lo, hi], k) => {
      v.push(...lo[0], ...lo[1], ...lo[2], ...hi[0], ...hi[1], ...hi[2]);
      if (k) { const q = (k - 1) * 2; i.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    });
    return G.mesh(v, i);
  };
  const fn = [n[0], 0, n[1]], bn = [-n[0], 0, -n[1]];
  const faceRows = off => ss.map(s => {
    const y0 = soffit(s), y1 = deck(s) + rail, u = s / face[0];
    return [[at(s, off, y0), [u, (Hh - y0) / Hh], off ? bn : fn], [at(s, off, y1), [u, (Hh - y1) / Hh], off ? bn : fn]];
  });
  const front = strip(faceRows(0)), back = strip(faceRows(W));
  const deckTop = strip(ss.map((s, k) => [[at(s, 0, deck(s)), [dLen[k] / 512, 0], [0, 1, 0]], [at(s, W, deck(s)), [dLen[k] / 512, 1], [0, 1, 0]]]));
  const under = strip(ss.map((s, k) => [[at(s, 0, soffit(s)), [sLen[k] / sTot, 0], [0, -1, 0]], [at(s, W, soffit(s)), [sLen[k] / sTot, 1], [0, -1, 0]]]));
  const cap = off => strip(ss.map(s => [[at(s, off - 3, deck(s) + rail), [0, 0], [0, 1, 0]], [at(s, off + 3, deck(s) + rail), [0, 0], [0, 1, 0]]]));
  return { sh, front, back, deckTop, under, caps: [cap(0), cap(W)] };
}

// the boat: a hull standing on its painted waterline with the painted gunwale above it, a deck, a cabin with a
// rounded roof, a mast. Every vertex carries the painting px it shows: where the painter could see a surface, the px it
// is painted at; on the far side, which he could not, the px of the matching point on the near side, mirrored
function buildBoat() {
  const Bt = S.boat, { a, s, c } = S.map, N = 56;
  const at = (pts, u) => {
    if (u <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (u - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
    return pts[pts.length - 1][1];
  };
  const u0 = Bt.waterline[0][0], u1 = Bt.waterline[Bt.waterline.length - 1][0];
  const st = Array.from({ length: N + 1 }, (_, k) => {
    const t = k / N, u = lerp(u0, u1, t), vw = at(Bt.waterline, u), z = (c - vw) / s;
    return { t, x: u - a * z, z, h: vw - at(Bt.gunwale, u) };
  });
  const ax = [st[N].x - st[0].x, st[N].z - st[0].z], al = Math.hypot(...ax), axis = [ax[0] / al, ax[1] / al];
  const perp = [-axis[1], axis[0]];                                  // across the boat, away from the painter
  const beam = t => Bt.beam * (.62 + .38 * Math.sin(Math.PI * clamp(t * .92 + .04, 0, 1)) ** .5);
  const P = (k, w, y) => [st[k].x + perp[0] * w, y, st[k].z + perp[1] * w];
  const paintAt = p => [p[0] + a * p[2], c - s * p[2] - p[1]];
  const near = (k, w, y) => paintAt(P(k, Math.min(w, beam(st[k].t) - w), Math.max(0, y)));   // mirrored to the near side
  const V = [], I = [];
  const vert = (p, uv, n) => { V.push(...p, ...uv, ...n); return V.length / 8 - 1; };
  const grid = (rows, cols, f) => {      // f(i, j) -> [pos, uv, nrm]; a quad mesh rows × cols
    const base = V.length / 8;
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) { const [p, uv, n] = f(i, j); vert(p, uv, n); }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const q = base + i * (cols + 1) + j; I.push(q, q + cols + 1, q + 1, q + 1, q + cols + 1, q + cols + 2);
    }
  };
  const nNear = [-perp[0], 0, -perp[1]], nFar = [perp[0], 0, perp[1]], up = [0, 1, 0];
  // the hull's sides: the near one as painted, the far one wearing it mirrored
  grid(N, 1, (k, j) => { const y = j ? st[k].h : -8; return [P(k, 0, y), paintAt(P(k, 0, Math.max(0, y))), nNear]; });
  grid(N, 1, (k, j) => { const y = j ? st[k].h : -8, w = beam(st[k].t); return [P(k, w, y), near(k, w, y), nFar]; });
  // the deck, a little below the gunwale, seen from above as painted
  grid(N, 6, (k, j) => { const w = beam(st[k].t) * j / 6, p = P(k, w, st[k].h - 4); return [p, paintAt(p), up]; });
  // the cabin: walls a little in from the sides, and a rounded roof
  const C = Bt.cabin, ka = Math.round(C.from * N), kb = Math.round(C.to * N), M = 10;
  const roofY = (k, f) => st[k].h + C.wall + C.arch * Math.sin(Math.PI * f);
  grid(kb - ka, 1, (i, j) => { const k = ka + i, p = P(k, C.inset, j ? st[k].h + C.wall : st[k].h - 4); return [p, paintAt(p), nNear]; });
  grid(kb - ka, 1, (i, j) => { const k = ka + i, w = beam(st[k].t) - C.inset, y = j ? st[k].h + C.wall : st[k].h - 4; return [P(k, w, y), near(k, w, y), nFar]; });
  grid(kb - ka, M, (i, j) => {
    const k = ka + i, f = j / M, w = lerp(C.inset, beam(st[k].t) - C.inset, f), p = P(k, w, roofY(k, f));
    const n = [-perp[0] * Math.cos(Math.PI * f), Math.sin(Math.PI * f) + .3, -perp[1] * Math.cos(Math.PI * f)];
    // the roof's far half, sloping away from the painter, wears its near half
    const g = Math.min(f, 1 - f), q = P(k, lerp(C.inset, beam(st[k].t) - C.inset, g), roofY(k, g));
    return [p, paintAt(q), n];
  });
  // the ends, which the painter saw only edge-on: dressed in the near side's planks just round the corner from them
  const round = (k, w, inward) => clamp(Math.round(k + inward * 7 * w), 0, N);
  for (const k of [ka, kb]) grid(1, M, (i, j) => {
    const f = j / M, w = lerp(C.inset, beam(st[k].t) - C.inset, f), y = i ? roofY(k, f) : st[k].h - 4, p = P(k, w, y);
    const kk = round(k, f, k === kb ? -1 : 1);
    return [p, paintAt(P(kk, C.inset, i ? st[kk].h + C.wall : st[kk].h - 4)), [axis[0] * (k === kb ? 1 : -1), 0, axis[1] * (k === kb ? 1 : -1)]];
  });
  for (const k of [0, N]) grid(4, 6, (i, j) => {
    const w = beam(st[k].t) * j / 6, f = i / 4, p = P(k, w, lerp(-8, st[k].h, f)), kk = round(k, j / 6, k ? -1 : 1);
    return [p, paintAt(P(kk, 0, f * st[kk].h)), [axis[0] * (k ? 1 : -1), 0, axis[1] * (k ? 1 : -1)]];
  });
  const mesh = G.mesh(V, I);
  // the mast, leaning back toward the stern as the crew lower it, and its stays
  const km = Math.round(Bt.mast.at * N), mb = P(km, beam(st[km].t) / 2, st[km].h - 4), lean = rad(Bt.mast.lean);
  const mt = [mb[0] + axis[0] * Math.sin(lean) * Bt.mast.height, mb[1] + Math.cos(lean) * Bt.mast.height, mb[2] + axis[1] * Math.sin(lean) * Bt.mast.height];
  const mv = [], mi = [], R0 = 3.2, R1 = 1.5, SEG = 8;
  const dir = [mt[0] - mb[0], mt[1] - mb[1], mt[2] - mb[2]];
  for (let j = 0; j <= SEG; j++) {
    const th = j / SEG * Math.PI * 2, ox = Math.cos(th), oz = Math.sin(th);
    for (const [q, r] of [[mb, R0], [mt, R1]]) mv.push(q[0] + ox * r, q[1], q[2] + oz * r, 0, 0, ox, 0, oz);
    if (j) { const b = (j - 1) * 2; mi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const mast = G.mesh(mv, mi);
  const stays = [P(0, beam(0) / 2, st[0].h), P(N, beam(1) / 2, st[N].h), P(km - 9, 0, st[km - 9].h), P(km - 9, beam(st[km - 9].t), st[km - 9].h),
    P(Math.min(N, km + 12), 0, st[Math.min(N, km + 12)].h), P(Math.min(N, km + 12), beam(st[Math.min(N, km + 12)].t), st[Math.min(N, km + 12)].h)];
  const mid = P(N >> 1, beam(.5) / 2, 0);
  return { mesh, mast, top: mt, stays, mid, axis, perp, st, beam, P, len: al };
}

function rotAxis(ax, th) {           // a 4×4 rotation about the unit axis ax
  const [x, y, z] = ax, c = Math.cos(th), s = Math.sin(th), t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
}
function translate(v) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]; }
function boatModel(t) {
  const b = world.boat, R = S.boat.rock, w = 6.2832 * R.hz * t;
  if (REDUCED) return null;
  const roll = rad(R.roll) * Math.sin(w), pitch = rad(R.pitch) * Math.sin(w * .73 + 1.3), heave = R.heave * Math.sin(w * .61 + .4);
  const c = b.mid;
  return mul(translate([c[0], c[1] + heave, c[2]]), mul(rotAxis([b.perp[0], 0, b.perp[1]], pitch), mul(rotAxis([b.axis[0], 0, b.axis[1]], roll), translate([-c[0], -c[1], -c[2]]))));
}

// people crossing the bridge: cut-outs from elsewhere on the scroll, strolling one way or the other
const crowd = [];
function setupCrowd() {
  const people = S.crowd.people, L = world.bridge.sh.L, rnd = mulberry(11);
  for (let i = 0; i < 11; i++) {
    const fig = people[i % people.length];
    crowd.push({ fig, s: lerp(-OFF, L + OFF, (i + rnd() * .6) / 11), w: lerp(.18, .82, rnd()), v: (14 + rnd() * 12) * (rnd() < .5 ? -1 : 1),
      phase: rnd() * 10, h: S.crowd.height * (.9 + rnd() * .16), pause: 0 });
  }
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function stepCrowd(dt) {
  const L = world.bridge.sh.L, lo = -OFF - 40, hi = L + OFF + 40;
  for (const p of crowd) {
    if (REDUCED) continue;
    // keep a step's distance from the porter
    const ds = p.s - P0.s, dw = (p.w - .5) * world.bridge.sh.W;
    const near = Math.abs(ds) < 34 && Math.abs(dw) < 40 && Math.sign(p.v) === -Math.sign(ds || 1);
    const v = near ? p.v * .15 : p.v;
    p.s += v * dt; p.phase += Math.abs(v) * dt / 22;
    if (p.s > hi) p.s = lo; if (p.s < lo) p.s = hi;
  }
}
function crowdQuads(view) {
  const sh = world.bridge.sh, right = view.right, out = [];
  for (const p of crowd) {
    const F = p.fig, y = p.s > 0 && p.s < sh.L ? sh.deck(p.s) : S.bank, pos = sh.at(p.s, sh.W * p.w, y);
    const sc = p.h / (F.feet[1] - F.top);
    const screenDir = (sh.b[0] * right[0] + sh.b[1] * right[2]) * Math.sign(p.v);
    const facesRight = F.faces === 'right', flip = (screenDir > 0) === facesRight ? 1 : -1;
    const bob = REDUCED ? 0 : Math.abs(Math.sin(p.phase * Math.PI)) * 1.6;
    const [x0, y0, x1, y1] = F.box, fx = F.feet[0], fy = F.feet[1];
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, yy]) => {
      const dx = (x - fx) * sc * flip, dy = (fy - yy) * sc + bob;
      return [pos[0] + right[0] * dx, pos[1] + dy, pos[2] + right[2] * dx];
    });
    // fade in and out at the ends of the walk, where they come and go
    const L = sh.L, edge = Math.min(p.s + OFF + 40, L + OFF + 40 - p.s);
    out.push({ tex: 'c-' + F.id, corners, alpha: clamp(edge / 60, 0, 1), pos });
  }
  return out;
}

async function bitmap(url, opts = {}) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return createImageBitmap(await r.blob(), opts);
}

// --------------------------------------------------------------------------------------------------- the porter
const P0 = { s: 0, dir: 1, vel: 0, phase: 0, swingL: 0, swingLv: 0, swingR: 0, swingRv: 0 };
const input = { fwd: 0, keys: new Set(), hold: 0 };
const SPEED = 80;
const OFF = 160;               // how far past each end of the bridge he may walk, onto the banks

function porterAt(s) {
  const sh = world.bridge.sh, y = s > 0 && s < sh.L ? sh.deck(s) : S.bank;
  return sh.at(s, sh.W / 2, y);
}

function stepPorter(dt, want) {
  const acc = (want * SPEED - P0.vel) * (1 - Math.exp(-dt * 7));
  P0.vel += acc;
  const L = world.bridge.sh.L, ns = clamp(P0.s + P0.vel * dt, -OFF, L + OFF);
  if (ns === -OFF || ns === L + OFF) P0.vel *= .5;
  const moved = ns - P0.s; P0.s = ns;
  if (Math.abs(P0.vel) > 4) P0.dir = Math.sign(P0.vel);
  P0.phase += Math.abs(moved) / 30;
  const kick = acc / Math.max(dt, 1e-3) * .0009, gait = Math.abs(P0.vel) / SPEED * .05 * Math.sin(P0.phase * Math.PI);
  for (const k of ['L', 'R']) {
    const a = 'swing' + k, v = a + 'v';
    P0[v] += (-P0[a] * 26 - P0[v] * 2.6 + (kick + gait * (k === 'L' ? 1 : -1)) * 26) * dt;
    P0[a] = clamp(P0[a] + P0[v] * dt, -.35, .35);
  }
}

// the porter as three pieces turned to face the camera; drawn walking left, mirrored when he walks to screen right
function porterQuads(view, t) {
  const pos = porterAt(P0.s), Wk = S.walker, [fx, fy] = Wk.feet;
  const sc = Wk.height / (fy - Wk.pieces[0].box[1]);
  const right = view.right, along = world.bridge.sh.b;
  const screenDir = (along[0] * right[0] + along[1] * right[2]) * P0.dir;
  const flip = screenDir > 0 ? -1 : 1, speed = Math.abs(P0.vel) / SPEED, s = Math.sin(P0.phase * Math.PI);
  const bob = REDUCED ? 0 : Math.abs(s) * 4 * speed + Math.sin(t * 1.7) * .5 * (1 - speed);
  const tilt = rad((REDUCED ? 0 : s * 2.6 * speed) + 3.5 * speed);
  const body = (x, y) => { const c = Math.cos(tilt), sn = Math.sin(tilt); return [x * c - y * sn, x * sn + y * c + bob / sc]; };
  const toWorld = ([x, y]) => [pos[0] + right[0] * x * sc * flip, pos[1] + y * sc, pos[2] + right[2] * x * sc * flip];
  const quads = [];
  for (const P of Wk.pieces) {
    const [x0, y0, x1, y1] = P.box;
    let pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [x - fx, fy - y]);
    if (P.pivot) {
      const sw = P.id.endsWith('left') ? P0.swingL : P0.swingR, px = P.pivot[0] - fx, py = fy - P.pivot[1], c = Math.cos(sw), sn = Math.sin(sw);
      pts = pts.map(([x, y]) => [px + (x - px) * c - (y - py) * sn, py + (x - px) * sn + (y - py) * c]);
    }
    quads.push({ tex: 'w-' + P.id, corners: pts.map(p => toWorld(body(...p))) });
  }
  const hy = fy - Wk.pieces[0].box[1] + 40 + (REDUCED ? 0 : Math.sin(t * 2.4) * 3), m = 6;
  const mk = toWorld(body(0, hy));
  const marker = [[mk[0] - right[0] * m, mk[1] + m * 1.3, mk[2] - right[2] * m], [mk[0] + right[0] * m, mk[1] + m * 1.3, mk[2] + right[2] * m],
    [mk[0] - right[0] * m, mk[1] - m * 1.3, mk[2] - right[2] * m], [mk[0] + right[0] * m, mk[1] - m * 1.3, mk[2] + right[2] * m]];
  const w = 26, d = 12, b = along, nn = [b[1], -b[0]], y = pos[1] + .8;
  const shadow = [[pos[0] - b[0] * w - nn[0] * d, y, pos[2] - b[1] * w - nn[1] * d], [pos[0] + b[0] * w - nn[0] * d, y, pos[2] + b[1] * w - nn[1] * d],
    [pos[0] - b[0] * w + nn[0] * d, y, pos[2] - b[1] * w + nn[1] * d], [pos[0] + b[0] * w + nn[0] * d, y, pos[2] + b[1] * w + nn[1] * d]];
  return { shadow, pieces: [quads[1], quads[2], quads[0]], marker };
}

// --------------------------------------------------------------------------------------------------------- camera
// p = 0 is the painting as painted: the camera far off along the painter's own line of sight with a very long lens,
// and a shear that turns its picture into the scroll's oblique one. p = 1 is free: orbiting the porter, any way round.
const cam = { p: 0, pTarget: 0, yaw: 0, pitch: rad(30), dist: 720, tx: 0, ty: 0, tz: 0, snap: true, held: false };
let HOME;
function homeFrame(aspect) {
  // the stretch of painting that fills the screen when it opens: the bridge and the boat, a little of each bank
  const cu = 19560, cv = 560, hh = aspect < 1 ? 760 / aspect : Math.max(560, 1150 / aspect);
  return { cu, cv, hh, hw: hh * aspect };
}
function viewAt(p, aspect, target) {
  const e = ease(clamp(p, 0, 1)), H = HOME;
  const fovOrbit = rad(aspect < 1 ? 50 : 38);
  const fov = Math.exp(lerp(Math.log(rad(.5)), Math.log(fovOrbit), e));
  let dy = cam.yaw - H.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const yaw = H.yaw + dy * e, pitch = lerp(H.pitch, cam.pitch, e);
  // what's in frame at the target: from the painting's framing to the orbit's
  const hf = homeFrame(aspect), frameHome = 2 * hf.hh * Math.cos(H.pitch);
  const frame = Math.exp(lerp(Math.log(frameHome), Math.log(2 * cam.dist * Math.tan(fovOrbit / 2)), e));
  const D = frame / 2 / Math.tan(fov / 2);
  const tgt = [0, 1, 2].map(i => lerp(H.target(target)[i], target[i], e));
  const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const eye = tgt.map((v, i) => v + dir[i] * D);
  const near = Math.max(8, D - 6000), farv = D + 9000;
  let vp = mul(FLIP, mul(perspective(fov, aspect, near, farv), lookAt(eye, tgt, [0, 1, 0])));
  if (e < 1) {
    // the shear: three points as this camera sees them, and as the painting has them
    const Q = shear(vp, tgt, hf);
    const k = 1 - e, A = [lerp(1, Q[0], k), lerp(0, Q[1], k), lerp(0, Q[2], k), lerp(0, Q[3], k), lerp(1, Q[4], k), lerp(0, Q[5], k)];
    const M = [A[0], A[3], 0, 0, A[1], A[4], 0, 0, 0, 0, 1, 0, A[2], A[5], 0, 1];
    vp = mul(M, vp);
  }
  return { vp, eye, yaw, pitch, right: [Math.cos(yaw), 0, Math.sin(yaw)], fov };
}
function shear(vp, tgt, hf) {
  const { a, s, c } = S.map;
  const pts = [tgt, [tgt[0] + 500, tgt[1], tgt[2]], [tgt[0], tgt[1] + 500, tgt[2]]];
  const src = pts.map(p => apply(vp, p));
  const dst = pts.map(([x, y, z]) => [(x + a * z - hf.cu) / hf.hw, -(c - s * z - y - hf.cv) / hf.hh]);
  // solve [x' y'] = A [x y 1] for the 2×3 A
  const [[x1, y1], [x2, y2], [x3, y3]] = src, det = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2);
  const inv = [[(y2 - y3), (y3 - y1), (y1 - y2)], [(x3 - x2), (x1 - x3), (x2 - x1)], [(x2 * y3 - x3 * y2), (x3 * y1 - x1 * y3), (x1 * y2 - x2 * y1)]].map(r => r.map(v => v / det));
  const row = k => [0, 1, 2].map(j => inv[j][0] * dst[0][k] + inv[j][1] * dst[1][k] + inv[j][2] * dst[2][k]);
  const r0 = row(0), r1 = row(1);
  return [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2]];
}
function setupHome() {
  const { a, s } = S.map, d = [a, s, -1], l = Math.hypot(...d), h = d.map(v => v / l);
  HOME = {
    dir: h, yaw: Math.atan2(h[0], -h[2]), pitch: Math.asin(h[1]),
    // the painting's centre is a line of world points along the painter's sight; take the one nearest the target
    target(t) {
      const hf = homeFrame(innerWidth / innerHeight), { c } = S.map, z0 = (c - hf.cv) / s, p0 = [hf.cu - a * z0, 0, z0];
      const k = (t[0] - p0[0]) * h[0] + (t[1] - p0[1]) * h[1] + (t[2] - p0[2]) * h[2];
      return p0.map((v, i) => v + h[i] * k);
    },
  };
  cam.yaw = HOME.yaw; cam.pitch = rad(28);
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
// a rope: a thin ribbon between two points, turned to face the camera
function rope(a, b, view, color, w = 1.3) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], m = [(a[0] + b[0]) / 2 - view.eye[0], (a[1] + b[1]) / 2 - view.eye[1], (a[2] + b[2]) / 2 - view.eye[2]];
  let n = [d[1] * m[2] - d[2] * m[1], d[2] * m[0] - d[0] * m[2], d[0] * m[1] - d[1] * m[0]];
  const l = Math.hypot(...n) || 1; n = n.map(v => v / l * w);
  G.quad([[a[0] - n[0], a[1] - n[1], a[2] - n[2]], [a[0] + n[0], a[1] + n[1], a[2] + n[2]], [b[0] - n[0], b[1] - n[1], b[2] - n[2]], [b[0] + n[0], b[1] + n[1], b[2] + n[2]]], { mode: 7, color });
}

// ---------------------------------------------------------------------------------------------------------- frame
let canvas, last = 0, t0 = 0;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
}
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  if (!window.__world.manual) render(dt, window.__world.time ?? (REDUCED ? 9 : (now - t0) / 1000));
  requestAnimationFrame(frame);
}
function walkIntent(view) {
  // arrow keys and buttons mean directions on the screen; the porter takes whichever way along the bridge is closer
  const b = world.bridge.sh.b, r = view.right, f = [-Math.sin(view.yaw), Math.cos(view.yaw)];
  const scr = b[0] * r[0] + b[1] * r[2], fwd = b[0] * f[0] + b[1] * f[1];
  let x = 0, y = 0;
  for (const k of input.keys) { if (k === 'left') x -= 1; if (k === 'right') x += 1; if (k === 'up') y += 1; if (k === 'down') y -= 1; }
  x += input.hold;
  // looking along the bridge, right and left mean on and back (away from you, toward you); across it, up and down do
  const sx = Math.abs(scr) > .3 ? scr : Math.sign(fwd || 1) * .8, sy = Math.abs(fwd) > .3 ? fwd : Math.sign(scr || 1) * .8;
  const v = x * sx + y * sy;
  return Math.abs(v) < .15 ? 0 : Math.sign(v);
}
function render(dt, t) {
  const aspect = canvas.width / canvas.height;
  if (!REDUCED) cam.p += (cam.pTarget - cam.p) * (1 - Math.exp(-dt * 1.2)) + Math.sign(cam.pTarget - cam.p) * dt * .04;
  else cam.p = cam.pTarget;
  cam.p = clamp(cam.p, 0, 1);
  const pos = porterAt(P0.s), tgt = cam.focus || [pos[0] + world.bridge.sh.b[0] * P0.dir * 30, pos[1] + 34, pos[2] + world.bridge.sh.b[1] * P0.dir * 30];
  const k = cam.snap ? 1 : 1 - Math.exp(-dt * 4);
  cam.tx += (tgt[0] - cam.tx) * k; cam.ty += (tgt[1] - cam.ty) * k; cam.tz += (tgt[2] - cam.tz) * k; cam.snap = false;
  const view = viewAt(cam.p, aspect, [cam.tx, cam.ty, cam.tz]);
  stepPorter(dt, cam.p > .6 ? walkIntent(view) : 0);

  const { gl, U } = G;
  gl.viewport(0, 0, canvas.width, canvas.height);
  const mistC = S.silk.tone.map(v => Math.min(1, v / 255 * 1.16));
  gl.clearColor(...mistC, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(U.uVP, false, new Float32Array(view.vp));
  gl.uniform1f(U.uTime, t);
  gl.uniform3fv(U.uEye, view.eye); gl.uniform3fv(U.uMist, mistC);
  const fogEnd = 2600 + cam.dist * 1.2, e = ease(cam.p);
  gl.uniform4f(U.uFog, lerp(1e6, 900 + cam.dist * .6, e), lerp(2e6, fogEnd, e), lerp(1e6, 1500, e), lerp(2e6, 2900, e));
  // the ground
  G.draw(world.water, { mode: 0 });
  for (const m of world.banks) G.draw(m, { mode: 1 });
  G.draw(world.walls, { mode: 2 });
  // the bridge
  const Bm = world.bridge;
  G.draw(Bm.front, { tex: tex.face, shade: 1 }); G.draw(Bm.back, { tex: tex.face, shade: .9 });
  G.draw(Bm.deckTop, { tex: tex.deck, shade: 1 }); G.draw(Bm.under, { tex: tex.soffit, shade: .78 });
  for (const c of Bm.caps) G.draw(c, { mode: 7, color: [.22, .17, .12, 1] });
  // the boat, rocking a little
  if (world.boat) {
    const model = boatModel(t), Bo = world.boat;
    G.draw(Bo.mesh, { mode: 9, model, shade: 1 });
    G.draw(Bo.mast, { mode: 7, model, color: [.36, .29, .21, 1] });
    const mvp = model ? p => { const q = model; return [q[0] * p[0] + q[4] * p[1] + q[8] * p[2] + q[12], q[1] * p[0] + q[5] * p[1] + q[9] * p[2] + q[13], q[2] * p[0] + q[6] * p[1] + q[10] * p[2] + q[14]]; } : p => p;
    const top = mvp(Bo.top);
    for (const st of Bo.stays) rope(top, mvp(st), view, [.34, .28, .21, 1], .75);
  }
  // the people: crowd and porter, far ones first
  stepCrowd(dt);
  const pq = porterQuads(view, t);
  gl.depthMask(false);
  G.quad(pq.shadow, { mode: 5, alpha: e });
  const sprites = crowdQuads(view).map(q => ({ ...q, d: dist2(q.pos, view.eye) }));
  sprites.push({ porter: true, d: dist2(porterAt(P0.s), view.eye) });
  sprites.sort((a, b) => b.d - a.d);
  for (const q of sprites) {
    if (q.porter) { for (const pc of pq.pieces) G.quad(pc.corners, { tex: tex[pc.tex], alpha: 1 }); }
    else G.quad(q.corners, { tex: tex[q.tex], alpha: q.alpha });
  }
  gl.depthMask(true);
  G.quad(pq.marker, { mode: 6, alpha: e });
  // the painting itself, over everything while the scene opens
  const flatA = 1 - clamp((cam.p - .02) / .28, 0, 1);
  if (flatA > 0) { gl.disable(gl.DEPTH_TEST); G.draw(world.sheet, { mode: 8, alpha: flatA }); gl.enable(gl.DEPTH_TEST); }

  window.__world.state = { s: P0.s, dir: P0.dir, vel: P0.vel, p: cam.p, yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
  $('#where').style.setProperty('--at', `${(P0.s + OFF) / (world.bridge.sh.L + 2 * OFF) * 100}%`);
  document.body.classList.toggle('flat', cam.pTarget === 0);
}

// ---------------------------------------------------------------------------------------------------------- input
function bindInput() {
  const keys = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
  addEventListener('keydown', e => { if (keys[e.key]) { input.keys.add(keys[e.key]); e.preventDefault(); stepIn(); } });
  addEventListener('keyup', e => { if (keys[e.key]) input.keys.delete(keys[e.key]); });
  addEventListener('blur', () => { input.keys.clear(); input.hold = 0; });
  addEventListener('wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * (e.ctrlKey ? .01 : .0015)), 240, 2000); stepIn(); }, { passive: false });
  // drag to go round; two fingers to come closer or stand back
  const pts = new Map(); let drag = null, pinch = null;
  canvas.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture(e.pointerId); stepIn();
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: cam.dist }; drag = null; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; cam.dist = clamp(pinch.dist * pinch.d / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])), 240, 2000); return; }
    if (!drag) return;
    const kx = 5.5 / Math.max(innerWidth, 600);
    cam.yaw = drag.yaw - (e.clientX - drag.x) * kx;
    cam.pitch = clamp(drag.pitch + (e.clientY - drag.y) * kx * .8, rad(7), rad(72));
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  for (const [sel, k] of [['#walk-left', -1], ['#walk-right', 1]]) {
    const b = $(sel);
    b.addEventListener('pointerdown', e => { e.preventDefault(); input.hold = k; b.setPointerCapture(e.pointerId); stepIn(); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { input.hold = 0; });
  }
  $('#flat').addEventListener('click', () => {
    cam.held = cam.pTarget === 1; cam.pTarget = cam.held ? 0 : 1;
    $('#flat').textContent = cam.pTarget ? 'See it as painted' : 'Step back in';
  });
  $('#about-btn').addEventListener('click', () => { const a = $('#about'); a.hidden = !a.hidden; $('#about-btn').setAttribute('aria-expanded', String(!a.hidden)); });
}
function stepIn() { if (!cam.held) cam.pTarget = 1; }

// ---------------------------------------------------------------------------------------------------------- start
async function start() {
  window.__world = { ready: false };
  canvas = $('#gl');
  try { G = createGL(canvas); } catch (e) { $('#loader p').textContent = 'This needs WebGL 2, which this browser does not provide. A recent Chrome, Edge, Firefox or Safari will show it.'; console.error(e); return; }
  S = await (await fetch(`${BASE}/scene.json`)).json();
  const pre = { premultiplyAlpha: 'premultiply' }, raw = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const jobs = [['paint', S.paint.file, pre, {}], ['masks', S.masks.file, raw, {}], ['tone', S.tone.file, raw, { mip: false }],
    ['silk', S.silk.file, pre, { repeat: true }], ['water', S.water.file, pre, { repeat: true }],
    ['face', S.bridge.face.file, pre, {}], ['soffit', S.bridge.soffit_tex.file, pre, { repeat: true }], ['deck', S.bridge.deck_tex.file, pre, { repeat: true }],
    ...S.walker.pieces.map(P => ['w-' + P.id, P.file, pre, {}]), ...(S.crowd?.people || []).map(C => ['c-' + C.id, C.file, pre, {}])];
  const bmps = await Promise.all(jobs.map(([, f, o]) => bitmap(`${BASE}/${f}`, o)));
  jobs.forEach(([k, , , o], i) => { tex[k] = G.texture(bmps[i], o); });
  const { gl, U } = G;
  ['paint', 'masks', 'tone', 'silk', 'water'].forEach((k, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[k]); });
  gl.uniform3f(U.uMap, S.map.a, S.map.s, S.map.c); gl.uniform4f(U.uRegion, ...S.region);
  gl.uniform2f(U.uSilkSize, ...S.silk.size); gl.uniform2f(U.uWaterSize, ...S.water.size);
  world = buildWorld();
  setupHome();
  gl.uniform3fv(U.uHome, HOME.dir);
  const mid = world.bridge.sh.at(world.bridge.sh.L / 2, 0, 0);
  gl.uniform2f(U.uCenter, mid[0], mid[2]);
  P0.s = world.bridge.sh.L * .22;
  if (S.crowd) setupCrowd();
  resize(); addEventListener('resize', resize);
  bindInput();
  if (params.has('flat')) { cam.held = true; $('#flat').textContent = 'Step back in'; }
  else setTimeout(stepIn, REDUCED ? 0 : 1500);
  Object.assign(window.__world, {
    ready: true,
    // recordings: __world.manual = true stops the clock; tick(dt, t, keys) then draws one frame
    tick: (dt, t, keys = []) => { input.keys = new Set(keys); render(dt, t); },
    set: o => {
      if ('s' in o) P0.s = o.s; if ('dir' in o) P0.dir = o.dir; if ('p' in o) cam.p = cam.pTarget = o.p;
      if ('yaw' in o) cam.yaw = HOME.yaw + rad(o.yaw); if ('pitch' in o) cam.pitch = rad(o.pitch); if ('dist' in o) cam.dist = o.dist;
      if ('vel' in o) P0.vel = o.vel; if ('phase' in o) P0.phase = o.phase; if ('focus' in o) cam.focus = o.focus; cam.snap = true;
    },
    info: () => ({ L: world.bridge.sh.L, home: { yaw: HOME.yaw * 180 / Math.PI, pitch: HOME.pitch * 180 / Math.PI }, boat: world.boat && { mid: world.boat.mid, n: world.boat.mesh.n, st0: world.boat.st[0], stN: world.boat.st[world.boat.st.length - 1], top: world.boat.top } }),
  });
  requestAnimationFrame(now => { last = t0 = now; document.body.classList.add('ready'); frame(now); });
}
start();

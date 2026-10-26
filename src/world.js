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
uniform int uLine;          // 1: an ink line, a ribbon a few px wide: aPos one end, aNrm the other, aUV.x the side
uniform vec2 uViewport;     // half the canvas, px
uniform float uLineW;
out vec3 vPos; out vec2 vUV; out vec3 vNrm;
void main() {
  vec4 p = uModel * vec4(aPos, 1.);
  vPos = p.xyz; vUV = aUV; vNrm = mat3(uModel) * aNrm;
  vec4 c = uVP * p;
  if (uLine == 1) {
    vec4 c1 = uVP * (uModel * vec4(aNrm, 1.));
    vec2 a = c.xy / c.w * uViewport, b = c1.xy / c1.w * uViewport;
    vec2 d = normalize(b - a + vec2(1e-4, 0.));
    c.xy += vec2(-d.y, d.x) * aUV.x * uLineW / uViewport * c.w;
    c.z -= .0008 * c.w;                 // just in front of the surface it outlines
  }
  gl_Position = c;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec2 vUV; in vec3 vNrm;
uniform int uMode;        // 0 river, 1 bank, 2 revetment, 3 textured mesh, 4 cut-out, 5 soft shadow, 6 marker, 7 flat colour,
                          // 8 the painting, flat, 9 painted surface (vUV holds the painting px it shows), 10 painted post
uniform vec3 uMap;        // a, s, c
uniform vec4 uRegion;     // the painting px the paint texture covers
uniform sampler2D uPaint, uMasks, uTone, uSilk, uWater, uTex, uPaint2;   // the painting in two halves
uniform vec2 uSilkSize, uWaterSize;
uniform vec3 uEye, uHome; // the camera; the direction back toward the painter's own view
uniform vec3 uMist;
uniform vec4 uFog;        // distance fog start, end; fade round the scene's centre, start, end
uniform vec2 uCenter;
uniform float uTime, uAlpha, uShade;
uniform vec4 uColor;
uniform sampler2D uRefl;  // the scene mirrored in the water's plane, at half size
uniform float uReflK;
uniform vec2 uViewport;
out vec4 fragColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v / .9375; }

vec2 painted(vec3 p) { return vec2(p.x + uMap.x * p.z, uMap.z - uMap.y * p.z - p.y); }
vec2 inRegion(vec2 q) { return (q - uRegion.xy) / (uRegion.zw - uRegion.xy); }
vec3 paintAt(vec2 uv) {             // both halves sampled, so mip levels stay right across the seam
  vec2 a = vec2(uv.x * 2., uv.y), b = vec2(uv.x * 2. - 1., uv.y);
  return mix(texture(uPaint, a).rgb, texture(uPaint2, b).rgb, step(.5, uv.x));
}
vec3 tone(vec2 uv, float land) {      // the tone texture holds the water's tone above the land's
  return texture(uTone, vec2(uv.x, clamp(uv.y, .004, .996) * .5 + land * .5)).rgb;
}
vec3 weave(sampler2D t, vec2 q, vec2 size) { return texture(t, q / size).rgb * 2.; }

float light(vec3 n) {                 // a soft wash: faces turned from the light a little darker, never black
  n = normalize(n);
  return .84 + .16 * clamp(dot(n, normalize(vec3(.35, .8, -.55))) * .5 + .5, 0., 1.);
}
float fogf() {
  return max(smoothstep(uFog.x, uFog.y, length(uEye - vPos)), smoothstep(uFog.z, uFog.w, length(vPos.xz - uCenter)));
}
vec3 mist(vec3 col, float a) { return mix(col, uMist * a, fogf()); }

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
    vec3 paint = paintAt(uv);
    if (uMode == 0) {
      vec3 fill = weave(uWater, q, uWaterSize) * tone(uv, 0.);
      col = mix(fill, paint, m.r);
      col *= 1. + .03 * sin(q.x * .05 - uTime * 1.6 + n * 9.);
      if (uReflK > 0.) {                // what stands over the water, mirrored in it and broken up by the ripples
        vec2 su = gl_FragCoord.xy / (uViewport * 2.);
        su += vec2(sin(q.y * .045 + uTime * 1.3 + n * 4.) * .004, sin(q.x * .02 + uTime * .9) * .0015);
        vec4 r = texture(uRefl, su);
        col = mix(col, mix(col, r.rgb / max(r.a, 1e-3), .75), r.a * uReflK);
      }
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
  } else if (uMode == 5) {          // a soft round shadow
    float r = length((vUV - .5) * 2.);
    float s = .3 * (1. - smoothstep(.15, 1., r)) * uAlpha * (1. - fogf());
    fragColor = vec4(0., 0., 0., s);
    return;
  } else if (uMode == 12) {         // a soft shadow under a footprint, darkest inside it, fading out past its edges
    vec2 e = min(vUV, 1. - vUV);
    float s = .26 * smoothstep(0., .32, e.x) * smoothstep(0., .32, e.y) * uAlpha * (1. - fogf());
    fragColor = vec4(0., 0., 0., s);
    return;
  } else if (uMode == 13) {         // an ink line: soft at its sides, its weight wavering along it like a brush
    float k = (1. - smoothstep(.3, 1., abs(vUV.x))) * (.55 + .45 * noise(vec2(vUV.y * .035, 7.))) * uAlpha * (1. - fogf());
    fragColor = vec4(uColor.rgb * k, k);
    return;
  } else if (uMode == 6) {
    vec2 q = abs((vUV - .5) * 2.);
    float d = q.x + q.y * 1.35;
    if (d > 1.) discard;
    fragColor = vec4(d > .72 ? vec3(.97, .93, .82) : vec3(.76, .26, .17), 1.) * uAlpha;
    return;
  } else if (uMode == 7) {
    col = uColor.rgb * (.82 + .18 * clamp(dot(normalize(vNrm), normalize(vec3(.3, 1., -.4))), 0., 1.));
  } else if (uMode == 10) {          // a post: the painting along it, darkened toward timber
    vec3 p = paintAt(inRegion(vUV));
    col = mix(p * .9, uColor.rgb, .18) * light(vNrm);
  } else if (uMode == 9) {
    vec2 uv = inRegion(vUV);
    vec2 o = max(uRegion.xy - vUV, vUV - uRegion.zw);
    float beyondPx = max(max(o.x, o.y), 0.);
    float past = smoothstep(0., 6., beyondPx);                               // beyond the painting: its blank silk,
    col = mix(paintAt(uv), weave(uSilk, vUV, uSilkSize) * tone(uv, 1.), past);
    col *= uShade * light(vNrm) * (1. - .14 * (1. - smoothstep(0., 16., vPos.y)));
    col = mix(col, uMist, smoothstep(0., 160., beyondPx) * .92);              // then mist, as the ground does there
  } else {
    vec2 q = painted(vPos), uv = inRegion(q);
    if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) discard;
    // its edges, and the scan's pale top edge, melt into the mist round it
    vec2 e = min(q - uRegion.xy - vec2(0., 24.), uRegion.zw - q);
    float k = smoothstep(0., 120., min(e.x, e.y));
    fragColor = vec4(mix(uMist, paintAt(uv), k), 1.) * uAlpha;
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
  ['uPaint', 'uMasks', 'uTone', 'uSilk', 'uWater', 'uTex', 'uPaint2', 'uRefl'].forEach((k, i) => gl.uniform1i(U[k], i));
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
    gl.uniform1i(U.uLine, o.line ? 1 : 0);
    if (o.color) gl.uniform4fv(U.uColor, o.color);
    if (o.tex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, o.tex); }
    gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, o.count ?? m.n, gl.UNSIGNED_INT, 0);
  }
  // many quads in one draw (shadows): items of { corners: [tl, tr, bl, br], uv? }
  let cap = 0, bm = null, bv = null;
  function batch(items, o = {}) {
    if (!items.length) return;
    if (items.length > cap) {
      cap = Math.max(256, items.length * 2);
      const idx = []; for (let i = 0; i < cap; i++) idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
      bm = mesh(new Array(cap * 32).fill(0), idx, true); bv = new Float32Array(cap * 32);
    }
    const uv0 = [[0, 0], [1, 0], [0, 1], [1, 1]];
    items.forEach((q, k) => (q.corners).forEach((c, i) => { const j = (k * 4 + i) * 8; bv.set(c, j); bv.set((q.uv || uv0)[i], j + 3); bv.set([0, 1, 0], j + 5); }));
    gl.bindBuffer(gl.ARRAY_BUFFER, bm.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, bv, 0, items.length * 32);
    draw(bm, { ...o, count: items.length * 6 });
  }
  // ink lines: segments [[a, b], ...] become ribbons the vertex shader widens on screen
  function lines(segs) {
    const v = [], idx = []; let along = 0;
    for (const [a, b] of segs) {
      const k = v.length / 8, l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      v.push(...a, -1, along, ...b, ...a, 1, along, ...b, ...b, 1, along + l, ...a, ...b, -1, along + l, ...a);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3); along += l;
    }
    return mesh(v, idx);
  }
  // an offscreen picture (the reflection), with its own depth
  function target(w, h, old) {
    if (old) { gl.deleteTexture(old.t); gl.deleteRenderbuffer(old.rb); gl.deleteFramebuffer(old.fb); }
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t);   // its own unit
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, rb, fb, w, h };
  }
  // one quad with its corners given each frame: tl, tr, bl, br
  const quadVerts = new Float32Array(32);
  const quadMesh = mesh(new Array(32).fill(0), [0, 2, 1, 1, 2, 3], true);
  function quad(corners, o = {}, uv = [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    corners.forEach((c, i) => { quadVerts.set(c, i * 8); quadVerts.set(uv[i], i * 8 + 3); quadVerts.set([0, 1, 0], i * 8 + 5); });
    gl.bindBuffer(gl.ARRAY_BUFFER, quadMesh.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVerts);
    draw(quadMesh, { mode: 4, ...o });
  }
  return { gl, U, texture, mesh, draw, quad, batch, lines, target };
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
  // the outline runs east along the near (south) edge to its easternmost point, then back west along the far edge
  const k = riv.reduce((m, p, i) => (p[0] > riv[m][0] ? i : m), 0) + 1, last = riv.length - 1;
  const south = [[12000, riv[0][1] + 60], ...riv.slice(0, k), [27000, riv[k - 1][1] + 10]];
  const north = [[27000, riv[k][1]], ...riv.slice(k), [12000, riv[last][1] + 40]];
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
  const boat = S.boat ? buildBoat(S.boat) : null;
  const boats = (S.boats || []).map((Bt, i) => ({ ...buildBoat(Bt), spec: Bt, phase: i * 2.1 + 1 }));
  // houses, sheds, awnings, umbrellas: painted meshes from the bake, and their plain timbers
  const models = (S.models || []).map(Md => {
    const n = Md.pos.length / 3, v = [];
    for (let i = 0; i < n; i++) v.push(Md.pos[i * 3], Md.pos[i * 3 + 1], Md.pos[i * 3 + 2], Md.uv[i * 2], Md.uv[i * 2 + 1], Md.nrm[i * 3], Md.nrm[i * 3 + 1], Md.nrm[i * 3 + 2]);
    const out = { id: Md.id, shade: Md.shade, mesh: n ? G.mesh(v, Md.idx) : null };
    if (Md.plain) {
      const P = Md.plain, m = P.pos.length / 3, w = [];
      for (let i = 0; i < m; i++) w.push(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2], P.uv[i * 2], P.uv[i * 2 + 1], P.nrm[i * 3], P.nrm[i * 3 + 1], P.nrm[i * 3 + 2]);
      out.plain = G.mesh(w, P.idx); out.color = [...P.color, 1];
    }
    return out;
  });
  const modelSegs = [];
  for (const Md of S.models || []) for (let i = 0; i + 6 <= (Md.edges || []).length; i += 6) modelSegs.push([Md.edges.slice(i, i + 3), Md.edges.slice(i + 3, i + 6)]);
  const modelLines = modelSegs.length ? G.lines(modelSegs) : null;
  // the soft shadows under them: a footprint grown past its edges, or a disc under an umbrella
  const boxShades = [], discShades = [];
  for (const Md of S.models || []) {
    const f = Md.foot; if (!f) continue;
    const y = f.y + .7;
    if (f.kind === 'disc') { const [cx, cz] = f.c, r = f.r * 1.05; discShades.push({ corners: [[cx - r, y, cz - r], [cx + r, y, cz - r], [cx - r, y, cz + r], [cx + r, y, cz + r]] }); continue; }
    const c = f.pts.reduce((m, q) => [m[0] + q[0] / 4, m[1] + q[1] / 4], [0, 0]);
    const grow = q => { const dx = q[0] - c[0], dz = q[1] - c[1], l = Math.hypot(dx, dz) || 1, k = 1 + 22 / l; return [c[0] + dx * k, y, c[1] + dz * k]; };
    const [p0, p1, p2, p3] = f.pts.map(grow);
    boxShades.push({ corners: [p0, p1, p3, p2] });
  }
  // the painting, lying on the water: what the scene opens on, and fades from
  const R = S.region, { a, s, c } = S.map, ground = (u, v) => { const z = (c - v) / s; return [u - a * z, 0, z]; };
  const sheet = G.mesh([ground(R[0], R[1]), ground(R[2], R[1]), ground(R[0], R[3]), ground(R[2], R[3])].flatMap(p => [...p, 0, 0, 0, 1, 0]), [0, 2, 1, 1, 2, 3]);
  return { water, banks, walls, bridge, boat, boats, models, sheet, modelLines, boxShades, discShades };
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
  // ink lines along its rails, its deck edges and the arch
  const segs = [];
  for (const [off, f] of [[0, s => deck(s) + rail], [W, s => deck(s) + rail], [0, deck], [W, deck], [0, soffit], [W, soffit]])
    for (let i = 0; i + 5 <= N; i += 5) segs.push([at(ss[i], off, f(ss[i])), at(ss[i + 5], off, f(ss[i + 5]))]);
  // the shade it throws on the water under it
  const shade = { corners: [at(L * .1, -18, .6), at(L * .9, -18, .6), at(L * .1, W + 18, .6), at(L * .9, W + 18, .6)] };
  return { sh, front, back, deckTop, under, caps: [cap(0), cap(W)], lines: G.lines(segs), shade };
}

// the boat: a hull standing on its painted waterline with the painted gunwale above it, a deck, a cabin with a
// rounded roof, a mast. Every vertex carries the painting px it shows: where the painter could see a surface, the px it
// is painted at; on the far side, which he could not, the px of the matching point on the near side, mirrored
function buildBoat(Bt) {
  const { a, s, c } = S.map, N = 56;
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
  const C = Bt.cabin || { from: 0, to: 0, inset: 0, wall: 0, arch: 0 }, ka = Math.round(C.from * N), kb = Math.round(C.to * N), M = 10;
  const roofY = (k, f) => st[k].h + C.wall + C.arch * Math.sin(Math.PI * f);
  // the ends, which the painter saw only edge-on: dressed in the near side's planks just round the corner from them
  const round = (k, w, inward) => clamp(Math.round(k + inward * 7 * w), 0, N);
  if (Bt.cabin) {
  grid(kb - ka, 1, (i, j) => { const k = ka + i, p = P(k, C.inset, j ? st[k].h + C.wall : st[k].h - 4); return [p, paintAt(p), nNear]; });
  grid(kb - ka, 1, (i, j) => { const k = ka + i, w = beam(st[k].t) - C.inset, y = j ? st[k].h + C.wall : st[k].h - 4; return [P(k, w, y), near(k, w, y), nFar]; });
  grid(kb - ka, M, (i, j) => {
    const k = ka + i, f = j / M, w = lerp(C.inset, beam(st[k].t) - C.inset, f), p = P(k, w, roofY(k, f));
    const n = [-perp[0] * Math.cos(Math.PI * f), Math.sin(Math.PI * f) + .3, -perp[1] * Math.cos(Math.PI * f)];
    // the roof's far half, sloping away from the painter, wears its near half
    const g = Math.min(f, 1 - f), q = P(k, lerp(C.inset, beam(st[k].t) - C.inset, g), roofY(k, g));
    return [p, paintAt(q), n];
  });
  for (const k of [ka, kb]) grid(1, M, (i, j) => {
    const f = j / M, w = lerp(C.inset, beam(st[k].t) - C.inset, f), y = i ? roofY(k, f) : st[k].h - 4, p = P(k, w, y);
    const kk = round(k, f, k === kb ? -1 : 1);
    return [p, paintAt(P(kk, C.inset, i ? st[kk].h + C.wall : st[kk].h - 4)), [axis[0] * (k === kb ? 1 : -1), 0, axis[1] * (k === kb ? 1 : -1)]];
  });
  }
  for (const k of [0, N]) grid(4, 6, (i, j) => {
    const w = beam(st[k].t) * j / 6, f = i / 4, p = P(k, w, lerp(-8, st[k].h, f)), kk = round(k, j / 6, k ? -1 : 1);
    return [p, paintAt(P(kk, 0, f * st[kk].h)), [axis[0] * (k ? 1 : -1), 0, axis[1] * (k ? 1 : -1)]];
  });
  const mid = P(N >> 1, beam(.5) / 2, 0);
  // ink lines along the gunwales and the waterline, round the cabin's eaves and ridge and across its ends
  const segs = [], every = (k0, k1, f) => { for (let k = k0; k + 2 <= k1; k += 2) segs.push([f(k), f(k + 2)]); };
  every(0, N, k => P(k, 0, st[k].h)); every(0, N, k => P(k, beam(st[k].t), st[k].h)); every(0, N, k => P(k, 0, 1));
  for (const k of [0, N]) segs.push([P(k, 0, 0), P(k, 0, st[k].h)], [P(k, 0, st[k].h), P(k, beam(st[k].t), st[k].h)]);
  if (Bt.cabin) {
    every(ka, kb, k => P(k, C.inset, st[k].h + C.wall)); every(ka, kb, k => P(k, beam(st[k].t) - C.inset, st[k].h + C.wall));
    every(ka, kb, k => P(k, beam(st[k].t) / 2, roofY(k, .5)));
    for (const k of [ka, kb]) for (let j = 0; j < M; j++) {
      const f0 = j / M, f1 = (j + 1) / M, w = f => lerp(C.inset, beam(st[k].t) - C.inset, f);
      segs.push([P(k, w(f0), roofY(k, f0)), P(k, w(f1), roofY(k, f1))]);
    }
  }
  const lines = G.lines(segs);
  const shade = { corners: [P(0, -16, .5), P(N, -16, .5), P(0, beam(0) + 16, .5), P(N, beam(1) + 16, .5)] };
  if (!Bt.mast) return { mesh: G.mesh(V, I), mid, axis, perp, st, beam, P, len: al, lines, shade };
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
  return { mesh, mast, top: mt, stays, mid, axis, perp, st, beam, P, len: al, lines, shade, km, mb };
}

function rotAxis(ax, th) {           // a 4×4 rotation about the unit axis ax
  const [x, y, z] = ax, c = Math.cos(th), s = Math.sin(th), t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
}
function translate(v) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]; }
function boatModel(t, b = world.boat, R = S.boat.rock, phase = 0) {
  const w = 6.2832 * R.hz * t + phase;
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
// who walks (life/world-bridge.json, walks): each loop walks forward its distance, fading at either end, then comes
// round again; it scales with how far the scene has lifted, so seen as painted everyone stands where they are painted
const walking = { people: new Map(), trees: new Map(), haul: null };
let q_drama = null, played = false; // the near miss, while it plays (below), and whether it has played by itself yet
function setupWalks() {
  const W = S.walks; if (!W) return;
  const { a, s } = S.map, groupIdx = {};
  const idx = (S.people || []).map(p => { groupIdx[p.group] = (groupIdx[p.group] ?? -1) + 1; return [p.group, groupIdx[p.group]]; });
  const worldDir = ([du, dv]) => { const dz = -dv / s, dx = du - a * dz, l = Math.hypot(dx, dz); return [dx / l, 0, dz / l]; };
  for (const L of W.loops) {
    const loop = { ...L, d: worldDir(L.dir) };
    for (const w of L.who) {
      if (w.standee) { const i = (S.trees || []).findIndex(T => T.id === w.standee); if (i >= 0) walking.trees.set(i, loop); }
      else { const i = idx.findIndex(([g, k]) => g === w.group && k === w.i); if (i >= 0) walking.people.set(i, loop); }
    }
  }
  if (W.haul) {
    const H = W.haul, boat = world.boats.find(b => b.spec.id === H.boat);
    const team = idx.map(([g], i) => (g === H.group ? i : -1)).filter(i => i >= 0);
    walking.haul = { ...H, boat, team: new Set(team) };
  }
}
// where a walker is now: its offset from where it is painted, its alpha, how far it has walked, which way it faces
function walkNow(loop, t, e) {
  const T = loop.dist / loop.speed, u = ((t / T + loop.phase) % 1 + 1) % 1, k = REDUCED ? 0 : e;
  const go = (u - .5) * loop.dist * k;
  return { off: loop.d.map(v => v * go), alpha: lerp(1, Math.min(1, u / .1, (1 - u) / .1), k), walked: t * loop.speed * k, gait: t * loop.speed / 22 };
}
function facing(loop, view) {      // mirror a figure that would otherwise walk backwards on screen
  const sd = loop.d[0] * view.right[0] + loop.d[2] * view.right[2];
  return (loop.faces === 'left') === (sd > 0) ? -1 : 1;
}
function haulNow(t, e) {
  const H = walking.haul; if (!H || REDUCED) return { pull: 0, w: 0 };
  const w = 6.2832 * H.hz * t;
  return { pull: e * (Math.sin(w) * .5 + .5), w };
}

// the painting's own people, stood up (tools/make_world.py): on the deck behind the front railing, as far back
// across it as each is painted above the rail, or on a bank at their painted feet. Each idles a little.
function peopleQuads(view, t, e) {
  const sh = world.bridge.sh, A = S.sprites, out = [], right = view.bb, hl = haulNow(t, e);
  for (const [i, p] of (S.people || []).entries()) {
    const [x0, y0, x1, y1] = A.rects[p.sprite], w = x1 - x0, h = y1 - y0;
    let pos = p.on === 'deck' ? sh.at(p.s, sh.W * p.w, sh.deck(p.s)) : p.p;
    const ph = i * 1.7;
    let bob = REDUCED ? 0 : Math.max(0, Math.sin(t * (.7 + (i % 5) * .13) + ph)) * 1.2;
    let lean = REDUCED ? 0 : Math.sin(t * (.45 + (i % 3) * .1) + ph) * 1.6, flip = 1, alpha = 1;
    const loop = walking.people.get(i);
    if (loop) {
      const W = walkNow(loop, t, e); pos = pos.map((v, j) => v + W.off[j]); alpha = W.alpha;
      bob = REDUCED ? 0 : Math.abs(Math.sin(W.gait * Math.PI)) * 2.2 * e; lean = 0; flip = facing(loop, view);
    } else if (walking.haul?.team.has(i)) {          // a tracker: leaning into the line, a step at a time
      bob = Math.abs(Math.sin(hl.w + i)) * 1.8 * e; lean = -(2 + 3 * hl.pull) * e;
      flip = facing({ d: [-1, 0, 0], faces: walking.haul.faces }, view);
    }
    const l = -p.anchor * flip, r = (w - p.anchor) * flip;
    if (q_drama && p.on === 'deck') { const dl = q_drama.lean(p, t); lean += dl.lean; bob += dl.bob; }
    const corners = [[l + lean * flip, h + bob], [r + lean * flip, h + bob], [l, 0], [r, 0]].map(([x, y]) => [pos[0] + right[0] * x, pos[1] + y, pos[2] + right[2] * x]);
    const uv = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [x / A.size[0], y / A.size[1]]);
    out.push({ tex: 'sprites', corners, uv, alpha, pos, sw: w * .62, h, i });
  }
  return out;
}
// trees: cut-outs of their brushwork at the trunk's foot, the crown swaying
function treeQuads(view, t, e) {
  const A = S.sprites, out = [], right = view.bb, uvOf = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [x / A.size[0], y / A.size[1]]);
  for (const [i, T] of (S.trees || []).entries()) {
    const [x0, y0, x1, y1] = A.rects[T.sprite], h = y1 - y0, [ax, ay] = T.anchor;
    const sway = REDUCED ? 0 : T.sway * (Math.sin(t * .9 + i * 2) + .4 * Math.sin(t * 2.3 + i));
    let bob = REDUCED ? 0 : (T.bob || 0) * Math.max(0, Math.sin(t * (.8 + (i % 4) * .15) + i * 1.3));
    let pos = T.p, flip = 1, alpha = 1, walked = 0;
    const loop = walking.trees.get(i);
    if (loop) {
      const W = walkNow(loop, t, e); pos = pos.map((v, j) => v + W.off[j]); alpha = W.alpha; walked = W.walked; flip = facing(loop, view);
      if (!T.wheel && !REDUCED) bob += Math.abs(Math.sin(W.gait * Math.PI)) * 1.8 * e;
    }
    const l = -ax * flip, r = (x1 - x0 - ax) * flip, top = ay + bob, bot = ay - h + bob;
    const corners = [[l + sway, top], [r + sway, top], [l, bot], [r, bot]].map(([x, y]) => [pos[0] + right[0] * x, pos[1] + y, pos[2] + right[2] * x]);
    out.push({ tex: 'sprites', corners, uv: uvOf(A.rects[T.sprite]), alpha, pos, sw: (x1 - x0) * (T.sway ? .3 : .62) });
    if (T.wheel) {                   // the wheel, turning as far as the cart has rolled
      const Wh = T.wheel, R = A.rects[Wh.sprite], hw = (R[2] - R[0]) / 2, th = walked / Wh.r, c = Math.cos(th), sn = Math.sin(th);
      const cx = Wh.at[0], cy = Wh.at[1];
      const wc = [[-hw, hw], [hw, hw], [-hw, -hw], [hw, -hw]].map(([x, y]) => {
        const rx = (cx + x * c - y * sn) * flip, ry = cy + x * sn + y * c + bob;
        return [pos[0] + right[0] * rx, pos[1] + ry, pos[2] + right[2] * rx];
      });
      out.push({ tex: 'sprites', corners: wc, uv: uvOf(R), alpha, pos, after: true });
    }
  }
  return out;
}
function crowdQuads(view) {
  const sh = world.bridge.sh, right = view.bb, out = [];
  for (const p of crowd) {
    const F = p.fig, y = p.s > 0 && p.s < sh.L ? sh.deck(p.s) : S.bank, pos = sh.at(p.s, sh.W * p.w, y);
    const sc = p.h / (F.feet[1] - F.top);
    const screenDir = (sh.b[0] * view.right[0] + sh.b[1] * view.right[2]) * Math.sign(p.v);
    const facesRight = F.faces === 'right', flip = (screenDir > 0) === facesRight ? 1 : -1;
    const bob = REDUCED ? 0 : Math.abs(Math.sin(p.phase * Math.PI)) * 1.6;
    const [x0, y0, x1, y1] = F.box, fx = F.feet[0], fy = F.feet[1];
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, yy]) => {
      const dx = (x - fx) * sc * flip, dy = (fy - yy) * sc + bob;
      return [pos[0] + right[0] * dx, pos[1] + dy, pos[2] + right[2] * dx];
    });
    // fade in and out at the ends of the walk, where they come and go
    const L = sh.L, edge = Math.min(p.s + OFF + 40, L + OFF + 40 - p.s);
    out.push({ tex: 'c-' + F.id, corners, alpha: clamp(edge / 60, 0, 1), pos, sw: (x1 - x0) * sc * .62 });
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
  const right = view.bb, along = world.bridge.sh.b;
  const screenDir = (along[0] * view.right[0] + along[1] * view.right[2]) * P0.dir;
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
  // cut-outs stand across world X as painted (the painting's horizontal), turning to face the camera as it frees
  const right = [Math.cos(yaw), 0, Math.sin(yaw)], bx = lerp(1, right[0], e), bz = lerp(0, right[2], e), bl = Math.hypot(bx, bz);
  return { vp, eye, tgt, yaw, pitch, right, bb: [bx / bl, 0, bz / bl], fov };
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

// a soft shadow on the ground under a cut-out's feet, as wide as the figure, turned with it
function footShade(pos, sw, view, alpha = 1) {
  const a = view.bb, n = [-a[2], 0, a[0]], hw = sw / 2, hd = sw * .2, y = pos[1] + .7;
  const P = (i, j) => [pos[0] + a[0] * hw * i + n[0] * hd * j, y, pos[2] + a[2] * hw * i + n[2] * hd * j];
  return { corners: [P(-1, -1), P(1, -1), P(-1, 1), P(1, 1)], alpha };
}
const xf = (m, p) => m ? [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]] : p;
const MIRROR = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];   // the scene upside down in the water's plane
const INK = [.2, .16, .12, 1];

// everything that stands up, drawn the same way for the scene and for its reflection
function drawStanding(F, view) {
  const { gl } = G, Bm = world.bridge;
  G.draw(Bm.front, { tex: tex.face, shade: 1 }); G.draw(Bm.back, { tex: tex.face, shade: .9 });
  G.draw(Bm.deckTop, { tex: tex.deck, shade: 1 }); G.draw(Bm.under, { tex: tex.soffit, shade: .78 });
  for (const c of Bm.caps) G.draw(c, { mode: 7, color: [.22, .17, .12, 1] });
  for (const Mo of world.models) {
    if (Mo.mesh) G.draw(Mo.mesh, { mode: 9, shade: Mo.shade });
    if (Mo.plain) G.draw(Mo.plain, { mode: 10, color: Mo.color });
  }
  for (const b of F.boats) {
    G.draw(b.Bo.mesh, { mode: 9, model: b.model, shade: 1 });
    if (b.Bo.mast) {
      G.draw(b.Bo.mast, { mode: 7, model: b.mastModel || b.model, color: [.36, .29, .21, 1] });
      const top = xf(b.mastModel || b.model, b.Bo.top);
      for (const st of b.Bo.stays) rope(top, xf(b.model, st), view, [.34, .28, .21, 1], .75);
    }
  }
  for (const r of F.ropes) rope(r[0], r[1], view, r[2] || [.3, .24, .18, 1], r[3] || .9);
  gl.depthMask(false);
  for (const q of F.sprites) {
    if (q.porter) { for (const pc of F.pq.pieces) G.quad(pc.corners, { tex: tex[pc.tex], alpha: 1 }); }
    else G.quad(q.corners, { tex: tex[q.tex], alpha: q.alpha }, q.uv);
  }
  gl.depthMask(true);
}

// ------------------------------------------------------------------------------------------------- the near miss
// The scroll's drama: the big boat swings in toward the bridge with its mast still up; the crew lower it, brace poles
// against the arch to fend the bow off, and someone on the deck lets down a rope while the crowd at the railing leans
// out. It ends exactly as painted. Plays once when the porter first reaches the crown, or from the Watch button,
// which also flies the camera through it.
const DRAMA_T = 30;

// ---------------------------------------------------------------------------------------------------------- sound
// All synthesized in the browser, nothing recorded: the river as filtered noise, market talk as murmuring formant
// voices, creaking oars, and in the near miss the mast's groan, the thud of poles, a rope's whistle and shouts. Each
// sound sits somewhere in the world and is heard from the camera. Off until the visitor turns it on.
const sound = (() => {
  let ctx = null, master = null, on = false, timer = 0, noise = null;
  const voices = [], creakers = [];
  const SC = .01;                                         // world units to metres, roughly
  const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1700]];
  const at = (u, v, y) => { const { a, s, c } = S.map, z = (c - v - y) / s; return [u - a * z, y, z]; };
  function panner(p, ref = 4) {
    const n = ctx.createPanner(); n.panningModel = 'equalpower'; n.distanceModel = 'inverse'; n.refDistance = ref; n.rolloffFactor = 1.1; n.maxDistance = 80;
    if (n.positionX) { n.positionX.value = -p[0] * SC; n.positionY.value = p[1] * SC; n.positionZ.value = p[2] * SC; } else n.setPosition(-p[0] * SC, p[1] * SC, p[2] * SC);
    n.connect(master); return n;
  }
  function noiseSource() { const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true; n.start(ctx.currentTime + Math.random()); return n; }
  function bandpass(f, q) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; }
  // a voice in a crowd: a buzz and a breath through two formants, spoken in short syllables
  function voice(out, base, level) {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = base;
    const breath = noiseSource(), bg = ctx.createGain(); bg.gain.value = .25; breath.connect(bg);
    const f1 = bandpass(600, 7), f2 = bandpass(1400, 9), env = ctx.createGain(); env.gain.value = 0;
    for (const f of [f1, f2]) { osc.connect(f); bg.connect(f); f.connect(env); }
    env.connect(out); osc.start();
    return { osc, f1, f2, env, base, level, next: 0 };
  }
  function speak(v, t0, dur, amp, vowel, glide = 1) {
    const [a, b] = vowel, p = v.osc.frequency;
    p.cancelScheduledValues(t0); p.setValueAtTime(p.value, t0); p.linearRampToValueAtTime(v.base * (.92 + Math.random() * .3), t0 + .03);
    p.linearRampToValueAtTime(v.base * glide * (.85 + Math.random() * .25), t0 + dur);
    v.f1.frequency.setTargetAtTime(a, t0, .02); v.f2.frequency.setTargetAtTime(b, t0, .02);
    v.env.gain.setTargetAtTime(amp * v.level, t0, .018); v.env.gain.setTargetAtTime(0, t0 + dur, .04);
  }
  function schedule() {                                   // keep every crowd voice talking a little ahead of time
    const now = ctx.currentTime;
    for (const v of voices) while (v.next < now + .6) {
      const t0 = Math.max(v.next, now + .05), dur = .09 + Math.random() * .22;
      if (Math.random() < .3) { v.next = t0 + .25 + Math.random() * .9; continue; }   // a pause between phrases
      speak(v, t0, dur, .5 + Math.random() * .5, VOWELS[(Math.random() * VOWELS.length) | 0]);
      v.next = t0 + dur + .02 + Math.random() * .07;
    }
    for (const c of creakers) if (now > c.next) { creak(c.p, now + .05, .25 + Math.random() * .3, c.level); c.next = now + 2.5 + Math.random() * 4; }
  }
  // wood under strain: a stuttering buzz through a narrow band
  function creak(p, t0, dur, level, low = 1) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f = o.frequency; f.setValueAtTime(38 * low, t0);
    for (let k = 0; k < dur * 30; k++) f.setValueAtTime((30 + Math.random() * 40) * low, t0 + k / 30);
    const bp = bandpass(780 * low + Math.random() * 300, 9), g = ctx.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + dur * .3); g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(bp); bp.connect(g); g.connect(panner(p, 3)); o.start(t0); o.stop(t0 + dur + .05);
  }
  function thud(p, t0, level) {                           // a pole striking timber
    const n = noiseSource(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const bp = bandpass(180, 3), g = ctx.createGain(); g.gain.setValueAtTime(level, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .35);
    n.connect(lp); lp.connect(bp); bp.connect(g); g.connect(panner(p, 3)); n.stop(t0 + .4);
  }
  function whoosh(p, t0, level) {                         // a rope through the air
    const n = noiseSource(), bp = bandpass(500, 2), g = ctx.createGain();
    bp.frequency.setValueAtTime(400, t0); bp.frequency.exponentialRampToValueAtTime(2200, t0 + .5); bp.frequency.exponentialRampToValueAtTime(600, t0 + 1);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + .35); g.gain.linearRampToValueAtTime(0, t0 + 1.1);
    n.connect(bp); bp.connect(g); g.connect(panner(p, 3)); n.stop(t0 + 1.2);
  }
  function shout(p, t0, base, level) {                    // "hey—a!": up, then falling away
    const out = ctx.createGain(); out.gain.value = 1; out.connect(panner(p, 5));
    const v = voice(out, base, level);
    speak(v, t0, .32, 1, [500, 1900], 1.25); speak(v, t0 + .36, .5, .9, [760, 1150], .8);
    v.osc.stop(t0 + 1.2);
  }
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { b = (b + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5 + (Math.random() * 2 - 1) * .06; }  // brown-ish
    // the river: a bed under everything, and lapping that swells and falls
    const river = noiseSource(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const rg = ctx.createGain(); rg.gain.value = .18; river.connect(lp); lp.connect(rg); rg.connect(master);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .13; lg.gain.value = .07; lfo.connect(lg); lg.connect(rg.gain); lfo.start();
    const lap = noiseSource(), lb = bandpass(900, 1.2), lapg = ctx.createGain(); lapg.gain.value = .05;
    const lfo2 = ctx.createOscillator(), lg2 = ctx.createGain(); lfo2.frequency.value = .37; lg2.gain.value = .05; lfo2.connect(lg2); lg2.connect(lapg.gain); lfo2.start();
    lap.connect(lb); lb.connect(lapg); lapg.connect(panner(world.bridge.sh.at(world.bridge.sh.L / 2, 0, 0), 8));
    // market talk where the crowds are: the bridge, the street at its foot, the street by the wine shop, the far bank
    const sh = world.bridge.sh;
    const crowds = [[sh.at(sh.L * .45, sh.W / 2, sh.deck(sh.L * .45) + 40), 5, .1], [at(18650, 700, 150), 4, .09], [at(17700, 1450, 150), 4, .08], [at(19300, 80, 150), 3, .06]];
    for (const [p, n, level] of crowds) {
      const out = ctx.createGain(); out.gain.value = 1;
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 2600; out.connect(lp2); lp2.connect(panner(p, 4));
      for (let i = 0; i < n; i++) voices.push(voice(out, 105 + Math.random() * 130, level * (.7 + Math.random() * .5)));
    }
    // oars and hulls creaking now and then
    for (const B of [world.boat, ...world.boats.slice(0, 4)]) creakers.push({ p: B.mid, next: Math.random() * 4, level: B === world.boat ? .14 : .08 });
  }
  return {
    wake() { if (on) { if (!ctx) init(); ctx.resume(); } },
    toggle() {
      on = !on;
      if (on) {
        if (!ctx) init();
        ctx.resume(); master.gain.setTargetAtTime(.9, ctx.currentTime, .4);
        clearInterval(timer); timer = setInterval(schedule, 120); schedule();
      } else if (ctx) { master.gain.setTargetAtTime(0, ctx.currentTime, .15); clearInterval(timer); setTimeout(() => { if (!on) ctx.suspend(); }, 600); }
      return on;
    },
    frame(view) {
      if (!ctx || !on) return;
      const L = ctx.listener, e = view.eye.map(v => v * SC), f = [view.tgt[0] - view.eye[0], view.tgt[1] - view.eye[1], view.tgt[2] - view.eye[2]], l = Math.hypot(...f);
      // the world is left-handed (Z away from the painter): mirror X so that left and right come out of the right ears
      const fx = -f[0] / l, fy = f[1] / l, fz = f[2] / l;
      if (L.positionX) { L.positionX.value = -e[0]; L.positionY.value = e[1]; L.positionZ.value = e[2]; L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition(-e[0], e[1], e[2]); L.setOrientation(fx, fy, fz, 0, 1, 0); }
    },
    cue(name) {                                           // the near miss's sounds, where they happen
      if (!ctx || !on) return;
      const t0 = ctx.currentTime + .05, sh = world.bridge.sh, D = q_drama, Bo = world.boat;
      const s0 = D ? D.sNear : sh.L / 2, deck = sh.at(s0, D ? D.off : 0, sh.deck(s0) + 50), bow = Bo.P(0, Bo.beam(0) / 2, Bo.st[0].h);
      if (name === 'mast') { creak(Bo.top, t0, 1.6, .22, .6); creak(Bo.mb, t0 + .9, 1.2, .16, .8); }
      if (name === 'pole') { thud(sh.at(s0, D ? D.off : 0, sh.soffit(s0)), t0, .5); creak(bow, t0 + .1, .5, .12); }
      if (name === 'rope') whoosh(deck, t0, .22);
      if (name === 'shout' || name === 'start') {
        const n = name === 'start' ? 1 : 4;
        for (let i = 0; i < n; i++) shout(sh.at(s0 + (Math.random() - .5) * 200, sh.W * Math.random(), sh.deck(s0) + 60), t0 + i * (.18 + Math.random() * .25), 170 + Math.random() * 120, .55);
      }
    },
    get on() { return on; },
    probe() {                                              // for tests: how loud the mix is right now (RMS)
      if (!ctx) return null;
      if (!this.an) { this.an = ctx.createAnalyser(); this.an.fftSize = 2048; master.connect(this.an); }
      const b = new Float32Array(this.an.fftSize); this.an.getFloatTimeDomainData(b);
      return { rms: Math.sqrt(b.reduce((m, v) => m + v * v, 0) / b.length), state: ctx.state, voices: voices.length };
    },
  };
})();

const CAPTIONS = [
  [0, 'A loaded boat swings toward the Rainbow Bridge.'],
  [6.5, 'Its mast is too tall for the arch, and the crew hurry to lower it.'],
  [13, 'Boatmen brace their poles against the bridge to fend the bow off.'],
  [18, 'From the deck, someone lets down a rope.'],
  [22.5, 'Onlookers crowd the railing, shouting and pointing.'],
  [26.5, 'The painting holds this one moment, still undecided.'],
];
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function startDrama(cine) {
  if (q_drama && !cine) return;
  const Bo = world.boat, sh = world.bridge.sh;
  const bow = Bo.P(0, Bo.beam(0) / 2, Bo.st[0].h);
  let best = [1e9, 0, 0];
  for (let s = 0; s <= sh.L; s += 10) for (const off of [0, sh.W]) { const q = sh.at(s, off, sh.deck(s)); const d = Math.hypot(q[0] - bow[0], q[2] - bow[2]); if (d < best[0]) best = [d, s, off]; }
  const [, sNear, off] = best;
  q_drama = { t: 0, start: null, from: 0, cine, sNear, off, cue: -1, sounds: new Set(), cam: cine ? { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, focus: [cam.tx, cam.ty, cam.tz] } : null,
    lean(p, t) {                                    // the crowd at the railing near the boat, leaning out and bobbing
      const k = smooth(11, 15, this.t) * (1 - smooth(26, 29, this.t)) * Math.exp(-(((p.s - this.sNear) / 260) ** 2));
      return { lean: -k * 7 * Math.sign(p.s - this.sNear || 1), bob: k * Math.abs(Math.sin(this.t * 5.5 + p.s * .05)) * 3.5 };
    } };
  sound.cue('start');
}
// where the boat is in the sequence: drifting in from upstream of its painted place, swinging, recoiling off the poles
function dramaBoat(t) {
  const D = q_drama, Bo = world.boat, x = D.t;
  const drift = 620 * (1 - smooth(0, 15, x)) ** 1.6 + 22 * smooth(15, 17.5, x) * (1 - smooth(18, 25, x));
  const yaw = rad(9) * (1 - smooth(0, 14, x)) - rad(2.5) * Math.sin(Math.PI * smooth(14, 22, x));
  const c = Bo.mid, move = translate([Bo.axis[0] * drift, 0, Bo.axis[1] * drift]);
  const turn = mul(translate([c[0], 0, c[2]]), mul(rotAxis([0, 1, 0], yaw), translate([-c[0], 0, -c[2]])));
  const lean = rad(-6 + 20 * smooth(5, 16, x));               // the mast, from upright down to where it is painted
  const mb = Bo.mb, d = -(lean - rad(S.boat.mast.lean));
  const mast = mul(translate(mb), mul(rotAxis([Bo.perp[0], 0, Bo.perp[1]], d), translate(mb.map(v => -v))));
  return { model: mul(move, turn), mast };
}
// the poles and the rope, as ink lines between the boat and the bridge
function dramaRopes(D, model, view, ropes) {
  const Bo = world.boat, sh = world.bridge.sh, x = D.t, C = S.boat.cabin, N = Bo.st.length - 1;
  const roof = k => Bo.st[k].h + C.wall + C.arch;
  const poles = [[Bo.P(8, Bo.beam(.15) * .35, Bo.st[8].h + 55), sh.at(D.sNear - 70, D.off, sh.soffit(D.sNear - 70) + 18)],
                 [Bo.P(20, Bo.beam(.35) * .5, roof(20) + 40), sh.at(D.sNear + 40, D.off, sh.soffit(D.sNear + 40) + 26)]];
  for (const [i, [a0, b]] of poles.entries()) {
    const a = xf(model, a0), k = smooth(12 + i * 1.5, 15 + i * 1.5, x) * (1 - smooth(25, 28, x));
    if (k <= 0) continue;
    const push = 1 - .04 * Math.abs(Math.sin(x * 3.2 + i));        // the pole shoves, and gives a little
    const tip = [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * k * push);
    ropes.push([a, tip, [.3, .23, .16, 1], 1.7]);
  }
  // the rope: thrown from the rail, it falls in an arc to the bow and hangs there
  const k = smooth(18, 20.5, x);
  if (k > 0 && x < 28.5) {
    const from = sh.at(D.sNear + 10, D.off + 12, sh.deck(D.sNear + 10) + sh.rail + 22), to = xf(model, Bo.P(2, Bo.beam(0) / 2, Bo.st[2].h + 8));
    const end = [0, 1, 2].map(j => from[j] + (to[j] - from[j]) * k), lift = Math.sin(Math.PI * k) * 60 * (1 - k * .5);
    end[1] += lift;
    let prev = from;
    for (let j = 1; j <= 8; j++) {
      const f = j / 8, q = [0, 1, 2].map(m => from[m] + (end[m] - from[m]) * f);
      q[1] -= Math.sin(Math.PI * f) * 26 * k;                 // it sags as it settles
      ropes.push([prev, q, [.28, .22, .16, 1], .8]); prev = q;
    }
  }
}
// the camera's flight through it (Watch): low on the water, up close where the poles meet the arch, along the crowd
function dramaCamera(D) {
  const x = D.t, sh = world.bridge.sh, Bo = world.boat, H = HOME.yaw;
  const contact = sh.at(D.sNear, D.off - 40, sh.soffit(D.sNear) - 60), crowd = sh.at(D.sNear, D.off + 60, sh.deck(D.sNear) + 40);
  const keys = [
    [0, D.cam.focus, D.cam.yaw, D.cam.pitch, D.cam.dist],
    [4, [Bo.mid[0] + Bo.axis[0] * 360, 90, Bo.mid[2] + Bo.axis[1] * 360], H + rad(70), rad(14), 1000],
    [11, [Bo.mid[0], 120, Bo.mid[2]], H + rad(40), rad(11), 820],
    [17, contact, H - rad(10), rad(20), 620],
    [23, crowd, H - rad(55), rad(26), 700],
    [28, [Bo.mid[0], 150, Bo.mid[2]], H + rad(5), rad(26), 1150],
  ];
  let i = 0; while (i < keys.length - 2 && x > keys[i + 1][0]) i++;
  const [ta, fa, ya, pa, da] = keys[i], [tb, fb, yb, pb, db] = keys[i + 1], k = smooth(ta, tb, x);
  let dy = yb - ya; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return { focus: fa.map((v, j) => lerp(v, fb[j], k)), yaw: ya + dy * k, pitch: lerp(pa, pb, k), dist: Math.exp(lerp(Math.log(da), Math.log(db), k)) };
}
function stepDrama(t) {                // on the clock, not the frame count, so a slow device sees it at its own pace
  const D = q_drama; if (!D) return;
  if (D.start === null) D.start = t - D.from / (REDUCED ? 2 : 1);
  D.t = (t - D.start) * (REDUCED ? 2 : 1);
  let cue = -1; for (let i = 0; i < CAPTIONS.length; i++) if (D.t >= CAPTIONS[i][0]) cue = i;
  if (cue !== D.cue) { D.cue = cue; const c = $('#caption'); c.textContent = CAPTIONS[cue][1]; c.classList.add('on'); }
  for (const [at, name] of [[6.5, 'mast'], [13.5, 'pole'], [15, 'pole'], [18.5, 'rope'], [20.5, 'shout'], [22.5, 'shout']])
    if (D.t >= at && !D.sounds.has(at)) { D.sounds.add(at); sound.cue(name); }
  if (D.cine) {
    const c = dramaCamera(D);
    cam.focus = c.focus; cam.yaw = c.yaw; cam.pitch = c.pitch; cam.dist = c.dist;
  }
  if (D.t >= DRAMA_T) endDrama();
}
function endDrama() {
  const D = q_drama; if (!D) return;
  if (D.cine) { cam.focus = null; }
  q_drama = null;
  $('#caption').classList.remove('on');
  watchLabel(false);
}
function watchLabel(playing) {
  $('#watch').innerHTML = playing ? 'Stop' : '<span class="long">Watch the near miss</span><span class="short">Near miss</span>';
}

// ------------------------------------------------------------------------------------------- points of interest
// Seals on things worth a closer look; each opens a short note, with a way back to the scroll or into the near miss.
const NUM = '一二三四五六七八九';
const POIS = [
  { id: 'bridge', title: 'The Rainbow Bridge', zh: '虹桥',
    body: 'Meng Yuanlao’s memoir of Kaifeng, written in 1147 after the city was lost, describes it: no piers, only great timbers spanning the river, painted red, “like a flying rainbow”. With nothing standing in the water, boats could pass right under it.',
    link: ['index.html#bridge', 'This scene on the scroll'] },
  { id: 'boat', title: 'The big boat', zh: '客船',
    body: 'The largest boat in this stretch, swinging toward the arch with its mast still coming down. Readers have long felt the danger here, and Yu Hui of the Palace Museum counts the near collision among the scroll’s quiet warnings.',
    action: ['watch', 'Watch the near miss'] },
  { id: 'stalls', title: 'Stalls on the deck', zh: '桥市',
    body: 'Peddlers have set up on the bridge itself, under awnings and umbrellas, and everyone else squeezes past them. In the painting the deck is as crowded as any street.' },
  { id: 'wine', title: 'The wine shop', zh: '十千脚店',
    body: 'Its signs read 十千脚店: “ten thousand”, probably from an old line of verse praising wine at ten thousand cash a measure, and jiaodian, a smaller shop that bought its wine from one of the city’s great licensed taverns. Meng Yuanlao wrote that every wine shop in the capital tied a festive gateway of poles like this one at its door.',
    link: ['index.html#tavern', 'A great licensed tavern, on the scroll'] },
  { id: 'trackers', title: 'Trackers', zh: '纤夫',
    body: 'A team hauls a boat upstream on a towline made fast high on its mast, leaning into it a step at a time.',
    link: ['index.html#grain', 'Boats on the Bian River, on the scroll'] },
  { id: 'restaurant', title: 'An open restaurant', zh: '食店',
    body: 'On the near bank, diners sit at tables under a broad tiled roof, open to the street and the river.' },
];
function poiAt(id, F) {             // where each seal sits in the world this frame
  const sh = world.bridge.sh, Bo = world.boat;
  if (id === 'bridge') return sh.at(sh.L * .5, sh.W / 2, sh.deck(sh.L * .5) + 150);
  if (id === 'boat') return xf(F.boats[0].mastModel || F.boats[0].model, [Bo.top[0], Bo.top[1] + 40, Bo.top[2]]);
  if (id === 'stalls') return sh.at(sh.L * .28, sh.W * .6, sh.deck(sh.L * .28) + 110);
  if (id === 'wine') { const T = (S.trees || []).find(x => x.id === 'wine-gateway'); return T ? [T.p[0], T.p[1] + 620, T.p[2]] : null; }
  if (id === 'trackers') { const team = (S.people || []).filter(p => p.group === 'trackers'); if (!team.length) return null; return team.reduce((m, p) => [m[0] + p.p[0] / team.length, m[1] + p.p[1] / team.length + 90 / team.length, m[2] + p.p[2] / team.length], [0, 0, 0]); }
  if (id === 'restaurant') { const M = (S.models || []).find(m => m.id === 'near-restaurant'); if (!M?.foot) return null; const c = M.foot.pts.reduce((m, q) => [m[0] + q[0] / 4, m[1] + q[1] / 4], [0, 0]); return [c[0], M.foot.y + 330, c[1]]; }
  return null;
}
function setupPois() {
  const box = $('#pois');
  POIS.forEach((P, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'poi'; b.dataset.id = P.id; b.setAttribute('aria-label', `${P.title}: open the note`);
    b.innerHTML = `<span class="seal" lang="zh-Hans" aria-hidden="true">${NUM[i]}</span><span class="lbl">${P.title}</span>`;
    b.addEventListener('click', () => openNote(P, i));
    box.append(b); P.el = b;
  });
  $('#note-close').addEventListener('click', closeNote);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#note').hidden) closeNote(); });
}
function openNote(P, i) {
  const n = $('#note');
  $('#note-num').textContent = NUM[i]; $('#note-zh').textContent = P.zh; $('#note-title').textContent = P.title; $('#note-body').textContent = P.body;
  const act = $('#note-act'); act.innerHTML = '';
  if (P.link) { const a = document.createElement('a'); a.href = P.link[0]; a.textContent = P.link[1] + ' →'; a.className = 'link'; act.append(a); }
  if (P.action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = P.action[1];
    b.addEventListener('click', () => { closeNote(); $('#watch').click(); }); act.append(b);
  }
  n.hidden = false; n.dataset.for = P.id; $('#note-close').focus();
}
function closeNote() {
  const n = $('#note'), id = n.dataset.for; n.hidden = true;
  POIS.find(P => P.id === id)?.el?.focus();
}
function placePois(F, view) {       // project each seal to the screen; hide it while flat, behind the camera or in the mist
  const show = cam.p > .85 && !(q_drama?.cine);
  const W = innerWidth, H = innerHeight, far = 3800 + cam.dist * 1.2;
  for (const P of POIS) {
    const p = show ? poiAt(P.id, F) : null;
    let vis = false;
    if (p) {
      const m = view.vp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      const d = Math.hypot(p[0] - view.eye[0], p[1] - view.eye[1], p[2] - view.eye[2]);
      if (w > 0) {
        const sx = (x / w * .5 + .5) * W, sy = (.5 - y / w * .5) * H;
        vis = sx > 8 && sx < W - 8 && sy > 70 && sy < H - 120 && d < far * .8;
        if (vis) { P.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`; P.el.style.opacity = String(clamp(1.6 - d / (far * .5), .35, 1)); }
      }
    }
    if (P.el.hidden === vis) P.el.hidden = !vis;
  }
}

// ---------------------------------------------------------------------------------------------------------- frame
let canvas, last = 0, t0 = 0, refl = null;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  refl = G.target(Math.max(2, canvas.width >> 1), Math.max(2, canvas.height >> 1), refl);
  G.gl.uniform1f(G.U.uLineW, 1.15 * dpr);
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
  stepDrama(t);
  if (!played && cam.p > .9 && P0.s > world.bridge.sh.L * .38 && P0.s < world.bridge.sh.L * .62) { played = true; startDrama(false); }
  if (!REDUCED) cam.p += (cam.pTarget - cam.p) * (1 - Math.exp(-dt * 1.2)) + Math.sign(cam.pTarget - cam.p) * dt * .04;
  else cam.p = cam.pTarget;
  cam.p = clamp(cam.p, 0, 1);
  const pos = porterAt(P0.s), tgt = cam.focus || [pos[0] + world.bridge.sh.b[0] * P0.dir * 30, pos[1] + 34, pos[2] + world.bridge.sh.b[1] * P0.dir * 30];
  const k = cam.snap ? 1 : 1 - Math.exp(-dt * 4);
  cam.tx += (tgt[0] - cam.tx) * k; cam.ty += (tgt[1] - cam.ty) * k; cam.tz += (tgt[2] - cam.tz) * k; cam.snap = false;
  const view = viewAt(cam.p, aspect, [cam.tx, cam.ty, cam.tz]);
  stepPorter(dt, cam.p > .6 ? walkIntent(view) : 0);
  sound.frame(view);

  const { gl, U } = G;
  const mistC = S.silk.tone.map(v => Math.min(1, v / 255 * 1.16));
  gl.uniform1f(U.uTime, t);
  gl.uniform3fv(U.uEye, view.eye); gl.uniform3fv(U.uMist, mistC);
  const fogEnd = 3800 + cam.dist * 1.2, e = ease(cam.p);
  gl.uniform4f(U.uFog, lerp(1e6, 1300 + cam.dist * .6, e), lerp(2e6, fogEnd, e), lerp(1e6, 2300, e), lerp(2e6, 4200, e));
  gl.uniform2f(U.uViewport, canvas.width / 2, canvas.height / 2);

  // what moves this frame: the walkers, the boats, the people, sorted far to near
  stepCrowd(dt);
  const pq = porterQuads(view, t);
  const boats = [];
  if (world.boat) {
    const rock = boatModel(t);
    if (q_drama && !REDUCED) { const d = dramaBoat(t), m = rock ? mul(d.model, rock) : d.model; boats.push({ Bo: world.boat, model: m, mastModel: mul(m, d.mast), main: true }); }
    else boats.push({ Bo: world.boat, model: rock, main: true });
  }
  const hl = haulNow(t, e), ropes = [];
  for (const Bo of world.boats) {
    let model = boatModel(t, Bo, Bo.spec.rock || S.boat.rock, Bo.phase);
    if (walking.haul?.boat === Bo) {               // surging upstream against the towline
      const g = walking.haul.surge * hl.pull, m = translate([-Bo.axis[0] * g, 0, -Bo.axis[1] * g]);
      model = model ? mul(m, model) : m;
    }
    boats.push({ Bo, model });
  }
  const people = peopleQuads(view, t, e);
  const standing = [...crowdQuads(view), ...people, ...treeQuads(view, t, e)];
  if (walking.haul && e > .02) {                   // the towline: from high over the boat's bow to each tracker in turn
    const H = walking.haul, Bo = H.boat, b = boats.find(x => x.Bo === Bo);
    const bow = xf(b.model, Bo.P(0, Bo.beam(0) / 2, Bo.st[0].h + 150));
    const team = people.filter(q => H.team.has(q.i)).map(q => [q.pos[0], q.pos[1] + q.h * .62, q.pos[2]]);
    team.sort((p1, p2) => dist2(p1, bow) - dist2(p2, bow));
    let prev = bow; for (const q of team) { ropes.push([prev, q, [.26, .21, .16, 1], .8]); prev = q; }
  }
  if (q_drama && !REDUCED) dramaRopes(q_drama, boats[0].model, view, ropes);
  const sprites = standing.map(q => ({ ...q, d: dist2(q.pos, view.eye) - (q.after ? .5 : 0) }));
  sprites.push({ porter: true, d: dist2(porterAt(P0.s), view.eye) });
  sprites.sort((a, b) => b.d - a.d);
  const F = { pq, boats, sprites, ropes };

  // the reflection: everything standing, mirrored in the water's plane, drawn at half size for the water to sample
  const reflK = +(params.get('refl') ?? (REDUCED ? .35 : .5));
  if (e > .02) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, refl.fb); gl.viewport(0, 0, refl.w, refl.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, tex.silk);      // never sample the picture being drawn
    gl.uniformMatrix4fv(U.uVP, false, new Float32Array(mul(view.vp, MIRROR)));
    G.draw(world.walls, { mode: 2 });
    drawStanding(F, view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(...mistC, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(U.uVP, false, new Float32Array(view.vp));
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, refl.t);
  // the ground
  gl.uniform1f(U.uReflK, e > .02 ? reflK * e : 0);
  G.draw(world.water, { mode: 0 });
  gl.uniform1f(U.uReflK, 0);
  for (const m of world.banks) G.draw(m, { mode: 1 });
  G.draw(world.walls, { mode: 2 });
  // soft shadows on it: under the bridge, the boats, the buildings and stalls, and everyone's feet
  gl.depthMask(false);
  G.batch([world.bridge.shade], { mode: 12, alpha: e * .6 });
  G.batch(world.boxShades, { mode: 12, alpha: e });
  const round = [...world.discShades, ...boats.map(b => ({ corners: b.Bo.shade.corners.map(p => xf(b.model, p)).map(p => [p[0], .5, p[2]]) })),
    ...standing.filter(q => q.sw).map(q => footShade(q.pos, q.sw, view))];
  G.batch(round, { mode: 5, alpha: e });
  G.quad(pq.shadow, { mode: 5, alpha: e });
  gl.depthMask(true);
  // the bridge, the buildings, the boats and the people
  drawStanding(F, view);
  // ink along the edges of what was rebuilt, so its invented sides read as brushwork; none while it is still flat
  if (e > .02) {
    gl.depthMask(false);
    const k = .7 * e;
    G.draw(world.bridge.lines, { mode: 13, line: true, color: INK, alpha: k });
    if (world.modelLines) G.draw(world.modelLines, { mode: 13, line: true, color: INK, alpha: k * .85 });
    for (const b of boats) G.draw(b.Bo.lines, { mode: 13, line: true, model: b.model, color: INK, alpha: k });
    gl.depthMask(true);
  }
  G.quad(pq.marker, { mode: 6, alpha: e });
  placePois(F, view);
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
    if (q_drama?.cine) { q_drama.cine = false; cam.focus = null; }      // taking the camera back
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
  $('#watch').addEventListener('click', () => {
    if (q_drama?.cine) { endDrama(); return; }
    cam.held = false; cam.pTarget = 1; $('#flat').textContent = 'See it as painted';
    played = true; q_drama = null; startDrama(true); watchLabel(true);
    sound.wake();
  });
  $('#sound').addEventListener('click', () => {
    const on = sound.toggle(); $('#sound').textContent = on ? 'Sound on' : 'Sound off'; $('#sound').setAttribute('aria-pressed', String(on));
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
  const jobs = [['paint', S.paint.files[0], pre, {}], ['paint2', S.paint.files[1], pre, {}], ['masks', S.masks.file, raw, {}], ['tone', S.tone.file, raw, { mip: false }],
    ['silk', S.silk.file, pre, { repeat: true }], ['water', S.water.file, pre, { repeat: true }],
    ['face', S.bridge.face.file, pre, {}], ['soffit', S.bridge.soffit_tex.file, pre, { repeat: true }], ['deck', S.bridge.deck_tex.file, pre, { repeat: true }],
    ...S.walker.pieces.map(P => ['w-' + P.id, P.file, pre, {}]), ...(S.crowd?.people || []).map(C => ['c-' + C.id, C.file, pre, {}]), ...(S.sprites ? [['sprites', S.sprites.file, pre, {}]] : [])];
  const bmps = await Promise.all(jobs.map(([, f, o]) => bitmap(`${BASE}/${f}`, o)));
  jobs.forEach(([k, , , o], i) => { tex[k] = G.texture(bmps[i], o); });
  const { gl, U } = G;
  ['paint', 'masks', 'tone', 'silk', 'water'].forEach((k, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[k]); });
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, tex.paint2);
  gl.uniform3f(U.uMap, S.map.a, S.map.s, S.map.c); gl.uniform4f(U.uRegion, ...S.region);
  gl.uniform2f(U.uSilkSize, ...S.silk.size); gl.uniform2f(U.uWaterSize, ...S.water.size);
  world = buildWorld();
  setupHome();
  gl.uniform3fv(U.uHome, HOME.dir);
  const mid = world.bridge.sh.at(world.bridge.sh.L / 2, 0, 0);
  gl.uniform2f(U.uCenter, mid[0], mid[2]);
  P0.s = world.bridge.sh.L * .22;
  if (S.crowd) setupCrowd();
  setupWalks();
  setupPois();
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
    sound,
    drama: (cine = false, at = 0) => { played = true; q_drama = null; startDrama(cine); q_drama.from = at; },
    info: () => ({ L: world.bridge.sh.L, home: { yaw: HOME.yaw * 180 / Math.PI, pitch: HOME.pitch * 180 / Math.PI }, boat: world.boat && { mid: world.boat.mid, n: world.boat.mesh.n, st0: world.boat.st[0], stN: world.boat.st[world.boat.st.length - 1], top: world.boat.top } }),
  });
  requestAnimationFrame(now => { last = t0 = now; document.body.classList.add('ready'); frame(now); });
}
start();

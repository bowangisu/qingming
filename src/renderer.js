// WebGL2 renderer for the scroll. Everything is drawn as quads positioned in master-scan pixels and projected by a
// camera { cx, cy, w } (centre and visible width, master px) into the band of the screen the painting occupies.
// Modes: 0 = a painting tile, 1 = the silk mount behind the painting, 2 = the rolled-up part of the scroll on its rod,
// 3 = the scroll's soft shadow on the table. The tile mode also draws the living parts: ripples on open water (from the
// water mask), drifting mist, and the spotlight that dims everything outside the current subject.

const VS = `#version 300 es
in vec2 aCorner;
uniform vec4 uRect;        // quad in master px: x0, y0, x1, y1
uniform vec4 uCam;         // cx, cy, visible width, aspect (band width / height)
out vec2 vP;
void main() {
  vP = mix(uRect.xy, uRect.zw, aCorner);
  float h = uCam.z / uCam.w;
  gl_Position = vec4((vP.x - uCam.x) / (uCam.z * .5), -(vP.y - uCam.y) / (h * .5), 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vP;
uniform int uMode;
uniform vec2 uSize;        // master width, height
uniform vec4 uCam;
uniform sampler2D uTex;    // tile
uniform vec3 uTile;        // padded extent of the tile in level px (ax, bx) and the level's scale
uniform sampler2D uMask;   // water mask (whole scroll)
uniform float uTime;
uniform float uUnroll;     // the scroll is unrolled for x >= uUnroll (master px)
uniform float uRoll;       // radius of the rolled part (master px)
uniform vec4 uFocus;       // subject rectangle (master px)
uniform float uSpot;       // 0..1 spotlight strength
uniform float uMist;       // 0..1 mist strength (it only falls on the countryside)
uniform float uBorder;     // silk mount above and below the painting (master px)
uniform float uPx;         // master px per device px (for anti-aliased edges)
out vec4 fragColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v / .9375; }

vec3 silk(vec2 p, vec3 base) {
  float warp = .5 + .5 * sin(p.x * 1.9 + noise(p * vec2(.02, .5)) * 2.);
  float weft = .5 + .5 * sin(p.y * 1.7 + noise(p * vec2(.5, .02)) * 2.);
  float damask = smoothstep(.56, .62, fbm(p * .012 + 3.));
  return base * (.97 + .04 * warp * weft + .015 * (noise(p * vec2(.03, 1.)) - .5)) * (1. + .03 * damask);
}

// spotlight: outside the subject the scroll sinks into a warm shadow and loses some colour
vec3 spot(vec3 c, vec2 p) {
  if (uSpot <= 0.) return c;
  vec2 r = max(uFocus.xy - p, p - uFocus.zw);
  float o = smoothstep(0., max(140., uPx * 150.), length(max(r, 0.)));
  vec3 g = vec3(dot(c, vec3(.3, .59, .11)));
  return mix(c, mix(g, c, .5) * .46, o * uSpot);
}

void main() {
  vec2 p = vP;
  if (uMode == 3) {                                   // shadow on the table: soft, falling off outside the scroll
    vec2 q = max(vec2(uUnroll - uRoll * 2., -uBorder) - p, p - vec2(uSize.x + 30., uSize.y + uBorder));
    float d = length(max(q, 0.));
    fragColor = vec4(0., 0., 0., .45 * exp(-d / (uBorder * .9)));
    return;
  }
  if (uMode == 2) {                                   // the rolled scroll on its rod: a shaded cylinder, jade knobs
    bool knob = p.y < -uBorder || p.y > uSize.y + uBorder;
    float rad = knob ? min(uRoll, 34.) : uRoll, n = (p.x - (uUnroll - uRoll)) / rad;
    if (abs(n) > 1.) discard;
    float sh = sqrt(max(0., 1. - n * n)), hi = max(0., 1. - abs(n + .4) * 3.5);
    vec3 base = knob ? vec3(.8, .82, .74) : silk(vec2(p.x * .3, p.y), vec3(.62, .66, .66));
    vec3 c = base * (.42 + .65 * sh) + vec3(hi * hi * hi) * (knob ? .3 : .1);
    if (!knob) c *= .92 + .08 * smoothstep(.3, .7, noise(vec2(p.y * .02, n * 20.)));   // the wound layers
    fragColor = vec4(c, 1.);
    return;
  }
  if (p.x < uUnroll) discard;
  if (uMode == 1) {                                   // the mount: pale blue-grey silk, a dark edge band outside
    vec3 c = silk(p, vec3(.69, .71, .68));
    float outer = min(p.y + uBorder, uSize.y + uBorder - p.y);
    c = mix(c, vec3(.36, .32, .26), (1. - smoothstep(10., 14., outer)) * .9);
    fragColor = vec4(spot(c, p), 1.);
    return;
  }
  // a painting tile
  float m = texture(uMask, p / uSize).r;
  float t = uTime;
  vec2 d = vec2(0.);
  if (m > .01) {                                      // water: drawn ripple lines drift and shimmer
    float ph = p.x * .021 + p.y * .006 + fbm(p * .004 + t * .05) * 6.;
    d = m * vec2(sin(ph - t * 1.1) * 2.2 + sin(p.y * .09 + t * 1.7) * .9, sin(p.x * .015 + t * .8 + p.y * .03) * 1.6);
  }
  vec2 q = p + d;
  vec2 uv = vec2((q.x * uTile.z - uTile.x) / (uTile.y - uTile.x), q.y / uSize.y);
  vec3 c = texture(uTex, uv).rgb;
  if (m > .01) c *= 1. + m * (.045 * sin(p.x * .05 - t * 1.6 + fbm(p * .01) * 5.) + .02);
  // mist over the countryside at the start: slow drifting veils of pale silk, thicker in the low ground and the distance
  float mw = uMist * smoothstep(25500., 31500., p.x);
  if (mw > 0.) {
    float f = fbm(vec2(p.x * .0011 + t * .022, p.y * .0042 + t * .004)) * .7 + fbm(vec2(p.x * .003 - t * .035, p.y * .009)) * .3;
    float band = .55 + .45 * smoothstep(900., 1500., p.y) + .35 * (1. - smoothstep(200., 650., p.y));
    c = mix(c, vec3(.78, .72, .6), smoothstep(.45, .8, f) * band * .38 * mw);
  }
  c = spot(c, p);
  fragColor = vec4(c, 1.);
}`;

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'aCorner');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = {};
  for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(prog, i); U[a.name] = gl.getUniformLocation(prog, a.name); }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(U.uTex, 0); gl.uniform1i(U.uMask, 1);

  function texture(source, mip = true) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return t;
  }

  // frame: { band: {x, y, w, h} device px, cam, size: [W, H], tiles: [{tex, ax, bx, scale, cx0, cx1}], mask, time,
  //          unroll, roll, focus, spot, mist, border, table: [r, g, b] }
  function draw(f) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(...f.table, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const { x, y, w, h } = f.band;
    gl.viewport(x, canvas.height - y - h, w, h);
    gl.uniform4f(U.uCam, f.cam.cx, f.cam.cy, f.cam.w, w / h);
    gl.uniform2f(U.uSize, f.size[0], f.size[1]);
    gl.uniform1f(U.uTime, f.time); gl.uniform1f(U.uUnroll, f.unroll); gl.uniform1f(U.uRoll, f.roll);
    gl.uniform4f(U.uFocus, ...f.focus); gl.uniform1f(U.uSpot, f.spot); gl.uniform1f(U.uMist, f.mist);
    gl.uniform1f(U.uBorder, f.border); gl.uniform1f(U.uPx, f.cam.w / w);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, f.mask);
    const [W, H] = f.size, B = f.border;
    const quad = (mode, x0, y0, x1, y1) => { gl.uniform1i(U.uMode, mode); gl.uniform4f(U.uRect, x0, y0, x1, y1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    quad(3, f.unroll - f.roll * 2 - B * 3, -B * 4, W + B * 3, H + B * 4);
    gl.disable(gl.BLEND);
    quad(1, f.unroll, -B, W + 30, H + B);
    gl.activeTexture(gl.TEXTURE0);
    for (const t of f.tiles) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform3f(U.uTile, t.ax, t.bx, t.scale);
      // draw only the tile's core (padding is there for the ripple samples), clipped to the unrolled part
      quad(0, Math.max(t.cx0 / t.scale, f.unroll), 0, t.cx1 / t.scale, H);
    }
    quad(2, f.unroll - f.roll * 2, -B - 70, f.unroll, H + B + 70);   // at x = 0 this is the rod at the scroll's end
  }

  return { gl, texture, draw };
}

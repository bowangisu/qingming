// The page. Scroll position is turned into a path for a camera along the scroll: the closed scroll unrolls from the
// right, then the camera flies from one detail to the next (zooming out to travel and back in to look), holds on each
// while the text, brush loops and labels appear, and ends on the whole scroll. renderer.js draws the painting.
import { SCROLL, INTRO, CHAPTERS, OUTRO, SOURCES } from './story.js';
import { createRenderer } from './renderer.js';
import { createTiles } from './tiles.js';

const W = SCROLL.width, H = SCROLL.height, PX_PER_CM = W / SCROLL.cm[1];
const B = 70;                              // mount silk above and below the painting (master px)
const TABLE = [26 / 255, 21 / 255, 17 / 255];
const MAX_ZOOM = 1.6;                      // device px per master px, at most
const RHO = 1.25;                          // how far flights zoom out (van Wijk & Nuij); peak width ≈ 0.8 × distance
const params = new URLSearchParams(location.search);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let REDUCED = motion.matches || params.has('still');

const $ = s => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const cmAlong = x => Math.round((W - x) / PX_PER_CM);

// ---------------------------------------------------------------------------------------------------------- layout
let L;
function layout() {
  const vw = innerWidth, vh = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  const portrait = vw < 720 || vw / vh < 1.1;
  const band = { x: 0, y: 0, w: vw, h: portrait ? Math.round(vh * .54) : vh };
  const colW = portrait ? 0 : clamp(vw * .34, 310, 450);
  const safe = portrait ? { top: 58, bottom: 12, side: 14 } : { top: 76, bottom: 92, side: 48 };
  return { vw, vh, dpr, portrait, band, colW, safe, aspect: band.w / band.h };
}
// the part of the band left for the subject (css px within the band), beside the text column
function freeArea(side) {
  const { band, colW, safe, portrait } = L;
  let x0 = safe.side, x1 = band.w - safe.side;
  if (!portrait) { if (side === 'left') x0 = colW + safe.side * .5; else x1 = band.w - colW - safe.side * .5; }
  return { x0, x1, y0: safe.top, y1: band.h - safe.bottom };
}
// keep the camera on the scroll vertically: zoomed in, never past the mount; zoomed out, the whole height in view
function clampCam(c) {
  const h = c.w / L.aspect, lo = -B + h / 2, hi = H + B - h / 2;
  return { cx: c.cx, cy: lo <= hi ? clamp(c.cy, lo, hi) : clamp(c.cy, hi, lo), w: c.w };
}
// frame a rectangle of the painting in the free area
function fit(focus, side) {
  const [x0, y0, x1, y1] = focus, A = freeArea(side), { band } = L;
  let w = Math.max((x1 - x0) * band.w / (A.x1 - A.x0), (y1 - y0) * band.w / (A.y1 - A.y0));
  w = Math.max(w, band.w * L.dpr / MAX_ZOOM);
  const k = band.w / w;
  return clampCam({
    cx: (x0 + x1) / 2 - ((A.x0 + A.x1) / 2 - band.w / 2) / k,
    cy: (y0 + y1) / 2 - ((A.y0 + A.y1) / 2 - band.h / 2) / k, w,
  });
}
const introCam = () => { const w = (L.portrait ? 1.45 : 2.3) * H * L.aspect; return clampCam({ cx: W - .25 * w, cy: H / 2, w }); };
function overviewCam() {
  const w = (W + 700) * (L.portrait ? 1.02 : 1.06), h = w / L.aspect;
  return { cx: W / 2 - 60, cy: H / 2 + (L.portrait ? 0 : .1 * h), w };   // on wide screens the strip sits a little high
}
const toScreen = (cam, x, y) => { const k = L.band.w / cam.w; return [L.band.x + L.band.w / 2 + (x - cam.cx) * k, L.band.y + L.band.h / 2 + (y - cam.cy) * k]; };

// a smooth zoom from camera a to b, from van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003)
function zoomPath(a, b) {
  const r2 = RHO * RHO, r4 = r2 * r2, dx = b.cx - a.cx, dy = b.cy - a.cy, d2 = dx * dx + dy * dy, w0 = a.w, w1 = b.w;
  if (d2 < 1) { const S = Math.log(w1 / w0) / RHO; return t => ({ cx: a.cx + t * dx, cy: a.cy + t * dy, w: w0 * Math.exp(RHO * t * S) }); }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + r4 * d2) / (2 * w0 * r2 * d1), b1 = (w1 * w1 - w0 * w0 - r4 * d2) / (2 * w1 * r2 * d1);
  const q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1), S = (q1 - q0) / RHO;
  return t => {
    const s = t * S, c0 = Math.cosh(q0), u = w0 / (r2 * d1) * (c0 * Math.tanh(RHO * s + q0) - Math.sinh(q0));
    return { cx: a.cx + u * dx, cy: a.cy + u * dy, w: w0 * c0 / Math.cosh(RHO * s + q0) };
  };
}

// --------------------------------------------------------------------------------------------------------- timeline
// Lengths are in screen heights of scrolling and don't depend on the layout, so a resize keeps the reader's place.
let segs = [], total = 0, spans = [], unrollTab, introLeft;
const DS = .004;
function build() {
  segs = []; total = 0;
  const push = (kind, len, o) => { segs.push({ kind, len, s0: total, s1: total + len, ...o }); total += len; };
  const ic = introCam();
  introLeft = ic.cx - ic.w / 2 - ic.w * .01 - 10;
  push('intro', .45, { cam: ic });
  push('unroll', 1.5, { cam: ic });
  let prev = ic, prevAt = W - .25 * ic.w;
  CHAPTERS.forEach((ch, ci) => ch.shots.forEach((shot, si) => {
    const cam = fit(shot.focus, ch.side), at = (shot.focus[0] + shot.focus[2]) / 2;
    const len = si ? .8 : clamp(1 + Math.abs(prevAt - at) / 9000, 1.15, 2.3);
    push('fly', len, { path: zoomPath(prev, cam), from: prev, to: cam, ci, inner: si > 0 });
    const hold = { cam, ch, ci, si, shot };
    push('hold', 1.45 + .32 * shot.points.length, hold);
    prev = holdCam(segs[segs.length - 1], 1); prevAt = at;
  }));
  const oc = overviewCam();
  push('fly', 1.7, { path: zoomPath(prev, oc), from: prev, to: oc, ci: -1 });
  push('outro', 1.6, { cam: oc });
  spans = CHAPTERS.map((ch, ci) => { const h = segs.filter(g => g.kind === 'hold' && g.ci === ci); return { a: h[0].s0, b: h[h.length - 1].s1, first: h[0] }; });
  // How far the scroll is unrolled: it never rolls back up as you read on, and stays just out of sight on the left.
  const n = Math.ceil(total / DS) + 1;
  unrollTab = new Float32Array(n);
  let m = introLeft;
  for (let i = 0; i < n; i++) {
    const s = i * DS, st = sample(s, false);
    if (s < segs[1].s1) { unrollTab[i] = introUnroll(s); continue; }
    m = Math.min(m, st.cam.cx - st.cam.w / 2 - st.cam.w * .01 - 10);
    unrollTab[i] = Math.max(0, m);
  }
}
const introUnroll = s => lerp(W, introLeft, ease(clamp((s - segs[1].s0) / segs[1].len, 0, 1)));
function unrollAt(s) { const f = clamp(s / DS, 0, unrollTab.length - 1), i = Math.floor(f), j = Math.min(i + 1, unrollTab.length - 1); return lerp(unrollTab[i], unrollTab[j], f - i); }
const rollRadius = u => 40 + 170 * Math.sqrt(clamp(u, 0, W) / W);

// during a hold the camera pushes in slowly toward the free area's centre
function holdCam(g, u) {
  const A = freeArea(g.ch.side), { band } = L;
  const w = g.cam.w * (1 - (REDUCED ? 0 : .07) * u), k0 = band.w / g.cam.w, k = band.w / w;
  const ax = (A.x0 + A.x1) / 2 - band.w / 2, ay = (A.y0 + A.y1) / 2 - band.h / 2;
  return clampCam({ cx: g.cam.cx + ax / k0 - ax / k, cy: g.cam.cy + ay / k0 - ay / k, w });
}
function sample(s, full = true) {
  s = clamp(s, 0, total - 1e-6);
  let g = segs[segs.length - 1];
  for (const x of segs) if (s < x.s1) { g = x; break; }
  const t = clamp((s - g.s0) / g.len, 0, 1), st = { s, g, t, spot: 0, fade: 0 };
  if (g.kind === 'fly') {
    if (REDUCED) { st.cam = t < .5 ? g.from : g.to; st.fade = 1 - Math.abs(t - .5) * 2; st.fade = smooth(0, .55, st.fade); }
    else st.cam = clampCam(g.path(ease(t)));
  } else if (g.kind === 'hold') {
    st.cam = holdCam(g, t);
    st.spot = smooth(0, .12, t) * (1 - smooth(.9, 1, t));
  } else st.cam = g.cam;
  if (full) { st.unroll = unrollAt(s); st.roll = rollRadius(st.unroll); }
  return st;
}

// ---------------------------------------------------------------------------------------------------------- the DOM
const canvas = $('#gl'), stage = $('#stage'), ink = $('#ink'), tagsEl = $('#tags'), track = $('#track');

function buildDom() {
  $('#intro').innerHTML = `
    <h1><span class="zh" lang="zh-Hans">${INTRO.zh}</span><span class="en">${INTRO.en}</span></h1>
    <ul class="meta">${INTRO.meta.map(m => `<li>${m}</li>`).join('')}</ul>
    <p class="hint"><span class="arrow" aria-hidden="true">←</span>${INTRO.hint}</p>`;
  const panels = $('#panels');
  CHAPTERS.forEach((ch, ci) => {
    const at = (ch.shots[0].focus[0] + ch.shots[0].focus[2]) / 2;
    const p = el('article', 'panel');
    p.dataset.side = ch.side;
    p.innerHTML = `<div class="inner">
      <p class="kicker"><span class="seal" lang="zh-Hans">${ch.num}</span><span>${cmAlong(at)} cm along the scroll</span></p>
      <h2><span class="zh" lang="zh-Hans">${ch.zh}</span><span class="en">${ch.en}</span></h2>
      <div class="body">${ch.body.map(b => `<p>${b}</p>`).join('')}</div></div>`;
    panels.append(p);
  });
  $('#outro').innerHTML = `
    <h2><span class="zh" lang="zh-Hans">${OUTRO.zh}</span><span class="en">${OUTRO.en}</span></h2>
    ${OUTRO.body.map(b => `<p>${b}</p>`).join('')}
    <p class="actions"><button type="button" data-restart>Read it again from the start</button><button type="button" data-open-sources>Sources</button></p>`;
  const marks = $('#marks'), ticks = $('#map .ticks');
  CHAPTERS.forEach((ch, ci) => {
    const at = (ch.shots[0].focus[0] + ch.shots[0].focus[2]) / 2;
    const b = el('button', 'tick seal', ch.num);
    b.type = 'button'; b.title = `${ch.en} · ${ch.zh}`; b.setAttribute('aria-label', `Go to ${ch.en}`);
    b.style.left = `${at / W * 100}%`;
    b.addEventListener('click', () => jumpTo(spans[ci].first.s0 + spans[ci].first.len * .2));
    ticks.append(b);
    const m = el('button', 'mark', `<span class="seal" lang="zh-Hans">${ch.num}</span><span class="name">${ch.en}</span>`);
    m.type = 'button'; m.dataset.x = at; m.dataset.row = ci % 2; m.tabIndex = -1;
    m.addEventListener('click', () => jumpTo(spans[ci].first.s0 + spans[ci].first.len * .2));
    marks.append(m);
  });
  $('#sources ol').innerHTML = SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('');
  document.addEventListener('click', e => {
    if (e.target.closest('[data-open-sources]')) $('#sources').showModal();
    if (e.target.closest('[data-close]')) $('#sources').close();
    if (e.target.closest('[data-restart]')) jumpTo(0);
  });
  $('#sources').addEventListener('click', e => { if (e.target === $('#sources')) $('#sources').close(); });
}

// three slots for a shot's details: a brush loop, a leader line and a label with a numbered seal
const slots = [0, 1, 2].map(() => {
  const g = svgEl('g', { class: 'pt' });
  const under = svgEl('path', { class: 'loop-under', pathLength: 1 }), loop = svgEl('path', { class: 'loop', pathLength: 1 });
  const lead = svgEl('polyline', { class: 'lead', pathLength: 1 });
  g.append(under, loop, lead); ink.append(g);
  const tag = el('div', 'tag', '<b class="seal"></b><span></span>');
  tag.setAttribute('aria-hidden', 'true');
  tagsEl.append(tag);
  return { g, under, loop, lead, tag, label: null, tw: 0, th: 0 };
});
// a hand-drawn loop: once round and a little more, the radius wandering and opening out slightly
function loopPath(x, y, r, seed) {
  let d = '';
  for (let i = 0, n = 56; i <= n; i++) {
    const t = i / n, a = -2.2 + seed + t * Math.PI * 2.24;
    const rr = r * (1 + .045 * Math.sin(a * 2 + seed * 5) + .07 * t);
    d += `${i ? 'L' : 'M'}${(x + rr * Math.cos(a) * 1.1).toFixed(1)} ${(y + rr * Math.sin(a) * .9).toFixed(1)}`;
  }
  return d;
}
function measure() { for (const s of slots) s.label = null; }

// ----------------------------------------------------------------------------------------------------- per frame
let renderer, tiles, mask, cur = 0, target = 0, snap = true, lastT = performance.now(), t0 = lastT, frameNo = 0;
const panelsEls = () => [...document.querySelectorAll('.panel')];
let panelList = [];

function readScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? clamp(scrollY / max, 0, 1) * total : 0;
}
function jumpTo(s) {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (Math.abs(s - cur) > 4.5) { snap = true; stage.classList.remove('arrive'); void stage.offsetWidth; stage.classList.add('arrive'); }
  window.scrollTo({ top: s / total * max, behavior: 'instant' });
}

function drawFrame(st, time) {
  const { band, dpr } = L, cam = st.cam;
  const need = clamp(Math.floor(-Math.log2(band.w * dpr / cam.w)), 0, 3);
  const vis = tiles.forView(cam.cx - cam.w / 2 - 16, cam.cx + cam.w / 2 + 16, need);
  // warm up the next destination
  const next = st.g.kind === 'fly' ? st.g.to : (st.g.kind === 'hold' && st.t > .5 ? segs[segs.indexOf(st.g) + 1]?.to : null);
  if (next) tiles.prefetch(next.cx - next.w / 2, next.cx + next.w / 2, clamp(Math.floor(-Math.log2(band.w * dpr / next.w)), 0, 3));
  if (++frameNo % 30 === 0) tiles.housekeeping();
  const focus = st.g.kind === 'hold' ? st.g.shot.focus : [0, 0, 0, 0];
  renderer.draw({
    band: { x: 0, y: 0, w: canvas.width, h: canvas.height }, cam, size: [W, H], tiles: vis, mask, time,
    unroll: st.unroll, roll: st.roll, focus, spot: st.spot, mist: 1, border: B, table: TABLE,
  });
}

function overlays(st) {
  const { s, g, t, cam } = st, u = segs[1];
  // the opening: title, the slip on the rolled scroll, the hint
  const introA = 1 - smooth(u.s0 + .05, u.s0 + .6, s);
  $('#intro').style.opacity = introA;
  $('#intro').style.visibility = introA > .001 ? 'visible' : 'hidden';
  const slip = $('#slip'), k = L.band.w / cam.w;
  const [sx, sy] = toScreen(cam, st.unroll - st.roll, H * .1);
  slip.style.opacity = 1 - smooth(u.s0, u.s0 + .3, s);
  slip.style.transform = `translate(${sx}px, ${sy}px) translateX(-50%)`;
  slip.style.width = `${st.roll * 2 * k * .5}px`; slip.style.height = `${H * .62 * k}px`;
  slip.style.fontSize = `${st.roll * 2 * k * .3}px`;
  document.body.classList.toggle('opened', s > u.s0 + .4);

  // chapter text
  panelList.forEach((p, ci) => {
    const { a, b } = spans[ci];
    const al = smooth(a - .4, a + .02, s) * (1 - smooth(b - .05, b + .3, s));
    p.style.opacity = al;
    p.style.visibility = al > .001 ? 'visible' : 'hidden';
    p.style.transform = `translateY(${(1 - smooth(a - .4, a + .1, s)) * 14}px)`;
    if (p.dataset.stagger === '1') {     // a short screen: paragraphs take turns
      const ps = p.querySelectorAll('.body p'), q = clamp((s - a) / (b - a), 0, 1);
      ps.forEach((e, i) => { const lo = i / ps.length, hi = (i + 1) / ps.length; e.style.opacity = (i ? smooth(lo - .04, lo + .03, q) : 1) * (i < ps.length - 1 ? 1 - smooth(hi - .04, hi + .03, q) : 1); });
    }
    p.classList.toggle('current', al > .5);
  });

  // details of the current shot: loops drawn one after another, each followed by its leader line and label
  const pts = g.kind === 'hold' ? g.shot.points : [];
  const out = 1 - smooth(.9, .985, t), A = g.kind === 'hold' ? freeArea(g.ch.side) : null, placed = [];
  slots.forEach((sl, j) => {
    const p = pts[j];
    if (!p) { sl.g.style.opacity = 0; sl.tag.style.opacity = 0; return; }
    if (sl.label !== p.label) {
      sl.tag.querySelector('b').textContent = j + 1; sl.tag.querySelector('span').textContent = p.label;
      sl.label = p.label; sl.tw = sl.tag.offsetWidth; sl.th = sl.tag.offsetHeight;
    }
    const { tw, th } = sl, c0 = .07 + j * (.6 / pts.length);
    const [x, y] = toScreen(cam, p.at[0], p.at[1]), r = Math.max(14, (p.r || 70) * k);
    // the label leads off the way the story says, unless there is more room on the other side
    let [dx, dy] = p.dir;
    const needX = r * 1.1 + 44 + tw;
    const roomR = (g.ch.side === 'right' && !L.portrait ? A.x1 : L.band.w - 6) - x, roomL = x - (g.ch.side === 'left' && !L.portrait ? A.x0 : 6);
    if (dx > 0 && roomR < needX && roomL > roomR) dx = -1; else if (dx < 0 && roomL < needX && roomR > roomL) dx = 1;
    const fitsUp = y - r - 26 - th > L.safe.top - 30, fitsDown = y + r + 26 + th < L.band.h - L.safe.bottom + 10;
    if (dy < 0 && !fitsUp) dy = 1; else if (dy > 0 && !fitsDown) dy = -1;
    // two labels leading toward each other at the same height would cross: send this one the other way vertically
    if (placed.some(q => q.dy === dy && (q.px < x ? q.dx > 0 && dx < 0 : q.dx < 0 && dx > 0)) && (dy < 0 ? fitsDown : fitsUp)) dy = -dy;
    const n = Math.hypot(dx * 1.1, dy * .9), ex = x + dx * 1.1 / n * r * 1.05, ey = y + dy * .9 / n * r * 1.05;
    const kx = ex + dx * 18;
    let tx = clamp(dx > 0 ? kx + 18 : kx - 18 - tw, 6, L.band.w - 6 - tw), ty = ey + dy * 18 - th / 2;
    for (let i = 0; i < 3; i++) {          // step clear of labels already placed
      const hit = placed.find(q => tx < q.x + q.w + 6 && tx + tw + 6 > q.x && ty < q.y + q.h + 5 && ty + th + 5 > q.y);
      if (!hit) break;
      ty = dy > 0 ? hit.y + hit.h + 6 : hit.y - th - 6;
    }
    ty = clamp(ty, L.safe.top - 26, L.band.h - L.safe.bottom + 8 - th);
    placed.push({ x: tx, y: ty, w: tw, h: th, px: x, dx, dy });
    const ky = ty + th / 2, lx = dx > 0 ? Math.max(tx, kx) : Math.min(tx + tw, kx);
    const d = loopPath(x, y, r, j * 1.7 + (g.si || 0));
    sl.under.setAttribute('d', d); sl.loop.setAttribute('d', d);
    sl.lead.setAttribute('points', `${ex.toFixed(1)},${ey.toFixed(1)} ${kx.toFixed(1)},${ky.toFixed(1)} ${lx.toFixed(1)},${ky.toFixed(1)}`);
    const pl = smooth(c0, c0 + .13, t), pd = smooth(c0 + .11, c0 + .17, t), pt = smooth(c0 + .14, c0 + .21, t);
    sl.loop.style.strokeDashoffset = sl.under.style.strokeDashoffset = 1 - pl;
    sl.lead.style.strokeDashoffset = 1 - pd;
    sl.g.style.opacity = out * (pl > 0 ? 1 : 0);
    sl.tag.style.opacity = pt * out;
    sl.tag.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
    sl.tag.querySelector('b').style.transform = `scale(${lerp(1.5, 1, smooth(c0 + .14, c0 + .19, t))})`;
  });

  // the end: the whole scroll with the places visited marked on it
  const o = segs[segs.length - 1], outA = smooth(o.s0 - .45, o.s0 + .05, s);
  $('#outro').style.opacity = outA;
  $('#outro').style.visibility = outA > .001 ? 'visible' : 'hidden';
  const marks = $('#marks');
  $('#map').style.opacity = 1 - outA;
  $('#map').style.visibility = outA < .999 ? 'visible' : 'hidden';
  marks.style.opacity = outA; marks.style.visibility = outA > .001 ? 'visible' : 'hidden';
  for (const m of marks.children) {
    const [mx, my] = toScreen(cam, +m.dataset.x, -B);
    m.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
    m.tabIndex = outA > .5 ? 0 : -1;
  }

  // the strip map: what is still rolled up, where the camera is, which section is open
  const v0 = clamp((cam.cx - cam.w / 2) / W, 0, 1), v1 = clamp((cam.cx + cam.w / 2) / W, 0, 1);
  const view = $('#map .view');
  view.style.left = `${v0 * 100}%`; view.style.width = `${Math.max(.4, (v1 - v0) * 100)}%`;
  $('#map .rolled').style.width = `${st.unroll / W * 100}%`;
  const ci = g.kind === 'hold' ? g.ci : -1;
  document.querySelectorAll('#map .tick').forEach((b, i) => b.classList.toggle('on', i === ci));

  stage.style.opacity = 1 - st.fade;
}

function frame(now) {
  const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  target = readScroll();
  if (Math.abs(target - cur) > 6) { snap = true; stage.classList.remove('arrive'); void stage.offsetWidth; stage.classList.add('arrive'); }
  if (snap || REDUCED) { cur = target; snap = false; }
  else { cur += (target - cur) * (1 - Math.exp(-dt * 6.5)); if (Math.abs(target - cur) < 1e-4) cur = target; }
  const st = sample(cur);
  drawFrame(st, REDUCED ? 9 : (now - t0) / 1000);
  overlays(st);
  window.__qm.state = { s: cur, kind: st.g.kind, ci: st.g.ci, t: st.t, cam: st.cam, unroll: st.unroll, pending: tiles.pending() };
  requestAnimationFrame(frame);
}

function resize(first) {
  const prev = L;
  L = layout();
  document.documentElement.style.setProperty('--col-w', `${L.colW}px`);
  document.documentElement.style.setProperty('--band-h', `${L.band.h}px`);
  document.body.classList.toggle('portrait', L.portrait);
  canvas.style.width = `${L.band.w}px`; canvas.style.height = `${L.band.h}px`;
  canvas.width = Math.round(L.band.w * L.dpr); canvas.height = Math.round(L.band.h * L.dpr);
  ink.setAttribute('viewBox', `0 0 ${L.vw} ${L.vh}`);
  const p = total ? cur / total : 0;
  build();
  // a new scroll length only when the screen really changed; a phone's toolbar sliding away shouldn't move the reader
  if (first || prev.vw !== L.vw || Math.abs(prev.vh - L.vh) > 160) {
    track.style.height = `${Math.round(total * L.vh + L.vh)}px`;
    if (!first) { window.scrollTo({ top: p * (document.documentElement.scrollHeight - innerHeight), behavior: 'instant' }); snap = true; }
  }
  // panels that don't fit a short screen show one paragraph at a time
  for (const pn of panelList) {
    pn.dataset.stagger = '0';
    pn.querySelectorAll('.body p').forEach(e => { e.style.opacity = ''; });
    if (L.portrait && pn.querySelector('.inner').scrollHeight > pn.clientHeight + 1) pn.dataset.stagger = '1';
  }
  measure();
}

function step(dir) {   // ← reads on (leftward), → goes back
  const starts = spans.map(sp => sp.first.s0 + sp.first.len * .2);
  const s = dir > 0 ? starts.find(x => x > cur + .05) ?? total : [...starts].reverse().find(x => x < cur - .3) ?? 0;
  jumpTo(s);
}

async function start() {
  window.__qm = { ready: false };
  buildDom();
  panelList = panelsEls();
  try {
    renderer = createRenderer(canvas);
  } catch (e) {
    $('#loader').classList.add('failed');
    $('#loader p').textContent = 'This scroll is drawn with WebGL 2, which this browser does not provide. A recent Chrome, Edge, Firefox or Safari will show it.';
    return;
  }
  L = layout();
  const small = Math.max(innerWidth, innerHeight) < 1000;
  const [t, m] = await Promise.all([
    createTiles(renderer, 'assets/tiles', { budget: small ? [3, 6] : [5, 8] }),
    fetch('assets/water-mask.png').then(r => r.blob()).then(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })),
  ]);
  tiles = t; mask = renderer.texture(m, false);
  resize(true);
  addEventListener('resize', () => resize(false));
  motion.addEventListener?.('change', e => { REDUCED = e.matches; build(); });
  document.fonts?.ready.then(measure);
  addEventListener('keydown', e => {
    if (e.target.closest?.('dialog, input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(-1); }
  });
  // a link to a section (#bridge) opens there
  const hash = location.hash.slice(1), ci = CHAPTERS.findIndex(c => c.id === hash);
  const s0 = ci >= 0 ? spans[ci].first.s0 + spans[ci].first.len * .2 : params.has('s') ? +params.get('s') : null;
  if (s0 != null) window.scrollTo({ top: s0 / total * (document.documentElement.scrollHeight - innerHeight), behavior: 'instant' });
  snap = true;
  Object.assign(window.__qm, { ready: true, total, segs, spans, go: s => { jumpTo(s); snap = true; }, at: s => sample(s) });
  requestAnimationFrame(now => { lastT = now; frame(now); document.body.classList.add('ready'); });
}
start();

// Birds drawn for this page (they are not in the painting): flocks of crows crossing the sky toward the city and a pair
// of swallows darting over the river, in brush-dark ink. Positions are master px, so they keep their place on the scroll
// whatever the camera does.
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const f2 = v => v.toFixed(3);

// a crow seen from behind, unit wingspan; f = wingbeat, 1 with the wings raised
function crow(f) {
  const ty = -.24 * f, c = -.1 + .5 * ty, c2 = -.02 + .5 * ty;
  return `M-.5 ${f2(ty)}Q-.24 ${f2(c)} 0 .02Q.24 ${f2(c)} .5 ${f2(ty)}Q.24 ${f2(c2)} .03 .1Q-.24 ${f2(c2)} -.5 ${f2(ty)}Z`
    + 'M-.07 .06a.07 .05 0 1 0 .14 0a.07 .05 0 1 0 -.14 0Z';
}
// a swallow seen from above, head toward -y, forked tail
function swallow(f) {
  const ty = f2(.05 + .16 * f);
  return `M0 -.18Q.12 -.12 .5 ${ty}Q.18 .02 .05 .08L.15 .44L0 .16L-.15 .44L-.05 .08Q-.18 .02 -.5 ${ty}Q-.12 -.12 0 -.18Z`;
}
// wings beat in bursts and the bird glides in between
function wingbeat(t, hz, seed) {
  const glide = smooth(.25, .5, .5 + .5 * Math.sin(t * 6.2832 / (2.8 + seed) + seed * 9));
  return .25 + (Math.sin(t * 6.2832 * hz + seed * 20) - .25) * glide;
}

export function createBirds(svg, flocks) {
  const pool = [];
  const path = i => {
    while (pool.length <= i) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.append(p); pool.push(p); }
    return pool[i];
  };

  // every bird alive at time t: { x, y, span, heading (radians, swallows only), f, alpha, kind }
  function birds(t) {
    const out = [];
    for (const F of flocks) {
      if (F.kind === 'swallow') {
        for (let i = 0; i < F.n; i++) {
          const th = 6.2832 * F.speed * t * (1 + .17 * i) + i * 2.1;
          const x = F.center[0] + F.radius[0] * (Math.sin(th) + .25 * Math.sin(2.3 * th));
          const y = F.center[1] + F.radius[1] * Math.sin(2 * th + i);
          const vx = Math.cos(th) + .575 * Math.cos(2.3 * th), vy = 2 * F.radius[1] / F.radius[0] * Math.cos(2 * th + i);
          out.push({ kind: 'swallow', x, y, span: F.span, heading: Math.atan2(vy, vx), f: wingbeat(t, 6.5, i + .3), alpha: 1 });
        }
        continue;
      }
      const [x0, y0] = F.from, [x1, y1] = F.to, T = Math.hypot(x1 - x0, y1 - y0) / F.speed, dir = Math.sign(x1 - x0);
      for (let c = Math.floor((t - T) / F.every); c <= Math.floor(t / F.every); c++) {
        const tau = t - c * F.every;
        if (tau < 0 || tau > T) continue;
        const u = tau / T, lift = (hash(c, 7) - .5) * 160;
        for (let i = 0; i < F.n; i++) {
          const lag = i * F.spread[0] * (.55 + .45 * hash(c, i)), side = (hash(c, i + 50) - .5) * 2 * F.spread[1];
          const x = x0 + (x1 - x0) * u - dir * lag;
          const y = y0 + (y1 - y0) * u + lift + side + F.wave * Math.sin(u * 7 + c + i * .7);
          const alpha = smooth(0, .05, u) * (1 - smooth(.95, 1, u));
          out.push({ kind: 'crow', x, y, span: F.span * (.85 + .3 * hash(c, i + 9)), f: wingbeat(tau, 2.4 + hash(c, i + 3), i + c * .37), alpha });
        }
      }
    }
    return out;
  }

  // view: { toScreen(x, y), k (css px per master px), band {w, h}, focus, spot, x0, x1 (the unrolled part) }
  function update(t, view) {
    let n = 0;
    const { k, band, focus, spot } = view;
    for (const b of birds(t)) {
      const s = b.span * k;
      if (s < 2.5 || b.alpha <= 0 || b.x < view.x0 || b.x > view.x1) continue;   // only over the open silk
      const [sx, sy] = view.toScreen(b.x, b.y);
      if (sx < -s || sx > band.w + s || sy < -s || sy > band.h + s) continue;
      // outside the subject the spotlight dims the birds as it dims the painting
      const dx = Math.max(focus[0] - b.x, b.x - focus[2], 0), dy = Math.max(focus[1] - b.y, b.y - focus[3], 0);
      const dim = 1 - .55 * spot * smooth(0, 160, Math.hypot(dx, dy));
      const p = path(n++);
      p.setAttribute('d', b.kind === 'crow' ? crow(b.f) : swallow(b.f));
      p.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})${b.kind === 'swallow' ? ` rotate(${(b.heading * 57.2958 + 90).toFixed(1)})` : ''} scale(${s.toFixed(2)})`);
      p.style.opacity = (b.alpha * dim).toFixed(3);
      p.style.display = '';
    }
    for (let i = n; i < pool.length; i++) pool[i].style.display = 'none';
  }
  return { update };
}

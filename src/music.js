// The music: 河上春晴 (Clear Spring Day on the River), an original piece for zither and flute in the pentatonic gong
// mode, synthesized by tools/make_music.py. It plays on the scroll and in every 3D scene. Browsers only let a page
// start sound after the visitor does something on it, so it is off until they press a Music button; that choice
// is remembered on this device, and the piece carries on from where it was when they go from the scroll into a
// scene or back. Buttons marked data-music turn it on and off; each shows the state in its .state span, or as its
// whole text.
const URL = 'assets/music/along-the-river.mp3';
const KEY = 'qm-music', AT = 'qm-music-at';
const store = {
  get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, v); } catch { /* private mode: remembered for this page only */ } },
};

let audio = null, want = store.get(KEY) === 'on', fade = 0, level = .85;
const listeners = new Set();

function element() {
  if (audio) return audio;
  audio = new Audio(URL);
  audio.loop = true; audio.preload = 'auto'; audio.volume = 0;
  const at = +store.get(AT, sessionStorage);
  if (at > 0) audio.addEventListener('loadedmetadata', () => { if (at < audio.duration) audio.currentTime = at; }, { once: true });
  addEventListener('pagehide', () => store.set(AT, String(audio.currentTime), sessionStorage));
  audio.addEventListener('playing', show); audio.addEventListener('pause', show);
  return audio;
}
function ramp(to, seconds, done) {               // volume, eased in or out (phones that ignore volume just start and stop)
  cancelAnimationFrame(fade);
  const from = audio.volume, t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / (seconds * 1000));
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * k * k * (3 - 2 * k)));
    if (k < 1) fade = requestAnimationFrame(step); else done?.();
  };
  fade = requestAnimationFrame(step);
}
function start() {
  const a = element();
  a.play().then(() => ramp(level, 2.5)).catch(() => {
    // not allowed yet: wait for the visitor's first touch, click or key on the page
    const go = () => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); if (want) start(); };
    addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
  });
  show();
}
function stop() { if (audio) ramp(0, .8, () => audio.pause()); show(); }
function show() {
  const on = want, playing = audio && !audio.paused;
  document.querySelectorAll('[data-music]').forEach(b => {
    b.setAttribute('aria-pressed', String(on));
    const s = b.querySelector('.state') || b;
    s.textContent = b.dataset.musicLabel ? `${b.dataset.musicLabel} ${on ? 'on' : 'off'}` : on ? 'on' : 'off';
    b.classList.toggle('playing', !!playing);
  });
  listeners.forEach(f => f(on));
}

export const music = {
  get on() { return want; },
  toggle() { want = !want; store.set(KEY, want ? 'on' : 'off'); if (want) start(); else stop(); return want; },
  // how loud against everything else: the 3D scenes turn it down a little while their own sounds play
  level(v) { level = v; if (audio && want && !audio.paused) ramp(v, .6); },
  onChange(f) { listeners.add(f); },
  setup() {
    document.addEventListener('click', e => { if (e.target.closest('[data-music]')) music.toggle(); });
    show();
    if (want) start();
  },
};

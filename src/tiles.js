// The tile pyramid (tools/make_tiles.py): four levels, 1 to 1/8 of the master. Levels 2 and 3 are loaded at start
// (about 1 MB); levels 1 and 0 only where the camera needs them, and the least recently used are released.
export async function createTiles(renderer, base, { budget = [5, 8] } = {}) {
  const meta = await (await fetch(`${base}/tiles.json`)).json();
  const levels = meta.levels.map((L, li) => ({ ...L, li, tiles: L.tiles.map(t => ({ ...t, scale: L.scale, cx0: t.x0, cx1: t.x1, tex: null, state: 'idle', used: 0 })) }));
  const BUDGET = [...budget, Infinity, Infinity];
  let frame = 0;

  async function load(t) {
    t.state = 'loading';
    try {
      const res = await fetch(`${base}/${t.file}`);
      if (!res.ok) throw new Error(res.status);
      const bmp = await createImageBitmap(await res.blob());
      t.tex = renderer.texture(bmp);
      bmp.close?.();
      t.state = 'ready';
    } catch (e) { console.error('tile', t.file, e); t.state = 'failed'; }
  }

  function evict(level) {
    const ready = level.tiles.filter(t => t.state === 'ready').sort((a, b) => a.used - b.used);
    while (ready.length > BUDGET[level.li]) {
      const t = ready.shift();
      renderer.gl.deleteTexture(t.tex); t.tex = null; t.state = 'idle';
    }
  }

  // a tile's extent in master px, clipped to [x0, x1]
  const span = (t, x0, x1) => [Math.max(t.x0 / t.scale, x0), Math.min(t.x1 / t.scale, x1)];
  const overlapping = (level, x0, x1) => level.tiles.filter(t => t.x1 / t.scale > x0 && t.x0 / t.scale < x1);
  const covered = (ranges, [a, b]) => {
    for (const [c, d] of ranges) { if (c <= a && d > a) a = d; if (a >= b) return true; }
    return a >= b;
  };

  // Tiles to draw for a view [x0, x1] (master px) that needs level `need`: finer tiles on top of coarser ones, and a
  // coarser tile only where no finer one is ready yet.
  function forView(x0, x1, need) {
    frame++;
    const out = [], ranges = [];
    for (let li = need; li < levels.length; li++) {
      for (const t of overlapping(levels[li], x0, x1)) {
        if (t.state === 'idle') load(t);
        if (t.state !== 'ready') continue;
        t.used = frame;
        if (!covered(ranges, span(t, x0, x1))) out.push(t);
      }
      for (const t of overlapping(levels[li], x0, x1)) if (t.state === 'ready') ranges.push(span(t, x0, x1));
      ranges.sort((a, b) => a[0] - b[0]);
    }
    return out.reverse();
  }
  // warm the cache for where the camera is going next
  function prefetch(x0, x1, need) {
    for (const t of overlapping(levels[need], x0, x1)) { t.used = frame; if (t.state === 'idle') load(t); }
  }
  function housekeeping() { evict(levels[0]); evict(levels[1]); }
  const pending = () => levels.reduce((n, L) => n + L.tiles.filter(t => t.state === 'loading').length, 0);

  await Promise.all([...levels[3].tiles, ...levels[2].tiles].map(load));
  return { meta, levels, forView, prefetch, housekeeping, pending };
}

// Picture each 3D scene for the gallery at the end of the scroll: the scene lifted out of the painting, seen from a
// chosen angle, with the page's controls hidden. Writes assets/world/<scene>/thumb.webp.
// Usage: serve this folder (python3 -m http.server 8091), then: node tools/make_thumbs.mjs [http://127.0.0.1:8091]
// Needs Playwright with Chromium.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8091';
// where the camera stands for each: yaw from the painter's own direction and pitch (degrees), distance, what it looks at
const VIEWS = {
  road: { yaw: 15, pitch: 16, dist: 1150, focus: [36000, 230, 650] },
  willow: { yaw: 30, pitch: 13, dist: 800, focus: [29870, 180, 1480] },
  grain: { yaw: -20, pitch: 24, dist: 2000, focus: [27600, 150, 600] },
  bridge: { yaw: 29, pitch: 14, dist: 1900, focus: [18690, 280, 1195] },
  gate: { yaw: -20, pitch: 28, dist: 2200, focus: [6800, 500, 0] },
  tavern: { yaw: -25, pitch: 28, dist: 2300, focus: [4400, 300, 500] },
  end: { yaw: -25, pitch: 28, dist: 2200, focus: [1700, 250, 500] },
};
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
for (const [scene, v] of Object.entries(VIEWS)) {
  await page.goto(`${base}/world.html?shot&flat&scene=${scene}`);
  await page.waitForFunction(() => window.__world?.ready, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#top, #controls, #pois, #caption, #note, #about { display: none !important; }' });
  await page.evaluate(v => { __world.manual = true; __world.set({ p: 1, ...v }); for (let i = 0; i < 3; i++) __world.tick(.016, 20 + i * .016); }, v);
  await page.waitForTimeout(500);
  const png = `assets/world/${scene}/thumb.png`;
  await page.screenshot({ path: png });
  execFileSync('python3', ['-c', `from PIL import Image; Image.open('${png}').convert('RGB').resize((640, 400), Image.LANCZOS).save('assets/world/${scene}/thumb.webp', quality=80, method=6)`]);
  execFileSync('rm', [png]);
  console.log(scene);
}
await browser.close();

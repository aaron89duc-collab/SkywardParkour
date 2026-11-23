// Visual tour: teleport to points of interest, take screenshots, and measure perf.
const OUT = require('path').join(__dirname, 'out', 'shots'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const shots = JSON.parse(process.argv[2] || '[]');
  const prefix = process.argv[3] || OUT + '/tour';
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || (m.type()==='warning' && !/GL Driver|GPU stall/.test(m.text()))) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: prefix + '_menu.png' });
  await page.evaluate((m) => window.__game.start(m || undefined), process.env.START || null);
  await page.waitForTimeout(+(process.env.WAIT0 || 0));
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    await page.evaluate((s) => { const g = window.__game; const V = g.player.pos.constructor; g.player.teleport(new V(s.p[0], s.p[1], s.p[2]), s.yaw ?? 0); g.cam.snapTo(new V(s.p[0], s.p[1], s.p[2]), s.cy ?? ((s.yaw ?? 0) + Math.PI)); g.cam.pitch = s.pitch ?? 0.3; g.cam.distance = s.dist ?? 7; }, s);
    await page.waitForTimeout(s.wait ?? 1500);
    const info = await page.evaluate(() => { const g = window.__game; return { st: g.player.state, f: g.player.renderPos.toArray().map(v => +v.toFixed(2)), fps: +g.fpsAvg.toFixed(1) }; });
    console.log(i, JSON.stringify(s.p), '->', JSON.stringify(info));
    await page.screenshot({ path: `${prefix}_${i}.png` });
  }
  const r = await page.evaluate(() => { const g = window.__game; const ri = g.renderer.info; return { geom: ri.memory.geometries, tex: ri.memory.textures, colliders: g.physics.colliderCount }; });
  console.log(JSON.stringify(r));
  console.log(logs.slice(0, 20).join('\n'));
  await browser.close();
})();

const OUT = require('path').join(__dirname, 'out', 'shots'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:5173/';
  const out = process.argv[3] || OUT + '/smoke';
  const script = process.argv[4] || '';
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', m => { if (['error','warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '_menu.png' });
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(1500);
  if (script) { const r = await page.evaluate(script); if (r !== undefined) console.log('script:', JSON.stringify(r)); }
  await page.screenshot({ path: out + '_play.png' });
  const info = await page.evaluate(() => { const g = window.__game; return { state: g.state, feet: g.player.renderPos.toArray().map(v=>+v.toFixed(2)), pstate: g.player.state, colliders: g.physics.colliderCount, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, fps: g.fpsAvg }; });
  console.log(JSON.stringify(info));
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();

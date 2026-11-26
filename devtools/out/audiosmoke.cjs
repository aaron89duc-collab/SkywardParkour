// Smoke test: the real frame loop with sound on, in every loaded map, for a few seconds each (no page errors).
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(async () => { const g = window.__game; await g.loadOtherMaps('map006'); g.audio.init(); g.state = 'playing'; });
  const out = [];
  for (const y of [5, 300, 1000]) {
    await page.evaluate((y) => { const g = window.__game, V = g.player.pos.constructor; g.player.teleport(new V(0, y, 0), 0); }, y);
    await page.waitForTimeout(3000);
    out.push(await page.evaluate(() => { const g = window.__game, a = g.audio; return { map: g.map?.id, prof: a.profileId, music: a.preset ? 'on' : 'off', state: a.ctx.state, t: +a.ctx.currentTime.toFixed(1) }; }));
  }
  console.log(JSON.stringify(out), 'errors:', errs.length ? errs.slice(0, 5) : 0);
  await browser.close();
})();

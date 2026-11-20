// Close-up shots of given world spots (player parked next to each), for before/after visual checks.
// Usage: node devtools/spots.cjs <tag> [url]  -> devtools/out/shots/spot_<tag>_<n>.png
const seedProfile = (c) => c.addInitScript(() => { try { const k = 'skyward-parkour.save.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.profile) { s.profile = { name: 'Tester', id: 'test-tools-0001', token: 'e'.repeat(64) }; localStorage.setItem(k, JSON.stringify(s)); } } catch {} });
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'out', 'shots');
require('fs').mkdirSync(OUT, { recursive: true });
// [name, player feet, camera offset from target, look target]
const SPOTS = [
  ['jumppad', [-16.2, 141.4, -49], [0, 1.8, 4.6], [-19.4, 140.4, -49]],
  ['speedpad', [26, 234.0, 22], [3.5, 1.8, 3.5], [26, 233.75, 25]],
  ['duct', [-54, 167.2, -2], [5, 2.5, 5], [-58.2, 167.8, -6.5]],
  ['crane', [-32.9, 199.07, 47.98], [6, 2, -6], [-27, 199, 52]],
];
(async () => {
  const tag = process.argv[2] || 'x';
  const url = process.argv[3] || 'http://127.0.0.1:4173/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await seedProfile(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(async () => {
    const g = window.__game; g.renderer.setAnimationLoop(null);
    await g.content.check();
    for (const st of g.content.statuses()) if (st.state === 'download' || st.state === 'update') await g.content.install(st.id);
    await g.loadOtherMaps();
    g.renderer.setAnimationLoop(() => g.frame());
  });
  await page.click('[data-mode=adventure]');
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
  for (const [name, feet, off, look] of SPOTS) {
    await page.evaluate(([feet, off, look]) => {
      const g = window.__game, P = g.player;
      P.teleport(P.pos.clone().set(...feet), 0);
      for (let i = 0; i < 40; i++) g.updatePlaying(1 / 60);
      const c = g.cam.camera;
      c.position.set(look[0] + off[0], look[1] + off[1], look[2] + off[2]);
      c.lookAt(look[0], look[1], look[2]);
      c.updateMatrixWorld(true);
      g.maps.update(g.time, c.position, g.env.sunTint, 0);
      if (g.composer) g.composer.render(0); else g.renderer.render(g.scene, c);
    }, [feet, off, look]);
    await page.screenshot({ path: path.join(OUT, `spot_${tag}_${name}.png`) });
  }
  await browser.close();
  console.log('ok');
})();

// Smoke test for Map 002: load both maps, report errors, take a few screenshots.
const { chromium } = require('playwright');
const OUT = require('path').join(__dirname, 'out', 'shots');
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 300)); });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const t0 = Date.now();
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps(); });
  console.log('map002 loaded in', Date.now() - t0, 'ms');
  const views = JSON.parse(process.argv[2] || '[]');
  const info = await page.evaluate(() => {
    const g = window.__game;
    return { colliders: g.physics.colliderCount, maps: [...g.maps.loaded.keys()], movers: g.maps.loaded.get('map002')?.movers.movers.length, ladders: g.maps.ladders().length };
  });
  console.log(JSON.stringify(info));
  let i = 0;
  for (const v of views) {
    await page.evaluate((v) => {
      const g = window.__game; const V = g.player.pos.constructor;
      g.renderer.setAnimationLoop(null);
      g.state = 'playing'; g.ui.hideMenu(); g.ui.showHUD(true);
      g.player.teleport(new V(v[0], v[1], v[2]), v[3]);
      for (let k = 0; k < 20; k++) { g.player.fixedUpdate(1 / 60, g.input, v[3]); g.physics.step(); }
      g.player.syncVisual(1, 1 / 60);
      g.cam.snapTo(g.player.renderPos, v[3] + Math.PI);
      if (v[4] !== undefined) g.cam.pitch = v[4];
      if (v[5] !== undefined) g.cam.distance = v[5];
      for (let k = 0; k < 30; k++) g.cam.update(1 / 60, g.player.renderPos, v[3], 'run', { airBaseY: 0, alignOK: false });
      g.env.update(1 / 60, 1, g.cam.camera, g.player.renderPos);
      g.clouds.update(1 / 60, 1, g.cam.camera.position, g.env.sunTint);
      for (let k = 1; k < 4; k++) g.maps.update(k * 1e5, g.cam.camera.position, g.env.sunTint, 1 / 60);
      g.maps.stepMovers(5, 1 / 60); g.maps.syncMovers(1);
      if (g.composer) g.composer.render(1 / 60); else g.renderer.render(g.scene, g.cam.camera);
    }, v);
    await page.screenshot({ path: `${OUT}/city_${i++}.png` });
  }
  await browser.close();
})();

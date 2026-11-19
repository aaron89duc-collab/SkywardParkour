const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => window.__game.start());
  const P = [[0,0,45],[-3,134.4,-32.5]];
  for (const p of P) {
    await page.evaluate((p) => { const g = window.__game; const V = g.player.pos.constructor; g.player.teleport(new V(...p), 0); g.cam.snapTo(new V(...p), Math.PI); }, p);
    for (let k = 0; k < 3; k++) {
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => { const g = window.__game; g.composer = null; g.renderer.info.autoReset = false; g.renderer.info.reset(); g.renderer.render(g.scene, g.cam.camera); const i = g.renderer.info.render; const out = { calls: i.calls, tris: i.triangles, fps: +g.fpsAvg.toFixed(1), parts: g.fx.dust.points.geometry.drawRange.count }; g.renderer.info.autoReset = true; return out; });
      console.log(JSON.stringify(p), JSON.stringify(r));
    }
  }
  await browser.close();
})();

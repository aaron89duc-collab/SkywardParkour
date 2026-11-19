// Relative render cost per scene child (SwiftShader = CPU rasterizer, so fragment-heavy passes show up).
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; g.start(); g.renderer.setAnimationLoop(null); });
  const views = JSON.parse(process.argv[2] || '[[0,0,45,3.14],[-3,60,0,2.0],[-9,134,-30,3.14]]');
  for (const v of views) {
    const r = await page.evaluate((v) => {
      const g = window.__game, V = g.player.pos.constructor;
      g.player.teleport(new V(v[0], v[1], v[2]), v[3]);
      for (let i = 0; i < 30; i++) { g.player.fixedUpdate(1/60, g.input, v[3]); g.physics.step(); }
      g.player.syncVisual(1, 1/60);
      g.cam.snapTo(g.player.renderPos, v[3]);
      for (let i = 0; i < 20; i++) g.cam.update(1/60, g.player.renderPos, v[3], 'run', { airBaseY: 0, alignOK: false });
      g.env.update(1/60, 1, g.cam.camera, g.player.renderPos);
      g.clouds.update(1/60, 1, g.cam.camera.position, g.env.sunTint);
      for (let k = 1; k < 5; k++) g.maps.update(k * 1e5, g.cam.camera.position, g.env.sunTint);
      const gl = g.renderer.getContext(); const px = new Uint8Array(4);
      const time = (fn, n = 6) => { fn(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); const t0 = performance.now(); for (let i = 0; i < n; i++) { fn(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); } return (performance.now() - t0) / n; };
      const plain = () => g.renderer.render(g.scene, g.cam.camera);
      const out = { full: +time(plain).toFixed(1) };
      if (g.composer) out.composer = +time(() => g.composer.render(1/60)).toFixed(1);
      g.renderer.shadowMap.autoUpdate = false; out.noShadowUpdate = +time(plain).toFixed(1); g.renderer.shadowMap.autoUpdate = true;
      const kids = g.scene.children.slice();
      for (const c of kids) {
        if (!c.visible) continue;
        c.visible = false;
        const t = time(plain);
        c.visible = true;
        const name = (c.name || c.type) + (c.children.length ? `(${c.children.length})` : '');
        out['-' + name] = +(out.full - t).toFixed(1);
      }
      g.renderer.info.autoReset = false; g.renderer.info.reset(); plain(); out.calls = g.renderer.info.render.calls; out.tris = g.renderer.info.render.triangles; g.renderer.info.autoReset = true;
      return out;
    }, v);
    console.log(JSON.stringify(v), JSON.stringify(r));
  }
  await browser.close();
})();

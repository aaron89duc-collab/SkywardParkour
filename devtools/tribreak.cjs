const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  const r = await page.evaluate(() => {
    const g = window.__game; g.start(); g.renderer.setAnimationLoop(null);
    const V = g.player.pos.constructor; g.player.teleport(new V(-3, 60, 0), 2); g.player.syncVisual(1, 0); g.cam.snapTo(g.player.renderPos, 2);
    g.maps.update(1e5, g.cam.camera.position, g.env.sunTint);
    const rows = [];
    g.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints) return;
      const geo = o.geometry; const idx = geo.index ? geo.index.count : geo.attributes.position.count;
      let tris = o.isPoints ? 0 : idx / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      if (o.isInstancedMesh && geo.isInstancedBufferGeometry) {}
      let path = []; let p = o; while (p && p !== g.scene) { path.unshift(p.name || p.type); p = p.parent; }
      rows.push({ path: path.slice(0, 3).join('/') + ' ' + (o.name || ''), tris: tris * n, per: tris, n, shadow: o.castShadow });
    });
    rows.sort((a, b) => b.tris - a.tris);
    const total = rows.reduce((a, b) => a + b.tris, 0);
    return { total, top: rows.slice(0, 25) };
  });
  console.log('total tris (no culling)', r.total);
  for (const x of r.top) console.log(String(x.tris).padStart(8), String(x.per).padStart(7), 'x' + x.n, x.shadow ? 'S' : ' ', x.path);
  await browser.close();
})();

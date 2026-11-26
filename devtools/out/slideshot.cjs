// Screenshots of the player riding Map 007's slides (checks that the sliding surface sits on the models' chutes).
//   node devtools/out/slideshot.cjs  -> /tmp/slide_<id>_<n>.png
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 405 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map007'); g.ui.hideMenu(); g.state = 'playing'; g.applyQuality('medium');
    for (const el of document.body.querySelectorAll('*')) { const st = getComputedStyle(el); if ((st.position === 'fixed' || st.position === 'absolute') && el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.display = 'none'; } });
  for (const id of (process.argv[2] || 'sl61,sl62').split(',')) {
    await page.evaluate(async (id) => {
      const g = window.__game, V = g.player.pos.constructor;
      let dv; for (const m of g.maps.loaded.values()) for (const d of m.devices.list) if (d.d.id === id) dv = d;
      const p0 = dv.slide.pts[0], p1 = dv.slide.pts[1];
      g.player.teleport(new V(p0.x + (p1.x - p0.x) * 0.3, p0.y + 0.3, p0.z + (p1.z - p0.z) * 0.3), Math.atan2(p1.x - p0.x, p1.z - p0.z));
      g.cam.yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z) + Math.PI;
      window.__shots = 0;
    }, id);
    for (let n = 0; n < 4; n++) {
      await page.evaluate(async () => { const g = window.__game; for (let k = 0; k < 9; k++) { g.frame(); await new Promise((r) => setTimeout(r, 18)); } });
      const st = await page.evaluate(() => { const P = window.__game.player; return `${P.state} ${P.slide ? P.slide.s.toFixed(1) + '/' + P.slide.path.L.toFixed(1) : ''} y ${(P.pos.y - 0.8).toFixed(2)}`; });
      console.log(id, n, st);
      await page.screenshot({ path: `/tmp/slide_${id}_${n}.png` });
    }
  }
  await browser.close();
})();

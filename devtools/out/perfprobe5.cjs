// Draw calls / triangles at a few spots per quality, and how long loading a map blocks the main thread.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async () => {
    const g = window.__game, V = g.player.pos.constructor;
    g.renderer.setAnimationLoop(null);
    // long tasks while maps load
    const longs = [];
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(Math.round(e.duration)); });
    try { po.observe({ type: 'longtask', buffered: false }); } catch {}
    const t0 = performance.now();
    await g.loadOtherMaps('map005');
    const loadMs = Math.round(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 200));
    g.ui.hideMenu(); g.state = 'playing';
    const out = { loadMs, longTasks: longs.slice().sort((a, b) => b - a).slice(0, 8), maps: [...g.maps.loaded.keys()] };
    for (const q of ['low', 'medium']) {
      g.applyQuality(q);
      for (const s of [[-68.6, 720, -1.8], [-73, 816, -20], [-50.4, 850, -8], [-73.4, 876, -6], [-52, 935, -7]]) {
        g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
        g.cam.snapTo(new V(s[0], s[1], s[2]), 0.6); g.cam.pitch = 0.2; g.cam.distance = 8;
        g.frame(); g.renderer.info.reset(); g.renderer.info.autoReset = false; g.frame();
        const i = g.renderer.info; out[`${q} ${s[1]}`] = `calls ${i.render.calls} tris ${(i.render.triangles / 1000).toFixed(0)}k geoms ${i.memory.geometries} tex ${i.memory.textures} progs ${i.programs.length}`;
        g.renderer.info.autoReset = true;
      }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

// Average / worst draw calls + triangles over many camera views of a map (spawn, middle, exit; 8 directions;
// looking down and level) at medium quality. arg2 'nocull' = old behaviour (no far copies / no culling).
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map004', NOCULL = process.argv[3] === 'nocull', Q = process.argv[4] || 'medium';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async ([MAP, NOCULL, Q]) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP); g.applyQuality(Q); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
    const d = g.maps.loaded.get(MAP).data;
    g.clock.getDelta = () => 1 / 60;
    const sp = d.spawn.p, ex = d.exit.p;
    const pts = [sp, [(sp[0] + ex[0]) / 2, (sp[1] + ex[1]) / 2, (sp[2] + ex[2]) / 2], ex];
    g.player.teleport(new V(sp[0], sp[1] + 0.9, sp[2]), 0);
    for (let i = 0; i < 10; i++) g.frame();
    await new Promise((res) => setTimeout(res, 6000));
    g.maps.setDetail(NOCULL ? { lod0K: 0, lod0Min: 28, lod0KGood: 0, lod0MinGood: 28, lod1K: 0, lod1Min: 1e9, shadowDist: 0, cullK: 1e9, cullMin: 1e9, spriteK: 1e9, spriteDensity: 1 } : g.maps.detail);
    const R = g.renderer; R.info.autoReset = false;
    const res = [];
    for (const p of pts) {
      for (let k = 0; k < 8; k++) for (const pitch of [0.05, 0.45]) {
        g.player.teleport(new V(p[0], p[1] + 0.9, p[2]), 0);
        g.cam.snapTo(new V(p[0], p[1], p[2]), k * Math.PI / 4); g.cam.pitch = pitch; g.cam.distance = 7;
        g.frame(); g.frame();
        R.info.reset(); g.frame();
        res.push([R.info.render.calls, R.info.render.triangles]);
      }
    }
    const avg = (i) => Math.round(res.reduce((a, b) => a + b[i], 0) / res.length);
    const max = (i) => Math.max(...res.map((x) => x[i]));
    return { views: res.length, avgCalls: avg(0), maxCalls: max(0), avgKTris: Math.round(avg(1) / 1000), maxKTris: Math.round(max(1) / 1000) };
  }, [MAP, NOCULL, Q]);
  console.log(MAP, NOCULL ? 'OLD(no cull)' : 'NEW', Q, JSON.stringify(r));
  await browser.close();
})();

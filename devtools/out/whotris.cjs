// Which objects carry the triangles in one view (main pass and shadow pass, from onAfterRender / onAfterShadow)
// usage: node devtools/out/whotris.cjs <map> <0 spawn|1 middle|2 exit>
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map004', VIEW = Number(process.argv[3] || 0);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async ([MAP, VIEW]) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP); g.applyQuality('medium'); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
    const d = g.maps.loaded.get(MAP).data; g.clock.getDelta = () => 1 / 60;
    const sp = d.spawn.p, ex = d.exit.p, pts = [sp, [(sp[0] + ex[0]) / 2, (sp[1] + ex[1]) / 2, (sp[2] + ex[2]) / 2], ex];
    const p = pts[VIEW];
    g.player.teleport(new V(p[0], p[1] + 0.9, p[2]), 0);
    for (let i = 0; i < 10; i++) g.frame();
    await new Promise((res) => setTimeout(res, 5000));
    g.cam.snapTo(new V(p[0], p[1], p[2]), 0.8); g.cam.pitch = 0.3; g.cam.distance = 7;
    g.maps.setDetail(g.maps.detail); g.frame(); g.frame();
    const label = (o) => {
      let a = o, part = '';
      while (a) { if (['prefabs', 'movers', 'boosters', 'devices', 'maps', 'fx'].includes(a.name)) { part = a.name; break; } a = a.parent; }
      let map = ''; a = o; while (a && a.parent) { if (a.parent.name === 'maps') { map = a.name || '?'; break; } a = a.parent; }
      return `${part || 'other'}:${o.name || o.type}`;
    };
    const tri = (o) => { const gm = o.geometry; if (!gm) return 0; const n = gm.index ? gm.index.count : gm.attributes.position.count; const dr = Math.min(n, gm.drawRange.count); return (dr / 3) * (o.isInstancedMesh ? o.count : 1); };
    const main = {}, shadow = {};
    g.scene.traverse((o) => {
      if (!o.geometry) return;
      o.onAfterRender = () => { const k = label(o); main[k] = (main[k] || 0) + tri(o); };
      o.onAfterShadow = () => { const k = label(o); shadow[k] = (shadow[k] || 0) + tri(o); };
    });
    g.frame();
    const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${Math.round(v / 1000)}k ${k}`);
    const sum = (m) => Math.round(Object.values(m).reduce((a, b) => a + b, 0) / 1000);
    return { mainK: sum(main), shadowK: sum(shadow), main: top(main), shadow: top(shadow) };
  }, [MAP, VIEW]);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

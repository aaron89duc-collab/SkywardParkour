const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async ([x, f, z]) => {
    const g = window.__game, V = g.player.pos.constructor, ph = g.physics;
    g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map003');
    const out = [];
    for (const [ox, oz] of [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14], [-0.27, 0], [-0.22, 0]]) { const h = ph.raycast(new V(x + ox, f + 0.15, z + oz), new V(0, -1, 0), 0.45); out.push(`probe ${ox},${oz}: ${h ? h.point.y.toFixed(2) + ' n' + h.normal.y.toFixed(2) : '-'}`); }
    for (let i = 0; i < 8; i++) { const d = new V(Math.sin(i * Math.PI / 4), 0, Math.cos(i * Math.PI / 4)); const h = ph.raycast(new V(x, f + 0.55, z), d, 0.44); out.push(`wall ${i}: ${h ? h.distance.toFixed(2) + ' ny' + h.normal.y.toFixed(2) + ' n(' + h.normal.x.toFixed(2) + ',' + h.normal.z.toFixed(2) + ')' : '-'}`); }
    return out;
  }, [-59.62, 344.46, -10.6]);
  console.log(r.join('\n'));
  await browser.close();
})();

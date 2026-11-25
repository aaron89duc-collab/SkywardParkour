const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async () => {
    const g = window.__game, V = g.player.pos.constructor, ph = g.physics;
    g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map003');
    const c = new V(-51.25, 321.53 + 0.8 + 0.2, -7.17);
    const out = [];
    const dirs = [[0, 1, 0], [0, -1, 0]]; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; dirs.push([Math.sin(a), 0, Math.cos(a)]); }
    for (const d of dirs) { const h = ph.raycast(c, new V(...d), 30); out.push(h ? `${d.map(v=>v.toFixed(1))} d=${h.distance.toFixed(2)} col=${h.collider.handle} back=${(h.normal.x*d[0]+h.normal.y*d[1]+h.normal.z*d[2]).toFixed(2)}` : `${d} none`); }
    out.push('inside: ' + (g.player.insideCollider(c) ? 'yes' : 'no'));
    return out;
  });
  console.log(r.join('\n'));
  await browser.close();
})();

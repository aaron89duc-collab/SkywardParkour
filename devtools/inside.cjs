const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; });
  const r = await page.evaluate(() => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    const out = [];
    for (const p of [[17,0.3,2],[-16,0.3,30],[15,0.3,26],[-15,0.3,-24],[36,2,-14],[14.6,31.2,-43.6],[0, 2, -14]]) {
      P.teleport(new V(...p), 0); let ev = []; let t = 0;
      for (let i = 0; i < 120; i++) { I.update(); P.fixedUpdate(1/60, I, 0); g.physics.step(); for (const e of P.drainEvents()) if (e.type === 'unstuck') ev.push(i); }
      out.push({ start: p, inside0: !!P.insideCollider(new V(p[0], p[1] + 1.0, p[2])), unstuckAt: ev, end: [P.pos.x, P.pos.y - 0.8, P.pos.z].map(v => +v.toFixed(2)) });
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 0).replace(/\},\{/g, '},\n{'));
  await browser.close();
})();

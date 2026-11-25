// Put the player inside a container (as if they had slipped in) and check that the game gets them out.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async (P0) => {
    const g = window.__game, V = g.player.pos.constructor, P = g.player, I = g.input;
    g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map003');
    P.teleport(new V(P0[0], P0[1] + 0.9, P0[2]), 0);
    I.enabled = true; I.clearEdges(); I.touchMoveY = 0;
    const ev = [];
    let sim = g.simTime;
    for (let i = 0; i < 120; i++) { I.update(); sim += 1 / 60; g.maps.stepMovers(sim, 1 / 60); P.fixedUpdate(1 / 60, I, 0); g.physics.step(); for (const e of P.drainEvents()) if (e.type !== 'step') ev.push(`${(i / 60).toFixed(2)} ${e.type}`); }
    const ic = P.insideCollider(new V(P.pos.x, P.pos.y + 0.2, P.pos.z));
    return { ic: !!ic, hits: P.stuckHits, timer: P.stuckTimer, state: P.state, events: ev, end: [P.pos.x, P.feetY, P.pos.z].map((v) => +v.toFixed(2)) };
  }, JSON.parse(process.argv[2] || '[-57.6,334.5,-10.6]'));
  console.log(JSON.stringify(r));
  await browser.close();
})();

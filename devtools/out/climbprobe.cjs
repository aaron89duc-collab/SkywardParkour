// Press jump again and again at a spot (holding the stick towards a direction): how high does the player get?
// Usage: node devtools/out/climbprobe.cjs '[x,y,z]' '<dirX,dirZ>' [map]
const { chromium } = require('playwright');
(async () => {
  const P0 = JSON.parse(process.argv[2]); const [dx, dz] = (process.argv[3] || '1,0').split(',').map(Number); const MAP = process.argv[4] || 'map003';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async ([P0, dx, dz, MAP, every, TRACE]) => {
    const g = window.__game, V = g.player.pos.constructor, P = g.player, I = g.input;
    g.renderer.setAnimationLoop(null);
    await g.loadOtherMaps(MAP);
    P.teleport(new V(P0[0], P0[1] + 0.9, P0[2]), 0);
    I.enabled = true; I.clearEdges(); I.touchMoveX = 0; I.touchMoveY = 1; I.touchJumpHeld = false;
    const yaw = Math.atan2(-dx, -dz);
    let sim = g.simTime, top = -1e9, last = '', log = [], hold = 0;
    for (let i = 0; i < 60 * 12; i++) {
      if (i % every === 0) { I.pressJump(); hold = 0.3; }
      I.touchJumpHeld = hold > 0; hold -= 1 / 60;
      I.update(); sim += 1 / 60; g.maps.stepMovers(sim, 1 / 60); P.fixedUpdate(1 / 60, I, yaw); g.physics.step();
      for (const e of P.drainEvents()) if (e.type !== 'step') log.push(`${(i / 60).toFixed(2)} ${e.type} y=${P.feetY.toFixed(2)}`);
      const st = P.state + (P.moveKind ? ':' + P.moveKind : '');
      if (st !== last) { log.push(`${(i / 60).toFixed(2)} ${st} y=${P.feetY.toFixed(2)} x=${P.pos.x.toFixed(2)} z=${P.pos.z.toFixed(2)}`); last = st; }
      if (TRACE && i % 10 === 0 && i < 240) log.push(`  t${(i / 60).toFixed(2)} ${P.state} y=${P.feetY.toFixed(2)} x=${P.pos.x.toFixed(2)} vy=${P.vel.y.toFixed(1)} vx=${P.vel.x.toFixed(1)}`);
      top = Math.max(top, P.feetY);
    }
    return { top: +top.toFixed(2), end: [P.pos.x, P.feetY, P.pos.z].map((v) => +v.toFixed(2)), log: log.slice(0, 80) };
  }, [P0, dx, dz, MAP, +(process.env.EVERY || 20), !!process.env.TRACE]);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

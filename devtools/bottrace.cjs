const { chromium } = require('playwright');
(async () => {
  const [A, B] = JSON.parse(process.argv[2]);
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  const r = await page.evaluate(({ A, B }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    g.renderer.setAnimationLoop(null); g.input.enabled = true;
    const dt = 1 / 60, log = [];
    const step = (cy) => { I.update(); P.fixedUpdate(dt, I, cy); g.physics.step(); };
    P.teleport(new V(A[0], A[1] + 0.3, A[2]), 0);
    for (let i = 0; i < 40; i++) step(0);
    let t = 0, hold = 0, jumped = false;
    while (t < 2.5) {
      const fx = P.pos.x, fy = P.pos.y - 0.8, fz = P.pos.z;
      const dx = B[0] - fx, dz = B[2] - fz, dist = Math.hypot(dx, dz);
      I.touchMoveY = 1; I.touchJumpHeld = hold > 0; hold -= dt;
      if (!jumped && P.state === 'ground') {
        const ahead = new V(fx + dx / dist * 0.45, fy + 0.3, fz + dz / dist * 0.45);
        if (!g.physics.raycast(ahead, new V(0, -1, 0), 1.1)) { I.pressJump(); hold = 0.45; I.touchJumpHeld = true; jumped = true; log.push('JUMP'); }
      }
      if (P.state === 'hang') I.pressJump();
      step(Math.atan2(-dx, -dz));
      t += dt;
      log.push(`${t.toFixed(2)} ${P.state} y${(P.pos.y - 0.8 - A[1]).toFixed(2)} vy${P.vel.y.toFixed(1)} sp${P.speed.toFixed(1)} d${dist.toFixed(2)}`);
      if (P.state === 'ground' && jumped && t > 1.5) break;
    }
    return log;
  }, { A, B });
  console.log(r.filter((_, i) => i % 2 === 0).slice(0, 80).join('\n'));
  await browser.close();
})();

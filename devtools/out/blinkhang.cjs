// Hang on the edge of a blinking platform and check the player falls when it blinks out (Map 004, b31)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async () => {
    const g = window.__game, V = g.player.pos.constructor, P = g.player, I = g.input;
    await g.loadOtherMaps('map004'); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
    const dt = 1 / 60; let sim = 0;
    const step = (yaw) => { I.update(); sim += dt; g.maps.stepMovers(sim, dt); P.fixedUpdate(dt, I, yaw); g.physics.step(); P.drainEvents(); };
    const dv = g.maps.loaded.get('map004').devices.list.find((d) => d.d.id === 'b31');
    const top = dv.base.y + dv.d.s[1] / 2;
    // wait until the platform has just appeared
    let prev = dv.active;
    for (let i = 0; i < 600; i++) { sim += dt; g.maps.stepMovers(sim, dt); if (dv.active && !prev) break; prev = dv.active; }
    P.teleport(new V(dv.base.x, top - 1.9, dv.base.z + 1.2 + 0.32), 0);
    I.touchMoveX = 0; I.touchMoveY = 0;
    // hang on the platform's north edge (as if caught in a jump)
    const L = P.buildLedge(new V(dv.base.x, top, dv.base.z + 1.205), new V(0, 0, 1), top, 1.9);
    P.enterHang(L, 0);
    const log = [];
    for (let i = 0; i < 300; i++) {
      step(0);
      if (i % 10 === 0) log.push(`${(i / 60).toFixed(2)}s ${P.state}${dv.active ? '' : '(gone)'} y${(P.pos.y - 0.8).toFixed(2)}`);
    }
    return { top: +top.toFixed(2), log };
  });
  console.log(r.top); console.log(r.log.join('\n'));
  await browser.close();
})();

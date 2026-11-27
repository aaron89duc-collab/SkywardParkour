// Walk into a point from 8 directions (and drop into it) and report where the player ends up / which state.
// usage: node devtools/out/stuckprobe.cjs <map> x y z [secs]
const { chromium } = require('playwright');
const [MAP, X, Y, Z, SECS] = [process.argv[2] || 'map003', +process.argv[3], +process.argv[4], +process.argv[5], +(process.argv[6] || 4)];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async ([MAP, X, Y, Z, SECS]) => {
    const g = window.__game, V = g.player.pos.constructor, P = g.player, I = g.input;
    await g.loadOtherMaps(MAP); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
    const dt = 1 / 60; let sim = 100;
    const step = (yaw) => { I.update(); sim += dt; g.maps.stepMovers(sim, dt); P.fixedUpdate(dt, I, yaw); g.physics.step(); P.drainEvents(); };
    // surface heights around the point
    const grid = [];
    for (let dz = -2; dz <= 2; dz += 0.5) { const row = []; for (let dx = -2; dx <= 2; dx += 0.5) { const h = g.physics.raycast(new V(X + dx, Y + 6, Z + dz), new V(0, -1, 0), 12); row.push(h ? (h.point ? h.point.y : (Y + 6 - h.toi)).toFixed(1) : '----'); } grid.push(row.join(' ')); }
    const out = { grid };
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, sx = X + Math.sin(a) * 3, sz = Z + Math.cos(a) * 3;
      // start 3 m away on whatever is below, walk to the point
      const hit = g.physics.raycast(new V(sx, Y + 4, sz), new V(0, -1, 0), 10);
      const sy = hit ? (hit.point ? hit.point.y : Y + 4 - hit.toi) : Y;
      P.teleport(new V(sx, sy + 0.3, sz), 0);
      I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges?.();
      for (let i = 0; i < 20; i++) step(0);
      const states = [];
      for (let i = 0; i < SECS * 60; i++) {
        const dx = X - P.pos.x, dz = Z - P.pos.z;
        const yaw = Math.atan2(-dx, -dz);
        I.touchMoveY = i < 90 ? 1 : (i < 150 ? 0 : 1); // walk in, stop, then try to walk on
        step(i < 90 ? yaw : yaw + Math.PI);
        if (i % 30 === 0) states.push(P.state);
      }
      // try a jump out
      I.touchJumpHeld = true; for (let i = 0; i < 10; i++) step(0); I.touchJumpHeld = false; for (let i = 0; i < 60; i++) step(0);
      out['from ' + (k * 45) + '°'] = { start: [sx, sy].map((v) => +v.toFixed(1)), end: [P.pos.x, P.pos.y - 0.8, P.pos.z].map((v) => +v.toFixed(2)), state: P.state, vel: [P.vel.x, P.vel.y, P.vel.z].map((v) => +v.toFixed(1)), states: states.join(',') };
    }
    return out;
  }, [MAP, X, Y, Z, SECS]);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

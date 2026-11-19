// Deterministic tests for the advanced moves (ledge catch, shimmy, push-off, lower, roll, mantle, vault).
const OUT = require('path').join(__dirname, 'out', 'shots'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; });
  const shots = [];
  const run = async (name, setup) => {
    const r = await page.evaluate(({ name, setup }) => {
      const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
      const dt = 1 / 60;
      const log = [];
      const S = eval('(' + setup + ')');
      I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges();
      P.teleport(new V(...S.p), S.yaw ?? 0);
      if (S.vel) P.vel.set(...S.vel);
      P.regrab = 0;
      if (S.prep) S.prep(g, P, I, V);
      let camYaw = S.camYaw ?? 0;
      let last = '';
      for (let i = 0; i < Math.round((S.t ?? 2) / dt); i++) {
        const t = i * dt;
        if (S.input) S.input(t, I, P);
        I.update();
        P.fixedUpdate(dt, I, camYaw);
        g.physics.step();
        P.syncVisual(1, dt);
        const st = P.state + (P.moveKind ? ':' + P.moveKind : '');
        if (st !== last) { log.push(`${t.toFixed(2)} ${st} feet=${P.renderPos.toArray().map(v => v.toFixed(2)).join(',')} vy=${P.vel.y.toFixed(1)}`); last = st; }
        for (const e of P.drainEvents()) if (e.type !== 'step') log.push(`   ev ${e.type}${e.speed !== undefined ? ' ' + e.speed.toFixed(1) : ''}${e.drop !== undefined ? ' drop ' + e.drop.toFixed(1) : ''}`);
        if (S.shotAt && Math.abs(t - S.shotAt) < dt / 2) {
          const f = P.renderPos; g.cam.snapTo(f, S.shotCam ?? (P.yaw + Math.PI + 0.9)); g.cam.pitch = 0.15; g.cam.distance = 4.5; g.cam.update(0.016, f, P.yaw, false, false);
          g.env.update(0.016, 1, g.cam.camera, f); g.renderer.render(g.scene, g.cam.camera);
          window.__shot = g.renderer.domElement.toDataURL('image/jpeg', 0.8);
        }
      }
      log.push(`end ${P.state} feet=${P.renderPos.toArray().map(v => v.toFixed(2)).join(',')}`);
      return log;
    }, { name, setup });
    console.log('== ' + name + '\n' + r.join('\n'));
    const shot = await page.evaluate(() => { const s = window.__shot; window.__shot = null; return s; });
    if (shot) { require('fs').writeFileSync(`${OUT}/move_${name}.jpg`, Buffer.from(shot.split(',')[1], 'base64')); }
  };
  if (process.argv[2] !== 'islands') {
  // podium at (-9,140,-37), 6.4 wide: west face x=-12.2
  await run('catch', `{ p: [-12.75, 141.2, -38], yaw: -Math.PI/2, t: 1.2, shotAt: 1.1 }`);
  await run('fastfall_nocatch', `{ p: [-12.75, 147, -38], yaw: -Math.PI/2, t: 2.5 }`);
  await run('shimmy', `{ p: [-12.75, 141.2, -38], yaw: -Math.PI/2, t: 3.2, camYaw: Math.PI/2, input: (t, I) => { I.touchMoveX = t > 0.8 ? 1 : 0; }, shotAt: 1.6 }`);
  await run('pushoff', `{ p: [-12.75, 141.2, -38], yaw: -Math.PI/2, t: 2.0, camYaw: Math.PI/2, input: (t, I) => { if (t > 0.8) { I.touchMoveY = 1; } if (Math.abs(t - 0.9) < 0.01) { I.pressJump(); I.touchJumpHeld = true; } }, shotAt: 1.2 }`);
  await run('climb', `{ p: [-12.75, 141.2, -38], yaw: -Math.PI/2, t: 2.2, input: (t, I) => { if (Math.abs(t - 0.8) < 0.01) I.pressJump(); }, shotAt: 1.15 }`);
  await run('lower_button', `{ p: [-11.75, 140.05, -38], yaw: -Math.PI/2, t: 1.6, input: (t, I) => { if (Math.abs(t - 0.3) < 0.01) I.pressDrop(); }, shotAt: 0.75 }`);
  await run('walkoff_slow', `{ p: [-10.8, 140.05, -38], yaw: -Math.PI/2, t: 2.0, camYaw: Math.PI/2, input: (t, I) => { I.touchMoveY = 0.4; } }`);
  await run('runoff_roll', `{ p: [15, 6.9, 25.6], yaw: 0, t: 2.0, camYaw: Math.PI, input: (t, I) => { I.touchMoveY = 1; }, shotAt: 0.75 }`);
  await run('air_mantle', `{ p: [-13.3, 139.1, -38], yaw: Math.PI/2, vel: [3.5, 2.5, 0], t: 1.5, camYaw: -Math.PI/2, input: (t, I) => { I.touchMoveY = 1; }, shotAt: 0.3 }`);
  await run('vault', `{ p: [30, 0.05, 37], yaw: Math.PI, t: 2.0, camYaw: 0, prep: (g, P, I, V) => { g.physics.addBox(new V(30, 0.55, 31), new V(1.6, 0.55, 0.3)); g.physics.step(); }, input: (t, I) => { I.touchMoveY = 1; }, shotAt: 0.92 }`);
  await run('ground_mantle', `{ p: [34, 0.05, 37], yaw: Math.PI, camYaw: 0, prep: (g, P, I, V) => { g.physics.addBox(new V(34, 0.6, 30), new V(1.6, 0.6, 1.6)); g.physics.step(); }, input: (t, I) => { I.touchMoveY = t < 2.2 ? 0.5 : 0; }, t: 2.6, shotAt: 1.75 }`);
  }
  if (process.argv[2] === 'islands') {
    await run('island_I5_west', `{ p: [-1.2, 95.3, 27], yaw: -Math.PI/2, t: 1.4, shotAt: 1.3 }`);
    await run('island_I1_east', `{ p: [20.9, 32.2, -41.5], yaw: Math.PI/2, t: 1.4, shotAt: 1.3 }`);
    await run('island_WF1_north', `{ p: [-21, 90.2, 8.9], yaw: Math.PI, t: 1.4, shotAt: 1.3 }`);
  }
  await browser.close();
})();

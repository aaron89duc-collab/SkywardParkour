// Map 006 mechanics check (app 4): a tilted bounce cap throws you sideways, the cap squashes, a folding leaf
// bends down after you stand on it, a swaying leaf moves by itself. Runs in the dev server on Map 001's ground.
//   node devtools/out/mech6.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const r = await page.evaluate(async () => {
    const g = window.__game, P = g.player, V = P.pos.constructor;
    g.renderer.setAnimationLoop(null); g.state = 'playing';
    const Y = 300, X = 400, Z = 400; // empty sky far from everything
    const sys = await g.maps.addDevices([
      { t: 'trampoline', id: 'm_up', p: [X, Y, Z], s: [3, 1, 3], bounce: 0.9, min: 14, max: 24 },
      { t: 'trampoline', id: 'm_dir', p: [X + 20, Y, Z], r: 90, s: [3, 1, 3], bounce: 0.9, min: 14, max: 24, push: 9 },
      { t: 'tilt', id: 'leaf_fold', p: [X + 40, Y, Z], s: [3, 0.4, 6], maxAngle: 30, fold: 1.0 },
      { t: 'tilt', id: 'leaf_sway', p: [X + 60, Y, Z], s: [3, 0.4, 6], maxAngle: 10, sway: 4 },
    ]);
    let sim = 0;
    const step = (n) => { for (let i = 0; i < n; i++) { sim += 1 / 60; g.maps.stepMovers(sim, 1 / 60); P.fixedUpdate(1 / 60, g.input, 0); g.physics.step(); } };
    const out = {};
    const dev = (id) => sys.list.find((d) => d.d.id === id);
    // 1. straight bounce
    P.teleport(new V(X, Y + 3, Z), 0); step(1);
    let maxY = -1e9, hv = 0, squashMin = 9;
    for (let i = 0; i < 120; i++) { step(1); maxY = Math.max(maxY, P.feetY); squashMin = Math.min(squashMin, dev('m_up').inner.scale.y); }
    out.straight = { apex: +(maxY - Y).toFixed(2), x: +(P.pos.x - X).toFixed(2), squashMin: +squashMin.toFixed(2) };
    // 2. tilted cap (yaw 90: pushes +x)
    P.teleport(new V(X + 20, Y + 3, Z), 0); step(1);
    let landed = null; maxY = -1e9;
    for (let i = 0; i < 40; i++) { step(1); maxY = Math.max(maxY, P.feetY); hv = Math.max(hv, P.vel.x); }
    out.tilted = { apex: +(maxY - Y).toFixed(2), maxVx: +hv.toFixed(2), dx40: +(P.pos.x - X - 20).toFixed(2), dz40: +(P.pos.z - Z).toFixed(2) };
    // 3. folding leaf: stand on it, watch the tilt
    P.teleport(new V(X + 40, Y + 0.05, Z), 0); step(1);
    const fold = [];
    for (let i = 0; i < 180; i++) { step(1); if (i % 30 === 29) fold.push(+((dev('leaf_fold').tilt ?? 0) * 57.3).toFixed(1)); }
    out.fold = fold;
    // 4. swaying leaf with nobody on it
    const sway = [];
    for (let i = 0; i < 240; i++) { step(1); if (i % 40 === 39) sway.push(+((dev('leaf_sway').tilt ?? 0) * 57.3).toFixed(1)); }
    out.sway = sway;
    return out;
  });
  console.log(JSON.stringify(r));
  await browser.close();
})();

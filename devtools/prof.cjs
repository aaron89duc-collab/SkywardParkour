// CPU profile of per-tick / per-frame JS work (excluding GPU): runs random play-like movement around the map.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; });
  const res = await page.evaluate(() => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    const T = {}; const add = (k, ms) => { const e = T[k] || (T[k] = { sum: 0, max: 0, n: 0 }); e.sum += ms; e.n++; if (ms > e.max) e.max = ms; };
    const spots = [[0,0,45],[-12,20,10],[20,40,-10],[-20,60,0],[10,90,-20],[-5,120,-30]];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const s of spots) {
      P.teleport(new V(s[0], s[1] + 25, s[2]), 0);
      for (let i = 0; i < 900; i++) {
        if (i % 40 === 0) { I.touchMoveX = rnd() * 2 - 1; I.touchMoveY = rnd() * 2 - 1; }
        I.touchJumpHeld = (i % 70) < 20;
        I.update();
        let t0 = performance.now(); P.fixedUpdate(1 / 60, I, rnd() * 6.28); add('player.fixedUpdate', performance.now() - t0);
        t0 = performance.now(); g.physics.step(); add('physics.step', performance.now() - t0);
        if (i % 1 === 0) {
          t0 = performance.now(); P.syncVisual(1, 1 / 60); add('player.syncVisual', performance.now() - t0);
          t0 = performance.now(); g.env.update(1 / 60, i / 60, g.cam.camera, P.renderPos); add('env.update', performance.now() - t0);
          t0 = performance.now(); g.clouds.update(1 / 60, i / 60, g.cam.camera.position, g.env.sunTint); add('clouds.update', performance.now() - t0);
          t0 = performance.now(); g.fx.update(1 / 60, i / 60); add('fx.update', performance.now() - t0);
          t0 = performance.now(); g.maps.update(i / 60 * 1000, g.cam.camera.position, g.env.sunTint); add('maps.update', performance.now() - t0);
          t0 = performance.now(); g.cam.update(1 / 60, P.renderPos, P.yaw, 'run', { airBaseY: 0, alignOK: false }); add('cam.update', performance.now() - t0);
        }
        P.drainEvents();
      }
    }
    const out = {};
    for (const [k, e] of Object.entries(T)) out[k] = { avg: +(e.sum / e.n).toFixed(3), max: +e.max.toFixed(2), n: e.n };
    out.colliders = g.physics.colliderCount;
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})();

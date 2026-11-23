// Highest point the Map 004 updrafts can throw a player (walking in / jumping in): no fan may reach a shortcut.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async () => {
    const g = window.__game, V = g.player.pos.constructor, P = g.player, I = g.input;
    g.renderer.setAnimationLoop(null);
    await g.loadOtherMaps('map004');
    const devs = [...g.maps.loaded.get('map004').devices.list].filter((d) => d.d.t === 'fan');
    const out = {};
    for (const dv of devs) {
      for (const jump of [false, true]) {
        P.teleport(new V(dv.base.x, dv.base.y + 0.9, dv.base.z), 0);
        I.enabled = true; I.clearEdges(); I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false;
        let top = -1e9, sim = g.simTime;
        for (let i = 0; i < 60 * 6; i++) {
          if (jump && i === 20) { I.pressJump(); I.touchJumpHeld = true; }
          if (i === 45) I.touchJumpHeld = false;
          I.update(); sim += 1 / 60; g.maps.stepMovers(sim, 1 / 60); P.fixedUpdate(1 / 60, I, 0); g.physics.step(); P.drainEvents();
          top = Math.max(top, P.feetY);
        }
        out[`${dv.d.id}${jump ? '+jump' : ''}`] = `base ${dv.base.y.toFixed(1)} top ${top.toFixed(1)} (+${(top - dv.base.y).toFixed(1)})`;
      }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

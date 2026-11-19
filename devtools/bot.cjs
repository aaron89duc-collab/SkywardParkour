// Physics bot: walks/jumps every consecutive pair of each route using the real controller + colliders.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const routes = JSON.parse(fs.readFileSync(__dirname + '/out/routes.json', 'utf8'));
  const only = process.argv[2];
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; });
  const res = await page.evaluate(({ routes, only }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    const dt = 1 / 60;
    const step = (camYaw) => { I.update(); P.fixedUpdate(dt, I, camYaw); g.physics.step(); };
    const out = {};
    for (const [name, pts] of Object.entries(routes)) {
      if (only && name !== only) continue;
      const fails = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const A = pts[k].p, B = pts[k + 1].p;
        let ok = false, why = '';
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          P.teleport(new V(A[0], A[1] + 0.3, A[2]), 0);
          I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges();
          for (let i = 0; i < 40; i++) step(0);
          const startFeet = P.renderPos.clone(); startFeet.copy(P.pos); startFeet.y -= 0.8;
          if (Math.abs(startFeet.y - A[1]) > 0.6) { why = `start not standable (y ${startFeet.y.toFixed(2)} vs ${A[1]})`; continue; }
          let t = 0, holdJump = 0, lastJump = -1, stuckT = 0;
          // attempt variants: different jump trigger distance
          const edgeProbe = [0.45, 0.25, 0.65][attempt];
          while (t < 6) {
            const feet = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
            const dx = B[0] - feet.x, dz = B[2] - feet.z, dist = Math.hypot(dx, dz);
            const camYaw = Math.atan2(-dx, -dz);
            if (P.state === 'air') {
              // competent air control: steer so the landing point matches the target
              const vy = P.vel.y, g = vy > 0 ? 30 : 42, h = feet.y - B[1];
              const disc = vy * vy + 2 * 42 * Math.max(-1, h + vy * vy / (2 * 30) * (vy > 0 ? 1 : 0));
              const tl = vy > 0 ? vy / 30 + Math.sqrt(Math.max(0, 2 * (h + vy * vy / 60) / 42)) : (vy + Math.sqrt(Math.max(0, disc))) / 42;
              const land = P.speed * tl;
              I.touchMoveY = dist > land + 0.2 ? 1 : dist < land - 0.4 ? -1 : 0;
              void g;
            } else I.touchMoveY = dist > 0.35 ? (dist < 0.9 && B[1] - feet.y < 0.4 ? 0.45 : 1) : 0;
            I.touchJumpHeld = holdJump > 0;
            holdJump -= dt;
            if (P.state === 'hang') { I.pressJump(); }
            else if (P.state === 'ground' && t - lastJump > 0.35) {
              const nx = dx / (dist || 1), nz = dz / (dist || 1);
              const ahead = new V(feet.x + nx * edgeProbe, feet.y + 0.3, feet.z + nz * edgeProbe);
              const hit = g.physics.raycast(ahead, new V(0, -1, 0), 1.1);
              const blocked = P.speed < 1.2 && t > 0.35 && dist > 0.7;
              const needUp = B[1] - feet.y > 0.42 && dist < 1.2;
              // skilled timing: take off when the full-jump flight distance matches the distance to the target
              const dh = B[1] - feet.y;
              const flight = dh < 2.0 ? (11.2 / 30 + Math.sqrt(Math.max(0, 2 * (2.09 - dh) / 42))) * Math.max(P.speed, 3) : 0;
              const timed = dh > -6 && dist > 1.0 && flight > 0 && dist <= flight * 0.92 && dist >= flight * 0.6 && P.speed > 4.5;
              if ((!hit && dist > 0.6) || blocked || needUp || timed) { I.pressJump(); holdJump = dh < 0.5 && !blocked ? 0.16 : dh < 1.1 && !blocked ? 0.24 : 0.45; I.touchJumpHeld = true; lastJump = t; }
            }
            step(camYaw);
            t += dt;
            const f2 = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
            const d2 = Math.hypot(B[0] - f2.x, B[2] - f2.z);
            if (P.state === 'ground' && d2 < 1.0 && f2.y > B[1] - 0.45 - (pts[k + 1].label === 'EXIT' ? 1 : 0) && f2.y < B[1] + 1.6) { ok = true; break; }
            if (f2.y < Math.min(A[1], B[1]) - 2.5) { why = `fell to ${f2.y.toFixed(1)} (d ${d2.toFixed(1)})`; break; }
            if (P.speed < 0.2 && P.state === 'ground') stuckT += dt; else stuckT = 0;
            if (stuckT > 1.5) { why = `stuck at ${f2.x.toFixed(1)},${f2.y.toFixed(1)},${f2.z.toFixed(1)} d=${d2.toFixed(2)}`; break; }
          }
          if (!ok && !why) why = 'timeout';
        }
        if (!ok) fails.push({ k, from: A.map(v => +v.toFixed(1)), to: B.map(v => +v.toFixed(1)), label: pts[k + 1].label, why });
      }
      out[name] = { pairs: pts.length - 1, fails };
    }
    return out;
  }, { routes, only });
  for (const [k, v] of Object.entries(res)) {
    console.log(`${k}: ${v.pairs - v.fails.length}/${v.pairs} ok`);
    for (const f of v.fails) console.log('   FAIL', JSON.stringify(f));
  }
  await browser.close();
})();

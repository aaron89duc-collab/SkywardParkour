// Physics bot for Map 002: walks/jumps every consecutive pair of each route with the real controller,
// real colliders and the real moving platforms (deterministic sim time), including ladders, pads, rings,
// riding the crane and hover platforms.
// Usage: node devtools/bot2.cjs [route] [k]   (k = single pair index, prints a state trace)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const routes = JSON.parse(fs.readFileSync(__dirname + '/out/routes002.json', 'utf8'));
  const only = process.argv[2];
  const onlyK = process.argv[3] ? parseInt(process.argv[3]) : -1;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(() => window.__game.loadOtherMaps());
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; });
  const res = await page.evaluate(({ routes, only, onlyK, verbose }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    const dt = 1 / 60;
    let sim = 0;
    const movers = {};
    for (const m of g.maps.loaded.values()) for (const mv of m.movers.movers) movers[mv.data.id] = mv;
    const events = [];
    let segPad = false;
    const step = (camYaw) => {
      I.update();
      sim += dt;
      g.maps.stepMovers(sim, dt);
      P.fixedUpdate(dt, I, camYaw);
      g.physics.step();
      for (const e of P.drainEvents()) { events.push(e.type); if (e.type === 'pad') segPad = true; }
    };
    const parkStart = (mv, k) => {
      // absolute sim time when the mover starts parking at end k, at or after `sim`
      const r = mv.nextPark(sim, k);
      return sim + r.in;
    };
    const out = {};
    let unstuck = 0;
    for (const [name, pts] of Object.entries(routes)) {
      if (only && name !== only) continue;
      const fails = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        if (onlyK >= 0 && k !== onlyK) continue;
        const trace = [];
        const A = pts[k].p, B = pts[k + 1].p;
        const act = pts[k + 1].act || '';
        const actA = pts[k].act || '';
        let ok = false, why = '';
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          why = '';
          const [kind, mid, end] = act.split(':');
          const [kindA, midA] = actA.split(':');
          const mv = mid ? movers[mid] : null;
          // align moving platforms: boarding waits ~1.5 s, a ride starts with the platform parked at A
          if ((kind === 'crane' || kind === 'hover') && end === 'A') sim = parkStart(mv, 0) - 1.2 - attempt * 0.8;
          if ((kind === 'crane' || kind === 'hover') && end === 'B') sim = parkStart(mv, 0) + 0.3;
          if ((kindA === 'crane' || kindA === 'hover') && actA.endsWith(':B')) { const m2 = movers[midA]; sim = parkStart(m2, 1) + 0.2; }
          g.maps.stepMovers(sim, dt); g.maps.stepMovers(sim, dt);
          P.teleport(new V(A[0], A[1] + 0.3, A[2]), 0);
          I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges();
          for (let i = 0; i < 30; i++) step(0);
          const sf = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
          if (P.state !== 'air' && P.state !== 'ground' && P.state !== 'ladder' && Math.abs(sf.y - A[1]) > 0.6) { why = `start not standable (state ${P.state} y ${sf.y.toFixed(2)} vs ${A[1]})`; continue; }
          if (P.state === 'ground' && Math.abs(sf.y - A[1]) > 0.7) { why = `start not standable (y ${sf.y.toFixed(2)} vs ${A[1]})`; continue; }
          let t = 0, holdJump = 0, lastJump = -1, stuckT = 0, hangDropped = false, prevVy = 0; // caught a ledge far above the target: let go once, like a player would
          segPad = false;
          const nextAct = pts[k + 2]?.act || '';
          const edgeProbe = [0.45, 0.25, 0.65][attempt];
          const tmax = kind === 'crane' || kind === 'hover' ? 40 : kind === 'ladder' ? 14 : 7;
          while (t < tmax) {
            const feet = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
            const dx = B[0] - feet.x, dz = B[2] - feet.z, dist = Math.hypot(dx, dz);
            const camYaw = Math.atan2(-dx, -dz);
            I.touchMoveX = 0;
            let skipJump = false;
            if (kind === 'crane' || kind === 'hover') {
              if (end === 'A') {
                // wait on the edge until the platform is parked, then step aboard
                const r = mv.nextPark(sim, 0);
                const parked = r.in === 0 && r.stay > 0.6;
                I.touchMoveY = parked ? (dist > 0.35 ? 1 : 0) : 0;
                if (!parked) skipJump = true;
              } else {
                // ride: stand still until parked at the far end
                I.touchMoveY = 0; skipJump = true;
                const r = mv.nextPark(sim, 1);
                if (r.in === 0 && Math.hypot(feet.x - B[0], feet.z - B[2]) < 3 && Math.abs(feet.y - B[1]) < 0.8 && P.state === 'ground') { ok = true; break; }
              }
            } else if (P.state === 'ladder') {
              I.touchMoveY = 1; skipJump = true;
            } else if (P.state === 'air') {
              const vy = P.vel.y, h = feet.y - B[1];
              const disc = vy * vy + 2 * 42 * Math.max(-1, h + vy * vy / (2 * 30) * (vy > 0 ? 1 : 0));
              const tl = vy > 0 ? vy / 30 + Math.sqrt(Math.max(0, 2 * (h + vy * vy / 60) / 42)) : (vy + Math.sqrt(Math.max(0, disc))) / 42;
              const land = P.speed * tl;
              I.touchMoveY = dist > land + 0.2 ? 1 : dist < land - 0.12 ? -1 : 0; // momentum is kept in the air: pull back to stop
              if (P.boosting && dist > 2) I.touchMoveY = 1;
            } else I.touchMoveY = dist > 0.35 ? (dist < 0.9 && B[1] - feet.y < 0.4 ? 0.45 : 1) : 0;
            I.touchJumpHeld = holdJump > 0;
            holdJump -= dt;
            if (P.state === 'hang') { if (P.ledge && P.ledge.y - B[1] > 1.2 && !hangDropped && prevVy < -1) { I.pressDrop(); hangDropped = true; } else if (t - lastJump > 0.3) { I.pressJump(); lastJump = t; } }
            else if (P.state === 'ground' && t - lastJump > 0.35 && !skipJump) {
              const nx = dx / (dist || 1), nz = dz / (dist || 1);
              const ahead = new V(feet.x + nx * edgeProbe, feet.y + 0.3, feet.z + nz * edgeProbe);
              const hit = g.physics.raycast(ahead, new V(0, -1, 0), 1.1);
              const blocked = P.actualSpeed < 1.2 && t > 0.35 && dist > 0.7;
              const dh = B[1] - feet.y;
              const needUp = dh > 0.42 && dist < 1.2;
              const sp = Math.max(P.speed, 3);
              const flight = dh < 2.45 ? (12.4 / 30 + Math.sqrt(Math.max(0, 2 * (2.55 - dh) / 42))) * sp : 0;
              const timed = dh > -6 && dist > 1.0 && flight > 0 && dist <= flight * 0.92 && dist >= flight * 0.6 && P.speed > 4.5;
              const onPad = (kind === 'pad' && t < 0.5) || /flight top/.test(pts[k + 1].label);
              if (!onPad && ((!hit && dist > 0.6) || blocked || needUp || timed)) { I.pressJump(); holdJump = dh < 0.5 && !blocked ? 0.16 : dh < 1.1 && !blocked ? 0.24 : 0.45; I.touchJumpHeld = true; lastJump = t; }
            }
            if (P.state !== 'hang') prevVy = P.vel.y;
            step(camYaw);
            t += dt;
            if (onlyK >= 0) { const st = P.state + (P.moveKind ? ':' + P.moveKind : ''); if (!trace.length || trace[trace.length - 1].s !== st || (verbose && Math.round(t * 60) % 10 === 0)) trace.push({ s: st, t: +t.toFixed(2), p: [P.pos.x, P.pos.y - 0.8, P.pos.z].map(v => +v.toFixed(2)), mv: I.touchMoveY, sp: +P.speed.toFixed(2), vy: +P.vel.y.toFixed(1) }); }
            if (ok) break;
            if (kind === 'topad' && segPad) { ok = true; break; }
            if (nextAct === 'ladder' && P.state === 'ladder') { ok = true; break; }
            if ((kind === 'crane' || kind === 'hover') && end === 'A' && P.riding && P.riding.data.id === mid && P.state === 'ground') { ok = true; break; }
            const f2 = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
            const d2 = Math.hypot(B[0] - f2.x, B[2] - f2.z);
            const tol = kind === 'crane' || kind === 'hover' ? 1.6 : 1.0;
            if (kind !== 'crane' && kind !== 'hover' || end === 'A') {
              if (P.state === 'ground' && d2 < tol && f2.y > B[1] - 0.45 - (pts[k + 1].label === 'EXIT' ? 1 : 0) && f2.y < B[1] + 1.6) { ok = true; break; }
            }
            if (f2.y < Math.min(A[1], B[1]) - 2.5) { why = `fell to ${f2.y.toFixed(1)} (d ${d2.toFixed(1)})`; break; }
            if (P.actualSpeed < 0.2 && P.state === 'ground' && !skipJump) stuckT += dt; else stuckT = 0;
            if (stuckT > 2.0) { why = `stuck at ${f2.x.toFixed(1)},${f2.y.toFixed(1)},${f2.z.toFixed(1)} d=${d2.toFixed(2)} state ${P.state}`; break; }
          }
          if (!ok && !why) why = `timeout at ${[P.pos.x, P.pos.y - 0.8, P.pos.z].map(v => v.toFixed(1)).join(',')} state ${P.state}`;
        }
        if (!ok) fails.push({ k, from: A.map(v => +v.toFixed(1)), to: B.map(v => +v.toFixed(1)), label: pts[k + 1].label, act, why, trace: onlyK >= 0 ? trace : undefined });
      }
      out[name] = { pairs: pts.length - 1, fails };
    }
    unstuck = events.filter((e) => e === 'unstuck').length;
    return { out, unstuck, pads: events.filter((e) => e === 'pad').length, rings: events.filter((e) => e === 'ring').length, ladders: events.filter((e) => e === 'ladder').length };
  }, { routes, only, onlyK, verbose: !!process.env.VERBOSE });
  console.log(`events: unstuck ${res.unstuck}, pads ${res.pads}, rings ${res.rings}, ladders ${res.ladders}`);
  for (const [k, v] of Object.entries(res.out)) {
    console.log(`${k}: ${v.pairs - v.fails.length}/${v.pairs} ok`);
    for (const f of v.fails) console.log('   FAIL', JSON.stringify(f));
  }
  await browser.close();
})();

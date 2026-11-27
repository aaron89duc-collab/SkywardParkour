// Physics bot (Map 002 onwards): walks/jumps every consecutive pair of each route with the real controller,
// real colliders and the real moving platforms (deterministic sim time), including ladders, pads, rings,
// riding the crane and hover platforms, and Map 004's devices (every device is reset at the start of a pair):
//   act on the START point  turn:<id>   ride the turntable until it faces the target, then go
//                            plate:<id>  stand on the pressure plate a moment first
//   act on the TARGET point  turn:<id>  board the turntable (ok when standing on it)
//                            via:<id,..> drop onto these trampolines in turn, then steer to the target
//                            blink:<id>  start when that blinking platform has just appeared
//                            fan:<id>    walk into the updraft, steer to the target once above it
//                            zip:<id>    jump to the cable, ride it, steer to the target after letting go
//                            cannon:<id> walk into the cannon, steer to the target in flight
//                            elev:<id>   stand on the elevator until it is at the top
//                            sweep:<id>  wait until the sweeping bar has just passed, then go
//   a sweeping bar about to hit the bot makes it jump (carousel); low gravity is part of the air steering
// Usage: node devtools/bot2.cjs [route] [k]   (k = single pair index, prints a state trace)
//   ROUTES=routes003.json MAP=map003 node devtools/bot2.cjs   (another map's routes; MAP = map the world is centred on)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const routes = JSON.parse(fs.readFileSync(__dirname + '/out/' + (process.env.ROUTES || 'routes002.json'), 'utf8'));
  const MAP = process.env.MAP || null;
  const only = process.argv[2];
  const onlyK = process.argv[3] ? parseInt(process.argv[3]) : -1;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(async (MAP) => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps(MAP || undefined); }, MAP);
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; });
  const res = await page.evaluate(({ routes, only, onlyK, verbose }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    const dt = 1 / 60;
    let sim = 0;
    const movers = {};
    for (const m of g.maps.loaded.values()) for (const mv of m.movers.movers) movers[mv.data.id] = mv;
    const devs = {};
    for (const m of g.maps.loaded.values()) for (const dv of m.devices?.list ?? []) devs[dv.data.id] = dv;
    // device ids repeat between maps (t22 in Map 006 and Map 007): the map being tested (the one the player starts in) wins
    { const here = g.maps.mapAt(routes.main[0].p[0], routes.main[0].p[1], routes.main[0].p[2]); const own = here && g.maps.loaded.get(here.id); if (own) for (const dv of own.devices?.list ?? []) devs[dv.data.id] = dv; } // own map wins
    const resetDevices = () => { for (const m of g.maps.loaded.values()) m.devices?.reset(sim); };
    const events = [];
    let segPad = false, segBounce = 0, segLaunch = false, segZip = false;
    const mod = (a, b) => ((a % b) + b) % b;
    const blinkOn = (dv, t) => mod(t + (dv.d.phase ?? 0), (dv.d.on ?? 2) + (dv.d.off ?? 1.5));
    // next moment (>= t) a blinking platform appears
    const nextOn = (dv, t) => { const T = (dv.d.on ?? 2) + (dv.d.off ?? 1.5), u = blinkOn(dv, t); return u < 0.05 ? t : t + (T - u); };
    // sweeping bars: seconds until an arm reaches the angle of point (x, z) (Infinity when the point is out of reach)
    const sweepEta = (dv, x, z) => {
      const L = dv.d.radius ?? 4, arms = dv.d.arms ?? 1, w = ((dv.d.speed ?? 90) * Math.PI) / 180;
      const rx = x - dv.base.x, rz = z - dv.base.z, r = Math.hypot(rx, rz);
      if (r > L + 0.5 || r < 0.4) return Infinity;
      const pa = Math.atan2(rx, rz);
      let best = Infinity;
      for (let i = 0; i < arms; i++) {
        const a = dv.ang + ((dv.d.r ?? 0) * Math.PI) / 180 + (i / arms) * Math.PI * 2;
        const da = mod((pa - a) * Math.sign(w), Math.PI * 2);
        best = Math.min(best, da / Math.abs(w));
      }
      return best;
    };
    const sweepers = Object.values(devs).filter((dv) => dv.d.t === 'sweeper');
    const step = (camYaw) => {
      I.update();
      sim += dt;
      g.maps.stepMovers(sim, dt);
      P.fixedUpdate(dt, I, camYaw);
      g.physics.step();
      for (const e of P.drainEvents()) { events.push(e.type); if (e.type === 'pad') segPad = true; if (e.type === 'bounce') segBounce++; if (e.type === 'launch') segLaunch = true; if (e.type === 'zip') segZip = true; }
    };
    const parkStart = (mv, k) => {
      // absolute sim time when the mover starts parking at end k, at or after `sim`
      const r = mv.nextPark(sim, k);
      return sim + r.in;
    };
    const RIDE = new Set(['crane', 'hover', 'rotor', 'swing']);
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
          if (RIDE.has(kind) && end === 'A') sim = parkStart(mv, 0) - (kind === 'swing' ? 0.9 + attempt * 0.25 : 1.2 + attempt * 0.8);
          if (RIDE.has(kind) && end === 'B') sim = parkStart(mv, 0) + (kind === 'swing' ? 0.05 : 0.3);
          if (RIDE.has(kindA) && actA.endsWith(':B')) { const m2 = movers[midA]; sim = parkStart(m2, 1) + (kindA === 'swing' ? -0.45 : 0.2); }
          if (kind === 'blink') {
            // start just before the target appears, while the platform we stand on (if it blinks too) is still there
            const dv = devs[mid], dA = kindA === 'blink' ? devs[midA] : null;
            let t0 = nextOn(dv, sim) - 0.25 - attempt * 0.2;
            for (let k = 0; k < 8 && dA && blinkOn(dA, t0) > (dA.d.on ?? 2) - 0.7; k++) t0 = nextOn(dv, t0 + 0.5) - 0.25 - attempt * 0.2;
            sim = t0;
          }
          if (kind === 'sweep') {
            // the bar has just swept past the path: a full turn to cross
            const dv = devs[mid];
            for (let k = 0; k < 400; k++) { g.maps.stepMovers(sim, dt); if (sweepEta(dv, (A[0] + B[0]) / 2, (A[2] + B[2]) / 2) > 2.6) break; sim += 0.05; }
          }
          resetDevices();
          // the gem portal route starts with every gem collected
          if (name === 'portal') for (const m of g.maps.loaded.values()) if (m.devices) m.devices.markCollected(m.devices.list.filter((dv) => dv.d.t === 'collectible').map((dv) => dv.d.id));
          if (kindA === 'elev') { const e = devs[midA]; e.st = 2; e.stT = 0; e.pos.set(...e.d.b); e.prev.copy(e.pos); e.group.position.copy(e.pos); } // the elevator waits at the top
          segBounce = 0; segLaunch = false; segZip = false;
          g.maps.stepMovers(sim, dt); g.maps.stepMovers(sim, dt);
          P.teleport(new V(A[0], A[1] + 0.3, A[2]), 0);
          I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges();
          for (let i = 0; i < 30; i++) step(0);
          const sf = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
          if (P.state !== 'air' && P.state !== 'ground' && P.state !== 'ladder' && Math.abs(sf.y - A[1]) > 0.6) { why = `start not standable (state ${P.state} y ${sf.y.toFixed(2)} vs ${A[1]})`; continue; }
          if (P.state === 'ground' && Math.abs(sf.y - A[1]) > 0.7) { why = `start not standable (y ${sf.y.toFixed(2)} vs ${A[1]})`; continue; }
          let letGo = 0, t = 0, holdJump = 0, lastJump = -1, stuckT = 0, hangDropped = false, prevVy = 0, turnGo = false, plateT = 0, viaI = 0, fanUp = false, waitEnd = 0;
          const via = kind === 'via' ? mid.split(',') : null; // caught a ledge far above the target: let go once, like a player would
          segPad = false;
          const nextAct = pts[k + 2]?.act || '';
          const edgeProbe = [0.45, 0.25, 0.65][attempt];
          const tmax = RIDE.has(kind) ? 40 : kind === 'ladder' ? 16 : kindA === 'turn' ? 40 : kind === 'elev' ? 20 : kind === 'via' || kind === 'zip' || kind === 'fan' ? 12 : 7;
          while (t < tmax) {
            const feet = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
            // in the air momentum is kept: push on while the landing point is short of the target, pull back past it
            const airSteer = (dist, h) => {
              const vy = P.vel.y, gs = P.fieldOut ? P.fieldOut.g : 1, gu = 30 * gs, gd = 42 * gs;
              const disc = vy * vy + 2 * gd * Math.max(-1, h + vy * vy / (2 * gu) * (vy > 0 ? 1 : 0));
              const tl = vy > 0 ? vy / gu + Math.sqrt(Math.max(0, 2 * (h + vy * vy / (2 * gu)) / gd)) : (vy + Math.sqrt(Math.max(0, disc))) / gd;
              const land = P.speed * tl;
              return dist > land + 0.2 ? 1 : dist < land - 0.12 ? -1 : 0;
            };
            // where to steer: the next trampoline, the fan, the cable, the cannon - then the target
            let G = B, noJump = false;
            if (via && viaI < via.length) { const d = devs[via[viaI]]; G = [d.base.x, d.base.y, d.base.z]; noJump = P.state !== 'ground' || viaI > 0; }
            if (kind === 'fan' && !fanUp) { const d = devs[mid]; G = [d.base.x, d.base.y, d.base.z]; noJump = true; if (feet.y > B[1] + 0.6) fanUp = true; }
            if (kind === 'cannon' && !segLaunch) { const d = devs[mid]; G = [d.base.x, d.base.y, d.base.z]; noJump = true; }
            if (kind === 'zip' && !segZip) { const d = devs[mid]; G = [d.base.x, feet.y, d.base.z]; }
            const dx = G[0] - feet.x, dz = G[2] - feet.z, dist = Math.hypot(dx, dz);
            // letting go of a ledge = holding the stick away from the wall (forward along the ledge normal)
            const camYaw = letGo > 0 && P.state === 'hang' && P.ledge ? Math.atan2(-P.ledge.normal.x, -P.ledge.normal.z) : Math.atan2(-dx, -dz);
            I.touchMoveX = 0;
            let skipJump = false;
            if (kindA === 'plate' && plateT < 1.3) { plateT += dt; I.touchMoveY = 0; skipJump = true; waitEnd = t; }
            else if (kind === 'elev') { I.touchMoveY = 0; skipJump = true; if (P.state === 'ground' && Math.abs(feet.y - B[1]) < 0.5 && Math.hypot(feet.x - B[0], feet.z - B[2]) < 1.6) { ok = true; break; } }
            else if (P.state === 'zip') { I.touchMoveY = 0; skipJump = true; }
            else if (kindA === 'turn' && !turnGo) {
              // riding a turntable: stand still until it has carried us to the side facing the target
              const dv = devs[midA], c = dv.pos;
              const ax = feet.x - c.x, az = feet.z - c.z, bx = B[0] - c.x, bz = B[2] - c.z;
              const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
              if (cos > 0.93 && P.state === 'ground') turnGo = true;
              I.touchMoveY = 0; skipJump = true; waitEnd = t;
              if (t > 30) { why = 'turntable never faced the target'; break; }
            } else if (RIDE.has(kind)) {
              if (end === 'A') {
                // wait on the edge until the platform is parked, then step aboard (a swing: go just before it arrives)
                const r = mv.nextPark(sim, 0);
                const parked = kind === 'swing' ? (r.in === 0 && r.stay > 0.25) || (r.in > 0 && r.in < 0.25) : r.in === 0 && r.stay > 0.6;
                I.touchMoveY = parked ? (dist > 0.35 ? 1 : 0) : 0;
                if (P.state === 'air') I.touchMoveY = airSteer(dist, feet.y - G[1]); // in the air: brake over the platform
                else if (!parked) { skipJump = true; waitEnd = t; }
              } else {
                // ride: stand still until parked at the far end
                I.touchMoveY = 0; skipJump = true;
                const r = mv.nextPark(sim, 1);
                if (r.in === 0 && Math.hypot(feet.x - B[0], feet.z - B[2]) < 3 && Math.abs(feet.y - B[1]) < 0.8 && P.state === 'ground') { ok = true; break; }
              }
            } else if (P.state === 'ladder') {
              I.touchMoveY = 1; skipJump = true;
            } else if (P.state === 'air') {
              I.touchMoveY = airSteer(dist, feet.y - G[1]);
              if (P.boosting && dist > 2) I.touchMoveY = 1;
              if ((via && viaI < via.length) || (kind === 'cannon' && !segLaunch)) I.touchMoveY = dist > 0.25 ? 1 : 0;
              if (kind === 'fan' && !fanUp) {
                // riding the updraft: stay over its centre (brake when sliding across it, a player lets go of the stick)
                const toward = (P.vel.x * dx + P.vel.z * dz) / (dist || 1);
                I.touchMoveY = dist < 1.0 && toward > 0.8 ? -1 : dist > 0.25 ? 1 : 0;
              }
            } else if (kind === 'fan' && !fanUp) I.touchMoveY = dist > 2.2 ? 1 : dist > 0.3 ? 0.4 : 0; // walk into the updraft
            else I.touchMoveY = dist > 0.35 ? (dist < 0.9 && B[1] - feet.y < 0.4 ? 0.45 : 1) : 0;
            if (kind === 'zip' && !segZip && P.state === 'ground' && dist < 1.9 && t - lastJump > 0.4) { I.pressJump(); holdJump = 0.45; lastJump = t; skipJump = true; }
            if (noJump) skipJump = true;
            // a sweeping bar about to reach us: jump over it
            if (P.state === 'ground') for (const sw of sweepers) { if (Math.abs(feet.y - sw.base.y) < 0.6 && sweepEta(sw, feet.x, feet.z) < 0.3 && t - lastJump > 0.35) { I.pressJump(); holdJump = 0.3; lastJump = t; } }
            I.touchJumpHeld = holdJump > 0;
            holdJump -= dt;
            if (P.state === 'hang' && letGo > 0) { I.touchMoveY = 1; letGo -= dt; }
            else if (P.state === 'hang') { if (P.ledge && P.ledge.y - B[1] > 1.2 && !hangDropped && prevVy < -1) { hangDropped = true; letGo = 0.5; } else if (t - lastJump > 0.3) { I.pressJump(); lastJump = t; } }
            else if (P.state === 'ground' && t - lastJump > 0.35 && !skipJump) {
              const nx = dx / (dist || 1), nz = dz / (dist || 1);
              const ahead = new V(feet.x + nx * edgeProbe, feet.y + 0.3, feet.z + nz * edgeProbe);
              const hit = g.physics.raycast(ahead, new V(0, -1, 0), 1.1);
              const blocked = P.actualSpeed < 1.2 && t - waitEnd > 0.35 && dist > 0.7;
              const dh = G[1] - feet.y;
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
            if (via && segBounce > viaI) viaI = segBounce;
            if (ok) break;
            if (kind === 'topad' && segPad) { ok = true; break; }
            if (nextAct === 'ladder' && P.state === 'ladder') { ok = true; break; }
            if (RIDE.has(kind) && end === 'A' && P.riding && P.riding.data.id === mid && P.state === 'ground') { ok = true; break; }
            if (kind === 'turn' && P.riding && P.riding.data.id === mid && P.state === 'ground') { ok = true; break; }
            const f2 = new V(P.pos.x, P.pos.y - 0.8, P.pos.z);
            const d2 = Math.hypot(B[0] - f2.x, B[2] - f2.z);
            const tol = RIDE.has(kind) ? 1.6 : 1.0;
            const devDone = (!via || viaI >= via.length) && (kind !== 'fan' || fanUp) && (kind !== 'cannon' || segLaunch) && (kind !== 'zip' || segZip);
            if ((!RIDE.has(kind) || end === 'A') && devDone) {
              if (P.state === 'ground' && d2 < tol && f2.y > B[1] - 0.45 - (pts[k + 1].label === 'EXIT' ? 1 : 0) && f2.y < B[1] + 1.6) { ok = true; break; }
            }
            const floor = via ? Math.min(...via.map((id) => devs[id].base.y)) - 2.5 : kind === 'zip' ? Math.min(A[1], B[1]) - 6 : Math.min(A[1], B[1]) - 2.5;
            if (f2.y < floor) { why = `fell to ${f2.y.toFixed(1)} (d ${d2.toFixed(1)})`; break; }
            if (P.actualSpeed < 0.2 && P.state === 'ground' && !skipJump && !(kindA === 'turn' && !turnGo) && !(kindA === 'plate' && plateT < 1.3)) stuckT += dt; else stuckT = 0;
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

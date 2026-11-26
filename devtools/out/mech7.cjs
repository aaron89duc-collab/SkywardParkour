// Map 007 mechanics check (app 5): slides (straight + kicker, spiral), ball pit, latched plate + drawbridge,
// ordered plate puzzle + revealed stairs, swing kick. Runs in the dev server, far out in empty sky.
//   node devtools/out/mech7.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const r = await page.evaluate(async () => {
    const g = window.__game, P = g.player, V = P.pos.constructor, I = g.input;
    g.renderer.setAnimationLoop(null); g.state = 'playing';
    const Y = 300, X = 400, Z = 400;
    // spiral: one turn of radius 2.6 dropping 5 m, then a short straight run-out
    const sp = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; sp.push([X + 80 + Math.sin(a) * 2.6, Y + 5 - (i / 24) * 5, Z + Math.cos(a) * 2.6]); }
    sp.push([X + 80 + 0.0, Y, Z + 2.6 + 0]); // (same point as the last; dropped below)
    sp.pop();
    const last = sp[sp.length - 1];
    sp.push([last[0] - 3, Y - 0.3, last[2]]);
    const sys = await g.maps.addDevices([
      // straight slide 6 m down over 12 m, flat 2 m, a kicker 1.2 m long rising 0.5 m; ground far below the end
      { t: 'slide', id: 'sl1', p: [X, Y + 6, Z], pts: [[X, Y + 6, Z], [X, Y, Z + 12], [X, Y, Z + 14], [X, Y + 0.5, Z + 15.2]], w: 1.6 },
      { t: 'oneway', id: 'deck1', p: [X, Y + 6, Z - 2.5], s: [4, 0.4, 5] },
      { t: 'oneway', id: 'land1', p: [X, Y - 2, Z + 26], s: [8, 0.4, 20] },
      { t: 'slide', id: 'sl2', p: sp[0], pts: sp, w: 1.4 },
      { t: 'oneway', id: 'land2', p: [X + 70, Y - 0.5, Z + 2.6], s: [14, 0.4, 8] },
      // ball pit with soft walls, ground around it
      { t: 'pit', id: 'pit', p: [X + 40, Y, Z], s: [6, 1, 6], rim: 0.35, sink: 0.7 },
      { t: 'oneway', id: 'pitfloor', p: [X + 40, Y - 0.7, Z], s: [20, 0.4, 20] },
      // plates: a latched one lowering a drawbridge, a 3-plate puzzle revealing 3 steps (group)
      { t: 'oneway', id: 'pl_ground', p: [X + 120, Y, Z], s: [30, 0.4, 30] },
      { t: 'plate', id: 'lp', p: [X + 110, Y + 0.15, Z], s: [1.5, 0.15, 1.5], latch: true, target: 'bridge' },
      { t: 'reveal', id: 'bridge', p: [X + 110, Y + 0.2, Z + 5], s: [2, 0.3, 8], tip: 80 },
      { t: 'plate', id: 'q1', p: [X + 120, Y + 0.15, Z], s: [1.5, 0.15, 1.5], puzzle: 'pz', order: 1, target: 'steps' },
      { t: 'plate', id: 'q2', p: [X + 123, Y + 0.15, Z], s: [1.5, 0.15, 1.5], puzzle: 'pz', order: 2 },
      { t: 'plate', id: 'q3', p: [X + 126, Y + 0.15, Z], s: [1.5, 0.15, 1.5], puzzle: 'pz', order: 3 },
      { t: 'reveal', id: 'st1', grp: 'steps', p: [X + 130, Y + 1.2, Z], s: [2, 0.4, 2], delay: 0 },
      { t: 'reveal', id: 'st2', grp: 'steps', p: [X + 130, Y + 2.4, Z + 2], s: [2, 0.4, 2], delay: 0.3 },
      { t: 'reveal', id: 'st3', grp: 'steps', p: [X + 130, Y + 3.6, Z + 4], s: [2, 0.4, 2], delay: 0.6 },
    ]);
    let sim = 0;
    const events = [];
    const step = (n) => { for (let i = 0; i < n; i++) { sim += 1 / 60; g.maps.stepMovers(sim, 1 / 60); P.fixedUpdate(1 / 60, I, 0); g.physics.step(); for (const e of sys.drainEvents()) events.push(e.k + ':' + e.id); P.drainEvents(); } };
    const dev = (id) => sys.list.find((d) => d.d.id === id);
    const out = {};
    I.moveX = 0; I.moveY = 0;
    // 1. straight slide with a kicker
    P.teleport(new V(X, Y + 6.05, Z - 1.5), 0); step(2);
    I.moveY = -1; // stick toward +z (camera yaw 0 faces -z)
    let entered = -1, maxV = 0, exitAt = null, t0 = sim, landed = null;
    for (let i = 0; i < 400; i++) {
      step(1);
      if (P.state === 'slide' && entered < 0) { entered = +(sim - t0).toFixed(2); I.moveY = 0; }
      if (P.state === 'slide') maxV = Math.max(maxV, P.slide.v);
      if (!exitAt && entered >= 0 && P.state !== 'slide') exitAt = { t: +(sim - t0).toFixed(2), v: [+P.vel.x.toFixed(1), +P.vel.y.toFixed(1), +P.vel.z.toFixed(1)], z: +(P.pos.z - Z).toFixed(1) };
      if (exitAt && P.grounded) { landed = { t: +(sim - t0).toFixed(2), z: +(P.pos.z - Z).toFixed(1), y: +(P.feetY - Y).toFixed(1), state: P.state }; break; }
    }
    out.slide = { entered, maxV: +maxV.toFixed(1), exitAt, landed };
    // 2. spiral slide: drop onto its top
    P.teleport(new V(sp[0][0], sp[0][1] + 1.2, sp[0][2]), 0); step(1);
    let e2 = -1, lat = [], t1 = sim, ex2 = null, maxV2 = 0;
    for (let i = 0; i < 600; i++) {
      step(1);
      if (P.state === 'slide') { if (e2 < 0) e2 = +(sim - t1).toFixed(2); maxV2 = Math.max(maxV2, P.slide.v); if (i % 20 === 0) lat.push(+P.slide.lat.toFixed(2)); }
      if (e2 >= 0 && P.state !== 'slide' && !ex2) ex2 = { t: +(sim - t1).toFixed(2), sp: +Math.hypot(P.vel.x, P.vel.z).toFixed(1), x: +(P.pos.x - X - 80).toFixed(1), z: +(P.pos.z - Z).toFixed(1) };
      if (ex2 && P.grounded) { ex2.land = { x: +(P.pos.x - X - 80).toFixed(1), y: +(P.feetY - Y).toFixed(1), st: P.state }; break; }
    }
    out.spiral = { entered: e2, maxV: +maxV2.toFixed(1), exit: ex2, lat: lat.slice(0, 6) };
    // 3. jumping off mid-slide
    P.teleport(new V(X, Y + 6.05, Z - 0.3), 0); step(1); I.moveY = -1;
    for (let i = 0; i < 120 && P.state !== 'slide'; i++) step(1);
    I.moveY = 0; step(30);
    const zj = P.pos.z, sv = P.slide ? P.slide.v : -1;
    I.pressJump(); I.jumpHeld = true; step(2); I.jumpHeld = false;
    out.slideJump = { vBefore: +sv.toFixed(1), state: P.state, vy: +P.vel.y.toFixed(1), vz: +P.vel.z.toFixed(1), z: +(zj - Z).toFixed(1) };
    step(120);
    // 4. ball pit: fall 6 m in, then run and jump
    P.teleport(new V(X + 40, Y + 6, Z), 0); step(1);
    let st4 = new Set();
    for (let i = 0; i < 90; i++) { step(1); st4.add(P.state); }
    const sink = +(P.feetY - Y).toFixed(2);
    I.moveY = -1; step(25);
    const runSp = +P.speed.toFixed(2);
    I.moveY = 0; step(30);
    const y0 = P.feetY; let top = y0;
    I.pressJump(); I.jumpHeld = true;
    for (let i = 0; i < 60; i++) { step(1); top = Math.max(top, P.feetY); }
    I.jumpHeld = false; step(60);
    const hopping = dev('pit').balls.b.filter((b) => b.y > 0).length;
    out.pit = { states: [...st4], sink, runSpeed: runSp, jumpApex: +(top - y0).toFixed(2) };
    // walk into the balls to make them hop
    P.teleport(new V(X + 40, Y - 0.6, Z), 0); step(2); I.moveY = 1; let hop = 0;
    for (let i = 0; i < 60; i++) { step(1); hop = Math.max(hop, dev('pit').balls.b.filter((b) => b.y > 0.05).length); }
    I.moveY = 0;
    out.pit.ballsHopping = hop;
    // 5. latched plate -> drawbridge
    const tipBefore = dev('bridge').u;
    P.teleport(new V(X + 110, Y + 0.3, Z), 0); step(30);
    P.teleport(new V(X + 115, Y + 0.3, Z - 4), 0); step(90);
    out.latch = { before: tipBefore, after: +dev('bridge').u.toFixed(2), latched: dev('lp').latched };
    // 6. puzzle: 2 (wrong), 1, 3 (wrong), 1, 2, 3
    const on = (id) => { const d = dev(id); P.teleport(new V(d.base.x, Y + 0.3, d.base.z), 0); step(20); P.teleport(new V(X + 118, Y + 0.3, Z - 4), 0); step(10); };
    const solidSteps = () => ['st1', 'st2', 'st3'].map((id) => +dev(id).u.toFixed(2));
    on('q2'); const a = ['q1', 'q2', 'q3'].map((id) => dev(id).lit);
    on('q1'); on('q3'); const b = ['q1', 'q2', 'q3'].map((id) => dev(id).lit);
    on('q1'); on('q2'); const c = solidSteps();
    on('q3'); step(20); const d1 = solidSteps(); step(60); const d2 = solidSteps();
    // can we stand on the top step?
    P.teleport(new V(X + 130, Y + 4.5, Z + 4), 0); step(60); out.standTop = +(P.feetY - Y).toFixed(2);
    // 7. swing kick: two seats, one plain (older behaviour), one with kick 1.3 / vmax 12 and a tilted look
    const ms = [...g.maps.loaded.values()][0].movers, n0 = ms.movers.length;
    const sw = (id, x, extra) => ({ id, kind: 'swing', pts: [[x, Y + 4, Z]], pivot: [x, Y + 8, Z], len: 4, amp: 40, period: 2.6, speed: 0, wait: 0, r: 0, rope: false,
      model: { file: 'none', s: 1, boxes: [[0, -0.1, 0, 0.8, 0.1, 0.6]] }, ...extra });
    await ms.build([sw('swA', X + 160, {}), sw('swB', X + 180, { kick: 1.3, vmax: 12, tilt: 1 })], g.maps.assets);
    const swing = {};
    for (const [id, k] of [['swA', n0], ['swB', n0 + 1]]) {
      const m = ms.movers[k];
      g.maps.stepMovers(sim, 1 / 60);
      P.teleport(new V(m.pos.x, m.pos.y + 0.05, m.pos.z), 0); step(150);
      const carried = P.riding === m;
      // wait for the bottom, moving +z
      let w = 0; while (!(m.vel.z > 0 && Math.abs(m.pos.z - Z) < 0.25) && w++ < 400) step(1);
      const vSeat = +m.vel.z.toFixed(1);
      I.pressJump(); I.jumpHeld = true; step(1);
      const vz = +P.vel.z.toFixed(1), z0 = P.pos.z, y0 = P.feetY;
      let i = 0; for (; i < 240 && P.feetY > y0 - 3; i++) step(1);
      I.jumpHeld = false;
      let w2 = 0; while (!(m.pos.z - Z > 2.3) && w2++ < 400) step(1);
      g.maps.syncMovers(1);
      const q = m.group.quaternion, up = new V(0, 1, 0).applyQuaternion(q);
      swing[id] = { seatZ: +(m.pos.z - Z).toFixed(1), upZ: +up.z.toFixed(2), carried, vSeat, vzJump: vz, flight: +(P.pos.z - z0).toFixed(1), tiltDeg: +(2 * Math.acos(Math.min(1, Math.abs(q.w))) * 57.3).toFixed(0) };
    }
    out.swing = swing;
    out.puzzle = { afterWrong: a, afterWrong2: b, before3: c, steps20: d1, steps80: d2, events };
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

// Controller "feel" + determinism check, through the real game loop (Game.updatePlaying: fixed 60 Hz steps,
// accumulator, interpolation) at different render frame rates, on a flat test slab high above the maps.
//  - jump arcs per button-hold time: apex + distance must not depend on the frame rate
//  - stop distance after releasing the stick at a full run
//  - air momentum: releasing / half-pushing the stick mid-jump must not kill the jump
//  - coyote time and jump buffer
// Usage: node devtools/feel.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const res = await page.evaluate(() => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    g.renderer.setAnimationLoop(null);
    g.state = 'playing'; g.input.enabled = true;
    const Y = 600;
    const ticks = [];
    const orig = P.fixedUpdate.bind(P);
    P.fixedUpdate = (...a) => { orig(...a); ticks.push({ s: P.state, y: P.feetY, z: P.pos.z, base: P.airBaseY }); };
    g.physics.addBox(new V(0, Y - 0.5, 0), new V(40, 0.5, 40));
    g.physics.step();
    const reset = (x = 0, z = 30) => {
      P.teleport(new V(x, Y + 0.05, z), Math.PI);
      I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges();
      g.cam.yaw = 0; g.acc = 0;
      for (let i = 0; i < 30; i++) { I.update(); g.updatePlaying(1 / 60); }
      g.cam.yaw = 0;
    };
    // script(t) -> { move, jumpDown } ; runs until landed after a jump or tMax
    const run = (fps, script, tMax = 3) => {
      reset();
      const dt = 1 / fps;
      let t = 0, held = false;
      ticks.length = 0;
      while (t < tMax) {
        const s = script(t);
        I.touchMoveY = s.move ?? 0;
        // events carry their own timestamps (as real pointer events do): exact press/release times on a virtual clock
        if (s.jump && !held) I.pressJump(s.downAt * 1000);
        if (!s.jump && held) I.releaseJump(s.upAt * 1000);
        held = !!s.jump; I.touchJumpHeld = held;
        I.update();
        g.updatePlaying(dt);
        g.cam.yaw = 0;
        t += dt;
        const k = ticks.findIndex((x) => x.s === 'air');
        if (k >= 0 && ticks.slice(k).some((x) => x.s !== 'air')) break;
      }
      // exact, per physics tick: take-off = last tick on the ground, landing = first tick back on it
      const k = ticks.findIndex((x) => x.s === 'air');
      if (k < 1) return { apex: null, dist: null };
      const e = ticks.findIndex((x, i) => i > k && x.s !== 'air');
      const take = ticks[k - 1], air = ticks.slice(k, e < 0 ? undefined : e);
      const apex = Math.max(...air.map((x) => x.y)) - take.y;
      return { apex: +apex.toFixed(3), dist: e > 0 ? +(take.z - ticks[e].z).toFixed(3) : null, ticks: e > 0 ? e - k : null };
    };
    const out = { arcs: {}, spread: {} };
    for (const hold of [0.04, 0.08, 0.12, 0.16, 0.2, 0.35]) {
      const row = {};
      for (const fps of [30, 60, 144]) {
        const t0 = 0.7; // run 0.7 s, then press
        row[fps] = run(fps, (t) => ({ move: 1, jump: t >= t0 && t < t0 + hold, downAt: t0, upAt: t0 + hold }));
      }
      out.arcs[hold] = row;
      const ap = Object.values(row).map((r) => r.apex), di = Object.values(row).map((r) => r.dist);
      out.spread[hold] = { apex: +(Math.max(...ap) - Math.min(...ap)).toFixed(3), dist: +(Math.max(...di) - Math.min(...di)).toFixed(3) };
      out.arcs[hold] = Object.entries(row).map(([f, r]) => `${f}fps apex ${r.apex} dist ${r.dist} ticks ${r.ticks}`).join(' | ');
    }
    // stop distance after releasing a full run
    const stop = (fps) => {
      reset();
      const dt = 1 / fps; let t = 0, z0 = null, tStop = null;
      while (t < 2.5) {
        I.touchMoveY = t < 1 ? 1 : 0; I.update(); g.updatePlaying(dt); g.cam.yaw = 0; t += dt;
        if (t >= 1 && z0 === null) z0 = P.pos.z;
        if (z0 !== null && tStop === null && Math.hypot(P.vel.x, P.vel.z) < 0.05) tStop = t - 1;
      }
      return { dist: +(z0 - P.pos.z).toFixed(3), time: tStop && +tStop.toFixed(3) };
    };
    out.stop = { 30: stop(30), 60: stop(60) };
    // air momentum: full jump, stick released / half / held / pulled back right after take-off
    const full = (move2) => run(60, (t) => ({ move: t < 0.75 ? 1 : move2, jump: t >= 0.7 && t < 1.0, downAt: 0.7, upAt: 1.0 }));
    out.momentum = { held: full(1).dist, half: full(0.5).dist, released: full(0).dist, pullBack: full(-1).dist };
    // coyote: run off the slab edge (z = -40) and press jump 0.06 / 0.09 / 0.14 s after leaving it
    const coyote = (late) => {
      reset(0, -34);
      const dt = 1 / 60; let t = 0, left = -1, jumped = false, pressed = false;
      ticks.length = 0;
      while (t < 2) {
        I.touchMoveY = 1;
        if (left < 0) left = ticks.findIndex((x) => x.s === 'air');
        // the press is handled on the next tick: (ticks since leaving, that one included) * dt = lateness
        if (left >= 0 && !pressed && (ticks.length - left + 1) * dt >= late - 1e-6) { I.pressJump(); I.touchJumpHeld = true; pressed = true; }
        I.update(); g.updatePlaying(dt); g.cam.yaw = 0; t += dt;
        if (P.vel.y > 5) jumped = true;
        if (pressed && ticks.length - left > (late + 0.1) * 60) break;
      }
      I.touchJumpHeld = false;
      return jumped;
    };
    out.coyote = { '60ms': coyote(0.06), '100ms': coyote(0.1), '120ms': coyote(0.12) };
    // jump buffer: press while still falling, 80 / 110 / 200 ms before touching down
    const buf = (early) => {
      // dry run: time to land from 3 m
      reset(); P.teleport(new V(0, Y + 3, 30), Math.PI); I.clearEdges();
      let t = 0; const dt = 1 / 60;
      while ((t < 0.1 || P.state !== 'ground') && t < 3) { I.update(); g.updatePlaying(dt); t += dt; }
      const tl = t;
      reset(); P.teleport(new V(0, Y + 3, 30), Math.PI); I.clearEdges();
      t = 0; let pressed = false, jumped = false;
      while (t < tl + 0.4) {
        if (!pressed && t >= tl - early) { I.pressJump(); I.touchJumpHeld = true; pressed = true; }
        I.update(); g.updatePlaying(dt); t += dt;
        if (t > tl - 0.05 && P.vel.y > 5) jumped = true;
      }
      I.touchJumpHeld = false;
      return jumped;
    };
    out.buffer = { '80ms': buf(0.08), '110ms': buf(0.11), '200ms': buf(0.2) };
    return out;
  });
  for (const [h, r] of Object.entries(res.arcs)) console.log(`hold ${h}s: ${r}   spread apex ${res.spread[h].apex} dist ${res.spread[h].dist}`);
  delete res.arcs; delete res.spread;
  console.log(JSON.stringify(res));
  await browser.close();
})();

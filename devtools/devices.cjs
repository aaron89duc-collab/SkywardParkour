// Device test bench: builds every gameplay device on a test floor far from the maps and drives the real player
// controller through each one (run / steer / jump only). Prints one line per device and a summary.
// Usage: node devtools/devices.cjs [name]
const { chromium } = require('playwright');
(async () => {
  const only = process.argv[2] || null;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const res = await page.evaluate(async (only) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true;
    const Y0 = 3000, X0 = 2000; // test floor, far away from every map
    const at = (i) => X0 + i * 40;
    g.physics.addBox(new V(X0 + 400, Y0 - 1, 0), new V(460, 1, 40));
    const L = [
      { t: 'crumble', id: 'cr', p: [at(0), Y0 + 2, 0], s: [3, 0.5, 3], delay: 0.8, respawn: 3 },
      { t: 'blink', id: 'bl', p: [at(1), Y0 + 2, 0], s: [3, 0.5, 3], on: 2, off: 1.5 },
      { t: 'conveyor', id: 'cv', p: [at(2), Y0 + 0.3, 0], s: [3, 0.3, 12], speed: 3 },
      { t: 'turntable', id: 'tt', p: [at(3), Y0 + 0.5, 0], radius: 4, s: [8, 0.5, 8], speed: 40 },
      { t: 'tilt', id: 'ti', p: [at(4), Y0 + 2, 0], s: [3, 0.4, 8], maxAngle: 14 },
      { t: 'piston', id: 'pi', p: [at(5), Y0 + 1.6, -3], s: [2, 1.6, 2], stroke: 5, period: 4, wait: 0.8 },
      { t: 'sweeper', id: 'sw', p: [at(6), Y0, 0], radius: 5, speed: 120, arms: 1 },
      { t: 'fan', id: 'fa', p: [at(7), Y0, 0], s: [3, 9, 3], force: 52 },
      { t: 'slippery', id: 'ic', p: [at(8), Y0 + 0.2, 0], s: [4, 0.2, 30], grip: 0.12 },
      { t: 'trampoline', id: 'tr', p: [at(9), Y0 + 0.6, 0], s: [3, 0.3, 3], bounce: 0.9, min: 11, max: 24 },
      { t: 'zipline', id: 'zi', p: [at(10), Y0 + 4.0, 0], b: [at(10), Y0 + 1.0, 24], speed: 12 },
      { t: 'plate', id: 'pl', p: [at(11), Y0 + 0.15, 0], s: [1.6, 0.15, 1.6], target: 'pi2', hold: 3 },
      { t: 'piston', id: 'pi2', p: [at(11) + 4, Y0 + 3, 2], s: [2, 0.5, 2], stroke: 4, period: 4 },
      { t: 'elevator', id: 'el', p: [at(12), Y0 + 0.4, 0], b: [at(12), Y0 + 8.4, 0], s: [3, 0.4, 3], speed: 3, wait: 2 },
      { t: 'cannon', id: 'ca', p: [at(13), Y0, 0], r: 0, pitch: 50, v: 20 },
      { t: 'drop', id: 'dr', p: [at(14), Y0 + 9, 0], s: [1.6, 1.2, 1.6], fall: 9, speed: 7, interval: 2 },
      { t: 'portal', id: 'po', p: [at(15), Y0, 0], r: 0, b: [at(15) + 12, Y0 + 5, 0], rb: 90 },
      { t: 'lowgrav', id: 'lg', p: [at(16), Y0, 0], s: [8, 14, 8], g: 0.45 },
      { t: 'oneway', id: 'ow', p: [at(17), Y0 + 2.2, 0], s: [4, 0.3, 4] },
      { t: 'checkpoint', id: 'cp', p: [at(18), Y0, 0], r: 0 },
      { t: 'collectible', id: 'gem', p: [at(19), Y0, 0] },
    ];
    await g.maps.addDevices(L);
    let sim = 1000;
    const dt = 1 / 60;
    const ev = [];
    const step = (cy = 0) => { I.update(); sim += dt; g.maps.stepMovers(sim, dt); P.fixedUpdate(dt, I, cy); g.physics.step(); P.syncVisual(1, dt); for (const e of P.drainEvents()) ev.push(e.type); };
    const go = (x, y, z, yaw = 0) => { I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges(); P.teleport(new V(x, y, z), yaw); P.regrab = 0; ev.length = 0; };
    const run = (sec, f) => { for (let i = 0; i < Math.round(sec / dt); i++) { const cy = f ? f(i * dt) : 0; step(cy ?? 0); } };
    const feet = () => P.pos.y - 0.9;
    const out = {};
    const T = (name, fn) => { if (only && name !== only) return; try { out[name] = fn(); } catch (e) { out[name] = { ok: false, err: String(e) }; } };
    // camera yaw 0 looks toward -z: stick forward (moveY 1) = -z, back = +z, moveX 1 = +x
    T('crumble', () => { go(at(0), Y0 + 2.1, 0); run(0.5); const a = feet(); run(1.4); const b = feet(); return { ok: a > Y0 + 1.8 && b < Y0 + 0.5, stood: +a.toFixed(2), after: +b.toFixed(2) }; });
    T('blink', () => {
      go(at(1), Y0 + 2.1, 0); const ys = []; for (let i = 0; i < 8; i++) { run(0.5); ys.push(+feet().toFixed(2)); }
      return { ok: ys.some((y) => y > Y0 + 1.8) && ys.some((y) => y < Y0 + 0.5), ys };
    });
    T('conveyor', () => { go(at(2), Y0 + 0.4, -4); run(0.3); const z0 = P.pos.z; run(1.5); const dz = P.pos.z - z0; return { ok: dz > 3, moved: +dz.toFixed(2) }; });
    T('turntable', () => { go(at(3) + 3, Y0 + 0.6, 0); run(0.3); const a0 = Math.atan2(P.pos.x - at(3), P.pos.z); run(1.5); const a1 = Math.atan2(P.pos.x - at(3), P.pos.z); const r = Math.hypot(P.pos.x - at(3), P.pos.z); return { ok: Math.abs(a1 - a0) > 0.6 && r > 2.5 && feet() > Y0 + 0.3, turned: +(a1 - a0).toFixed(2), r: +r.toFixed(2) }; });
    T('tilt', () => { go(at(4), Y0 + 2.1, 3.2); run(1.6); const sys = g.maps.extraDevices?.[0] ?? null; void sys; return { ok: ev.includes('land') || feet() < Y0 + 2.2, feet: +feet().toFixed(2), state: P.state }; });
    T('piston', () => {
      // stand in the piston's path (it moves along +z from z=-3 by 5 m)
      // pistons come out of a wall: step in front of it while it is retracted, then it shoves you along its stroke
      const dev = g.maps.extraDevices[0].list.find((d) => d.data.id === 'pi');
      for (let i = 0; i < 400 && !(dev.pos.z < -2.95 && dev.delta.z >= 0); i++) run(1 / 60);
      go(at(5), Y0 + 0.1, 0.2); let pushed = 0; const z0 = P.pos.z;
      run(4, () => { pushed = Math.max(pushed, P.pos.z - z0); return 0; });
      return { ok: pushed > 0.8, pushed: +pushed.toFixed(2) };
    });
    T('sweeper', () => { go(at(6) + 3, Y0 + 0.1, 0); run(4); const hit = ev.includes('knock'); return { ok: hit, events: [...new Set(ev)] }; });
    T('fan', () => { go(at(7), Y0 + 0.1, 0); let top = 0; run(3, () => { top = Math.max(top, feet() - Y0); return 0; }); return { ok: top > 3, rose: +top.toFixed(2) }; });
    T('slippery', () => {
      const slide = (x) => { go(x, Y0 + 0.4, 12); run(1.2, () => { I.touchMoveY = 1; return 0; }); const z0 = P.pos.z; I.touchMoveY = 0; run(1.5); return z0 - P.pos.z; };
      const ice = slide(at(8)), floor = slide(at(8) + 10);
      return { ok: ice > floor + 2, ice: +ice.toFixed(2), floor: +floor.toFixed(2) };
    });
    T('trampoline', () => { go(at(9), Y0 + 5, 0); let top = 0, after = false; run(3, () => { if (ev.includes('bounce')) { after = true; top = Math.max(top, feet()); } return 0; }); return { ok: ev.includes('bounce') && top > Y0 + 3.5, apex: +(top - Y0).toFixed(2) }; });
    T('zipline', () => {
      // jump straight up under the cable start: hands reach it -> ride to the end
      go(at(10), Y0 + 0.1, 1.5); run(0.3); I.pressJump(); I.touchJumpHeld = true; let zipped = false, maxZ = 0;
      run(5, () => { if (P.state === 'zip') zipped = true; maxZ = Math.max(maxZ, P.pos.z); return 0; });
      I.touchJumpHeld = false;
      return { ok: zipped && maxZ > 18, zipped, reached: +maxZ.toFixed(1) };
    });
    T('plate', () => {
      const dev = g.maps.extraDevices[0].list.find((d) => d.data.id === 'pi2'); const z0 = dev.pos.z;
      go(at(11), Y0 + 0.3, 0); run(1.5); const z1 = dev.pos.z;
      return { ok: z1 - z0 > 2, extended: +(z1 - z0).toFixed(2) };
    });
    T('elevator', () => { go(at(12), Y0 + 0.5, 0); let top = 0; run(7, () => { top = Math.max(top, feet()); return 0; }); return { ok: top > Y0 + 7.5, rose: +(top - Y0).toFixed(2) }; });
    T('cannon', () => { go(at(13), Y0 + 0.1, -3); let top = 0; run(3, () => { I.touchMoveY = P.state === 'ground' && !ev.includes('launch') ? -1 : 0; top = Math.max(top, feet() - Y0); return 0; }); return { ok: ev.includes('launch') && top > 3, apex: +top.toFixed(2) }; });
    T('drop', () => { go(at(14), Y0 + 0.1, 0); run(6); return { ok: ev.includes('knock'), events: [...new Set(ev)] }; });
    T('portal', () => { go(at(15), Y0 + 0.1, 3); run(2, () => { I.touchMoveY = 1; return 0; }); I.touchMoveY = 0; return { ok: ev.includes('portal') && P.pos.x > at(15) + 9, x: +(P.pos.x - at(15)).toFixed(1) }; });
    T('lowgrav', () => {
      const apex = (x) => { go(x, Y0 + 0.1, 0); run(0.3); const y0 = feet(); I.pressJump(); I.touchJumpHeld = true; let top = y0; run(2.5, () => { top = Math.max(top, feet()); return 0; }); I.touchJumpHeld = false; return top - y0; };
      const lg = apex(at(16)), normal = apex(at(16) + 15);
      return { ok: lg > normal * 1.7, lowgrav: +lg.toFixed(2), normal: +normal.toFixed(2) };
    });
    T('oneway', () => { go(at(17), Y0 + 0.1, 0); run(0.3); I.pressJump(); I.touchJumpHeld = true; run(1.5); I.touchJumpHeld = false; run(0.5); return { ok: feet() > Y0 + 2.0, feet: +(feet() - Y0).toFixed(2) }; });
    T('checkpoint', () => { go(at(18), Y0 + 0.1, 2); run(1.5, () => { I.touchMoveY = 1; return 0; }); I.touchMoveY = 0; return { ok: ev.includes('checkpoint'), events: [...new Set(ev)] }; });
    T('collectible', () => { go(at(19), Y0 + 0.1, 2); run(1.5, () => { I.touchMoveY = 1; return 0; }); I.touchMoveY = 0; return { ok: ev.includes('collect'), events: [...new Set(ev)] }; });
    return out;
  }, only);
  let pass = 0, n = 0;
  for (const [k, v] of Object.entries(res)) { n++; if (v.ok) pass++; console.log(`${v.ok ? 'ok  ' : 'FAIL'} ${k.padEnd(12)} ${JSON.stringify(v)}`); }
  console.log(`devices: ${pass}/${n} ok`);
  await b.close();
})();

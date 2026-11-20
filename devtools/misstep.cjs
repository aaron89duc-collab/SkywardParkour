// How forgiving is a misstep? Start at the route waypoints of every map, walk or run in a random direction
// (no jump) until the player goes over an edge, then react in one of three ways:
//   hold    – did not notice: keeps pushing on for 0.4 s, then lets go
//   release – noticed late: lets go of the stick as soon as the feet leave the edge
//   reflex  – reacts: pulls the stick back toward the edge [reaction] s after leaving it (default 0.18), for 0.35 s
// Outcome after 2.5 s: hang (caught a ledge) / saved (back on the same level) / fell (ended > 1.2 m lower).
// Usage: node devtools/misstep.cjs [trialsPerWaypoint] [seed] [reaction]      (dev server on :5173, packs auto-installed)
const { chromium } = require('playwright');
(async () => {
  const per = parseInt(process.argv[2] || '6');
  const seed = parseInt(process.argv[3] || '7');
  const react = parseFloat(process.argv[4] || '0.18');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(() => { try { const k = 'skyward-parkour.save.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.profile) { s.profile = { name: 'Tester', id: 'test-tools-0001', token: 'e'.repeat(64) }; localStorage.setItem(k, JSON.stringify(s)); } } catch {} });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps(); g.state = 'playing'; g.input.enabled = true; });
  const res = await page.evaluate(({ per, seed, react }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const starts = [];
    for (const m of g.maps.loaded.values()) for (const w of m.data.waypoints ?? []) starts.push(w.p);
    const out = { hold: {}, release: {}, reflex: {} };
    const add = (mode, kind, speed) => { const k = `${speed}:${kind}`; out[mode][k] = (out[mode][k] ?? 0) + 1; };
    let sim = 0;
    for (const p of starts) for (let n = 0; n < per; n++) {
      const yaw = rnd() * Math.PI * 2;
      const speed = rnd() < 0.5 ? 'walk' : 'run';
      // a start near the waypoint, on the same surface level
      let q = p;
      for (let k = 0; k < 6; k++) {
        const a = rnd() * Math.PI * 2, r = rnd() * 6;
        const h = g.physics.raycast(new V(p[0] + Math.cos(a) * r, p[1] + 2.5, p[2] + Math.sin(a) * r), new V(0, -1, 0), 5);
        if (h && h.normal.y > 0.8 && Math.abs(h.point.y - p[1]) < 2) { q = [h.point.x, h.point.y, h.point.z]; break; }
      }
      const stick = speed === 'walk' ? 0.45 : 1;
      for (const mode of ['hold', 'release', 'reflex']) {
        I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges();
        P.teleport(new V(q[0], q[1] + 0.05, q[2]), yaw);
        P.regrab = 0;
        let off = -1, takeoffY = 0, t = 0, depth = 0;
        // camera yaw: forward on the stick = this direction
        const cam = yaw + Math.PI;
        for (let i = 0; i < 60 * 6; i++, t += 1 / 60) {
          if (off < 0) I.touchMoveY = stick;
          else {
            const dt = t - off;
            if (mode === 'hold') I.touchMoveY = dt < 0.4 ? stick : 0;
            else if (mode === 'release') I.touchMoveY = 0;
            else I.touchMoveY = dt < react ? stick : dt < react + 0.35 ? -1 : 0; // pull back briefly, then let go
          }
          I.update();
          sim += 1 / 60;
          g.maps.stepMovers(sim, 1 / 60);
          P.fixedUpdate(1 / 60, I, cam);
          g.physics.step();
          const edge = () => {
            // how deep is it past this edge? (only real drops count as a misstep)
            const d = new V(Math.sin(yaw), 0, Math.cos(yaw));
            const h = g.physics.raycast(new V(P.pos.x + d.x * 0.9, takeoffY + 0.3, P.pos.z + d.z * 0.9), new V(0, -1, 0), 60);
            depth = h ? takeoffY - h.point.y : 60;
          };
          if (off < 0 && P.state === 'air' && P.vel.y <= 0.01) { off = t; takeoffY = P.feetY; edge(); }
          if (off < 0 && (P.state === 'hang' || P.state === 'move') && t > 0.1) { off = t; takeoffY = (P.ledge?.y ?? P.feetY + 1.9); edge(); }
          if (off >= 0 && t - off > 2.5) break;
          if (off < 0 && t > 3.5) break;
        }
        if (off < 0 || depth < 2.5) continue; // walked into a wall, or only a step down: no misstep
        let kind;
        if (P.state === 'hang' || P.state === 'move') kind = 'hang';
        else if (P.feetY > takeoffY - 1.2) kind = 'saved';
        else kind = 'fell';
        add(mode, kind, speed);
      }
    }
    I.touchMoveY = 0;
    return { starts: starts.length, out };
  }, { per, seed, react });
  // percentages per mode and speed
  const table = {};
  for (const [mode, m] of Object.entries(res.out)) {
    for (const sp of ['walk', 'run']) {
      const h = m[`${sp}:hang`] ?? 0, sv = m[`${sp}:saved`] ?? 0, f = m[`${sp}:fell`] ?? 0, n = h + sv + f;
      if (n) table[`${mode} ${sp}`] = { n, caught: `${Math.round(((h + sv) / n) * 100)}%`, hang: h, saved: sv, fell: f };
    }
  }
  console.log(JSON.stringify({ starts: res.starts, table }, null, 1));
  await browser.close();
})();

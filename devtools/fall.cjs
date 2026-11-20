// Fall test: drop the player from random points of Rooftop City (and walk off random city edges)
// and check where they come to rest. Expectation: they land on something in the city or fall
// into Starter Village below and stay there (standing or hanging), never stuck in geometry,
// never outside the world, and the run's max height is kept.
// Usage: node devtools/fall.cjs [count] [seed]
const { chromium } = require('playwright');
(async () => {
  const N = parseInt(process.argv[2] || '60');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps(); });
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; g.score.resetRun(); });
  const res = await page.evaluate(({ N, SEED }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    const dt = 1 / 60;
    let sim = 0, seed = SEED;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const m2 = g.maps.map('map002');
    const [cx, cz] = m2.region.c, R = m2.region.r;
    const out = { ground: 0, hang: 0, other: 0, inCity: 0, inVillage: 0, unstuck: 0, maxFall: 0, maxKept: true, bad: [] };
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.95;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      // start 1.5 m above the highest surface there (or at 330 m in open air)
      const hit = g.physics.raycast(new V(x, 400, z), new V(0, -1, 0), 500);
      const y0 = hit && hit.point.y > 141 ? hit.point.y + 1.5 : 300 + rnd() * 30;
      P.teleport(new V(x, y0, z), rnd() * 6.28);
      g.score.runMax = Math.max(g.score.runMax, y0);
      const kept = g.score.runMax;
      I.touchMoveX = 0; I.touchMoveY = 0; I.touchJumpHeld = false; I.clearEdges();
      // run off in a random direction for 1.2 s, then let go
      const dir = rnd() * 6.28;
      let t = 0, still = 0, unst = 0;
      while (t < 25) {
        I.touchMoveY = t < 1.2 ? 1 : 0;
        I.update(); sim += dt; g.maps.stepMovers(sim, dt);
        P.fixedUpdate(dt, I, dir); g.physics.step();
        for (const e of P.drainEvents()) if (e.type === 'unstuck') unst++;
        g.score.update(dt, P.feetY);
        out.maxFall = Math.max(out.maxFall, -P.vel.y);
        t += dt;
        if (t > 1.3 && (P.state === 'ground' || P.state === 'hang') && Math.hypot(P.vel.x, P.vel.y, P.vel.z) < 0.5) { if ((still += dt) > 0.6) break; } else still = 0;
      }
      const fy = P.feetY;
      if (P.state === 'ground') out.ground++; else if (P.state === 'hang') out.hang++; else { out.other++; out.bad.push({ i, from: [x, y0, z].map((v) => +v.toFixed(1)), state: P.state, at: [P.pos.x, fy, P.pos.z].map((v) => +v.toFixed(1)) }); }
      if (fy > 139) out.inCity++; else out.inVillage++;
      if (unst) out.unstuck += unst;
      if (g.score.runMax < kept - 0.01) out.maxKept = false;
      if (Math.hypot(P.pos.x, P.pos.z) > 86 || fy < -20) out.bad.push({ i, outside: [P.pos.x, fy, P.pos.z].map((v) => +v.toFixed(1)) });
      const here = g.maps.mapAt(P.pos.x, fy, P.pos.z, g.maps.map(fy > 141.5 ? 'map002' : 'map001'));
      if (fy < 135 && here && here.id !== 'map001') out.bad.push({ i, hud: here.id, y: fy });
    }
    out.runMax = +g.score.runMax.toFixed(1);
    return out;
  }, { N, SEED: parseInt(process.argv[3] || '7') });
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})();

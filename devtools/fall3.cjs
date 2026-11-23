// Map 003 fall containment: drop the player from random points of every zone; each fall must end on that zone's
// own start deck or higher (never down into an earlier zone / map), never stuck, never outside the footprint.
// Usage: node devtools/fall3.cjs [perZone] [seed]
const { chromium } = require('playwright');
(async () => {
  const N = parseInt(process.argv[2] || '25'), seed0 = parseInt(process.argv[3] || '7');
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map003'); g.state = 'playing'; g.input.enabled = true; });
  const r = await page.evaluate(({ N, seed0 }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    let seed = seed0; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // zone bands: [y0 (start deck), y1, x0, x1] (zone 1 stands on the port deck)
    const Z = [[318.74, 345, -60, -43], [345, 370, -77, -60], [370, 400, -60, -43], [400, 430, -77, -60], [430, 460, -60, -43], [460, 495, -77, -60], [495, 520, -60, -43]];
    let sim = 0; const dt = 1 / 60;
    const out = { zones: [], bad: [] };
    Z.forEach(([y0, y1, x0, x1], zi) => {
      const ends = [];
      for (let i = 0; i < N; i++) {
        const x = x0 + 0.8 + rnd() * (x1 - x0 - 1.6), z = -23.2 + rnd() * 26.4, y = y0 + 3 + rnd() * (y1 - y0 - 1);
        P.teleport(new V(x, y + 0.9, z), rnd() * 6.28);
        I.touchMoveX = 0; I.touchMoveY = rnd() < 0.5 ? 0 : 1; I.clearEdges();
        let still = 0, t = 0;
        while (t < 9) {
          sim += dt; g.maps.stepMovers(sim, dt); I.update(); P.fixedUpdate(dt, I, rnd() * 0); g.physics.step(); P.drainEvents();
          t += dt;
          if (t > 0.6) I.touchMoveY = 0;
          if ((P.state === 'ground' || P.state === 'hang') && Math.abs(P.vel.y) < 0.5) { if (++still > 30) break; } else still = 0;
        }
        const fy = P.pos.y - 0.8;
        ends.push(+fy.toFixed(1));
        const outside = P.pos.x < -77.6 || P.pos.x > -42.4 || P.pos.z < -24.6 || P.pos.z > 4.6;
        if (fy < y0 - 0.8 || outside || (P.state !== 'ground' && P.state !== 'hang' && P.state !== 'ladder'))
          out.bad.push({ zone: zi + 1, from: [x, y, z].map((v) => +v.toFixed(1)), end: [P.pos.x, fy, P.pos.z].map((v) => +v.toFixed(1)), state: P.state });
      }
      out.zones.push({ zone: zi + 1, deck: y0, lowest: Math.min(...ends), onDeck: ends.filter((e) => Math.abs(e - y0) < 0.3).length, n: ends.length });
    });
    return out;
  }, { N, seed0 });
  console.log(JSON.stringify(r.zones));
  console.log(`bad: ${r.bad.length}`); for (const x of r.bad.slice(0, 15)) console.log('  ', JSON.stringify(x));
  await b.close();
})();

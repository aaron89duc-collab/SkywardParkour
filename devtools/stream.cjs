// Map streaming check: unload a map (scene, colliders, effects, gate), load it again, nothing left behind / missing.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadOtherMaps();
    const snap = () => ({ loaded: [...g.maps.loaded.keys()], colliders: g.physics.colliderCount, fx: g.fx.group.children.length, gates: g.maps.gates.group.children.length, milestones: g.fx.milestones.length });
    const before = snap();
    const id = g.maps.registry[g.maps.registry.length - 1].id;
    g.maps.unload(id);
    g.syncGates();
    const unloaded = snap();
    await g.loadOtherMaps();
    const reloaded = snap();
    // a ray down onto the reloaded map hits its geometry again
    const m = g.maps.map(id);
    const V = g.player.pos.constructor;
    const hit = g.physics.raycast(new V(m.spawn.p[0], m.spawn.p[1] + 2, m.spawn.p[2]), new V(0, -1, 0), 5);
    return { id, before, unloaded, reloaded, spawnFloor: hit ? +hit.point.y.toFixed(2) : null, spawnY: m.spawn.p[1] };
  });
  console.log(JSON.stringify(r, null, 1));
  const ok = r.unloaded.colliders < r.before.colliders && r.reloaded.colliders === r.before.colliders && r.reloaded.fx === r.before.fx && r.spawnFloor !== null && !r.unloaded.loaded.includes(r.id);
  console.log(ok ? 'STREAM OK' : 'STREAM FAIL');
  await b.close();
})();

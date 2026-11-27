// Why does three.js re-check shader programs every frame? Finds materials shared by meshes whose program-relevant
// flags differ (receiveShadow, instancing, skinning, vertex alphas ...) and counts getProgram calls per frame.
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map001';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async (MAP) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP);
    g.applyQuality('medium');
    g.renderer.setAnimationLoop(null);
    g.ui.hideMenu(); g.state = 'playing';
    const s = g.maps.loaded.get(MAP)?.data?.spawn?.p; if (s) g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
    g.clock.getDelta = () => 1 / 60;
    for (let i = 0; i < 30; i++) g.frame();
    // which materials change version every frame?
    const mats = new Map();
    g.scene.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) { if (!mats.has(m)) mats.set(m, { v: m.version, objs: [] }); mats.get(m).objs.push(o); } });
    for (const [m, e] of mats) e.v = m.version;
    for (let i = 0; i < 10; i++) g.frame();
    const bumped = [];
    for (const [m, e] of mats) if (m.version !== e.v) bumped.push(`${m.type} "${m.name}" +${m.version - e.v} on ${e.objs.length} objs e.g. ${e.objs[0].name || e.objs[0].type} parent ${e.objs[0].parent?.name}`);
    // shared materials with conflicting program flags
    const conflicts = [];
    for (const [m, e] of mats) {
      const sig = new Set(e.objs.map((o) => [o.receiveShadow, !!o.isInstancedMesh, !!o.isBatchedMesh, !!o.isSkinnedMesh, !!(m.vertexColors && o.geometry?.attributes?.color?.itemSize === 4), !!o.geometry?.morphAttributes?.position, !!o.isPoints, !!o.isLine].join()));
      if (sig.size > 1) conflicts.push(`${m.type} "${m.name}" objs ${e.objs.length} sigs ${[...sig].join(' | ')}`);
    }
    // count program lookups per frame: hook the program cache through renderer.info.programs? use a proxy on material.onBeforeCompile
    let calls = 0;
    const seen = new Map();
    for (const [m] of mats) { const prev = m.customProgramCacheKey; m.customProgramCacheKey = function () { calls++; seen.set(m, (seen.get(m) || 0) + 1); return prev.call(this); }; }
    for (let i = 0; i < 10; i++) g.frame();
    const top = [...seen].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([m, n]) => `${(n / 10).toFixed(1)}/frame ${m.type} "${m.name}" objs ${mats.get(m).objs.length} e.g. ${mats.get(m).objs[0].name} < ${mats.get(m).objs[0].parent?.name}`);
    return { materials: mats.size, programLookupsPerFrame: calls / 10, top, bumped: bumped.slice(0, 15), conflicts: conflicts.slice(0, 20), nConflicts: conflicts.length };
  }, MAP);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

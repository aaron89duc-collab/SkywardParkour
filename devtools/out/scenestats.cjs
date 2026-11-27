// Scene size and the cost of the per-frame matrix update / render-list build, per map
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map001';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async (MAP) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP); g.applyQuality('medium'); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
    const s = g.maps.loaded.get(MAP).data.spawn.p; g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
    g.clock.getDelta = () => 1 / 60;
    for (let i = 0; i < 30; i++) g.frame();
    let objs = 0, meshes = 0, visMeshes = 0, auto = 0, lights = 0, shadowCasters = 0, transparentDouble = 0, sprites = 0, points = 0;
    g.scene.traverse((o) => { objs++; if (o.matrixAutoUpdate) auto++; if (o.isLight) lights++; if (o.isSprite) sprites++; if (o.isPoints) points++;
      if (o.isMesh) { meshes++; let v = true; o.traverseAncestors((a) => { if (!a.visible) v = false; }); if (v && o.visible) { visMeshes++; if (o.castShadow) shadowCasters++; } for (const m of [].concat(o.material)) if (m.transparent && m.side === 2 && !m.forceSinglePass) transparentDouble++; } });
    const t0 = performance.now(); for (let i = 0; i < 50; i++) g.scene.updateMatrixWorld(); const umw = (performance.now() - t0) / 50;
    const perMap = {}; for (const [id, e] of g.maps.loaded) { let n = 0; const root = e.root ?? e.group ?? e.data?.root; if (root) root.traverse(() => n++); perMap[id] = n; }
    g.renderer.info.autoReset = false; g.renderer.info.reset(); g.frame(); const i = g.renderer.info;
    const out = { maps: [...g.maps.loaded.keys()], perMapObjs: perMap, objs, meshes, visMeshes, auto, lights, shadowCasters, transparentDouble, sprites, points, updateMatrixWorldMs: +umw.toFixed(2), calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, textures: i.memory.textures, geoms: i.memory.geometries };
    const e = g.maps.loaded.get(MAP); out.loadedKeys = Object.keys(e);
    return out;
  }, MAP);
  console.log(JSON.stringify(r));
  await browser.close();
})();

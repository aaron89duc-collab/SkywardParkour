// Where do the triangles / draw calls go? Toggles parts of the scene and compares renderer.info (medium quality)
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map004';
const NOCULL = process.argv[3] === 'nocull';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async ([MAP, NOCULL]) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP); g.applyQuality('medium'); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
    const s = g.maps.loaded.get(MAP).data.spawn.p; g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
    g.clock.getDelta = () => 1 / 60;
    for (let i = 0; i < 20; i++) g.frame();
    await new Promise((r) => setTimeout(r, 5000)); // far copies are made in a worker
    g.maps.setDetail(NOCULL ? { lodDistance: 26, lod2Distance: 1e9, cullK: 1e9, cullMin: 1e9 } : g.maps.detail);
    for (let i = 0; i < 5; i++) g.frame();
    const R = g.renderer; R.info.autoReset = false;
    const measure = () => { R.info.reset(); R.render(g.scene, g.cam.camera); return [R.info.render.calls, Math.round(R.info.render.triangles / 1000)]; };
    const out = { all: measure() };
    R.shadowMap.enabled = false; R.shadowMap.needsUpdate = true; out.noShadow = measure(); R.shadowMap.enabled = true;
    // per map / per part with shadows off
    R.shadowMap.enabled = false;
    for (const [id, e] of g.maps.loaded) {
      for (const k of ['group', 'prefabs', 'sprites', 'movers', 'boosters', 'devices']) {
        const o = e[k]?.group ?? e[k]?.root ?? (e[k]?.isObject3D ? e[k] : null);
        if (!o) continue;
        const v = o.visible; o.visible = false; const m = measure(); o.visible = v;
        out[`${id}.${k}`] = [out.noShadow[0] - m[0], out.noShadow[1] - m[1]];
      }
      // top prefab batches by triangles (lod0+lod1 counts)
      const top = [];
      for (const b of e.prefabs.batches) {
        const t0 = (b.lod0.geometry.index ? b.lod0.geometry.index.count : b.lod0.geometry.attributes.position.count) / 3;
        const t1 = b.lod1 ? (b.lod1.geometry.index ? b.lod1.geometry.index.count : b.lod1.geometry.attributes.position.count) / 3 : 0;
        top.push([b.id, Math.round(t0), Math.round(t1), b.lod0.count, b.lod1?.count ?? 0, Math.round((t0 * b.lod0.count + t1 * (b.lod1?.count ?? 0)) / 1000)]);
      }
      out[`${id}.topPrefabs[id,tri0,tri1,n0,n1,ktris]`] = top.sort((a, b) => b[5] - a[5]).slice(0, 6);
    }
    for (const [name, o] of [['clouds', g.clouds.group ?? g.clouds.mesh], ['fx', g.fx.group], ['player', g.player.model?.root], ['env', g.env.group]]) {
      if (!o) continue; const v = o.visible; o.visible = false; const m = measure(); o.visible = v; out[name] = [out.noShadow[0] - m[0], out.noShadow[1] - m[1]];
    }
    R.shadowMap.enabled = true;
    return out;
  }, [MAP, NOCULL]);
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(28), JSON.stringify(v));
  await browser.close();
})();

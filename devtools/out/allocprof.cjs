// Allocation profile while playing: which functions allocate the most per frame (garbage -> GC hitches).
// usage: node devtools/out/allocprof.cjs [map001] [frames] [quality]
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map001', N = Number(process.argv[3] || 300), Q = process.argv[4] || 'medium';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  await page.evaluate(async ({ MAP, Q }) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP);
    g.applyQuality(Q);
    g.renderer.setAnimationLoop(null);
    g.ui.hideMenu(); g.state = 'playing'; g.input.enabled = true;
    const md = g.maps.loaded.get(MAP)?.data, s = md?.spawn?.p;
    if (s) g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
    g.clock.getDelta = () => 1 / 60;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    for (let i = 0; i < 60; i++) g.frame(); // warm up (shaders, first-time caches)
  }, { MAP, Q });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const t = await page.evaluate((N) => {
    const g = window.__game; const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      if (i % 50 === 0) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      if (i % 50 === 5) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
      g.frame();
    }
    return performance.now() - t0;
  }, N);
  const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
  await cdp.send('HeapProfiler.stopSampling');
  const self = new Map(), total = new Map();
  let all = 0;
  const walk = (node, stack) => {
    const cf = node.callFrame;
    const name = `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/.*\/(src|node_modules)\//, '$1/').replace(/\?.*/, '')}:${cf.lineNumber + 1}`;
    if (node.selfSize) {
      all += node.selfSize;
      self.set(name, (self.get(name) || 0) + node.selfSize);
      const seen = new Set();
      for (const s of [...stack, name]) if (/src\//.test(s) && !seen.has(s)) { seen.add(s); total.set(s, (total.get(s) || 0) + node.selfSize); }
    }
    for (const c of node.children || []) walk(c, [...stack, name]);
  };
  walk(profile.head, []);
  const kb = (b) => (b / N / 1024).toFixed(1) + ' KB/frame';
  console.log(`${MAP} ${Q}: ${N} frames in ${(t / 1000).toFixed(1)} s, sampled allocations ${kb(all)}`);
  console.log('--- self (allocating function)');
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(kb(v).padStart(16), k);
  console.log('--- inclusive (our code)');
  for (const [k, v] of [...total].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(kb(v).padStart(16), k);
  await browser.close();
})();

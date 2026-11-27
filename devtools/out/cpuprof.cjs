// CPU profile of the game loop while playing (fixed 1/60 s frames, one physics step each): hottest functions.
// usage: node devtools/out/cpuprof.cjs <map> [frames] [norender]
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map007', N = Number(process.argv[3] || 240), NORENDER = process.argv[4] === 'norender';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  await page.evaluate(async ([MAP, NORENDER]) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP); g.applyQuality('medium'); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
    const s = g.maps.loaded.get(MAP).data.spawn.p; g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
    g.clock.getDelta = () => 1 / 60;
    if (NORENDER) g.renderer.render = () => {};
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    for (let i = 0; i < 60; i++) g.frame();
    await new Promise((r) => setTimeout(r, 3000));
  }, [MAP, NORENDER]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const ms = await page.evaluate((N) => {
    const g = window.__game, t0 = performance.now(), parts = { step: 0, frame: 0 };
    const sm = g.maps.stepMovers.bind(g.maps); g.maps.stepMovers = (...a) => { const t = performance.now(); sm(...a); parts.step += performance.now() - t; };
    const ps = g.physics.step.bind(g.physics); let phys = 0; g.physics.step = () => { const t = performance.now(); ps(); phys += performance.now() - t; };
    const pf = g.player.fixedUpdate.bind(g.player); let pl = 0; g.player.fixedUpdate = (...a) => { const t = performance.now(); pf(...a); pl += performance.now() - t; };
    const mu = g.maps.update.bind(g.maps); let mup = 0; g.maps.update = (...a) => { const t = performance.now(); mu(...a); mup += performance.now() - t; };
    for (let i = 0; i < N; i++) {
      if (i % 50 === 0) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      if (i % 50 === 5) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
      g.frame();
    }
    const tot = performance.now() - t0;
    return { perFrame: +(tot / N).toFixed(2), stepMovers: +(parts.step / N).toFixed(2), physics: +(phys / N).toFixed(2), player: +(pl / N).toFixed(2), mapsUpdate: +(mup / N).toFixed(2) };
  }, N);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const counts = new Map();
  for (const s of profile.samples) counts.set(s, (counts.get(s) || 0) + 1);
  let total = 0;
  for (const [id, c] of counts) {
    const n = byId.get(id); const cf = n.callFrame;
    const k = `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/.*\/(src|node_modules)\//, '$1/').replace(/\?.*/, '')}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + c); total += c;
  }
  console.log(MAP, NORENDER ? '(no render)' : '', JSON.stringify(ms));
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(((v / total) * 100).toFixed(1).padStart(5) + '%', k);
  await browser.close();
})();

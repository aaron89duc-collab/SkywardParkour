// Free fall off the Map 004 tower (no outer walls): where does the player land, and are the maps below in the
// world in time? Real-time paced (16 ms per simulated frame) so map streaming runs as in the game.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const cases = JSON.parse(process.argv[2] || '[[-60,650,-27],[-60,650,-45]]');
  for (const c of cases) {
    const r = await page.evaluate(async (c) => {
      const g = window.__game, V = g.player.pos.constructor;
      g.renderer.setAnimationLoop(null);
      await g.loadOtherMaps('map004');
      g.map = g.maps.map('map004');
      g.state = 'playing'; g.input.enabled = true;
      g.player.teleport(new V(c[0], c[1] + 0.9, c[2]), 0);
      const log = [];
      const t0 = performance.now();
      let lastMaps = '';
      for (let i = 0; i < 60 * 30; i++) {
        g.updatePlaying(1 / 60);
        const maps = [...g.maps.loaded.keys()].join(',');
        if (maps !== lastMaps) { log.push(`${((performance.now() - t0) / 1000).toFixed(1)}s y=${g.player.feetY.toFixed(0)} maps=${maps}`); lastMaps = maps; }
        if (g.player.state !== 'air' && i > 30) break;
        await new Promise((r) => setTimeout(r, 16));
      }
      return { landed: [g.player.pos.x, g.player.feetY, g.player.pos.z].map((v) => +v.toFixed(1)), state: g.player.state, map: g.map.id, secs: +((performance.now() - t0) / 1000).toFixed(1), log };
    }, c);
    console.log(JSON.stringify(c), JSON.stringify(r));
  }
  await browser.close();
})();

// How many PNG props are drawn per loaded map at a few spots (medium), plus shader errors if any.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('console', (m) => { if (/error|Shader/i.test(m.text())) console.log('console', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const spots = [['map001', 0], ['map001', 1], ['map004', 0], ['map004', 2], ['map006', 1], ['map007', 2]];
  for (const [MAP, k] of spots) {
    const r = await page.evaluate(async ([MAP, k]) => {
      const g = window.__game, V = g.player.pos.constructor;
      await g.loadOtherMaps(MAP); g.applyQuality('medium'); g.renderer.setAnimationLoop(null); g.ui.hideMenu(); g.state = 'playing';
      const d = g.maps.loaded.get(MAP).data, sp = d.spawn.p, ex = d.exit.p;
      const p = [sp, [(sp[0] + ex[0]) / 2, (sp[1] + ex[1]) / 2, (sp[2] + ex[2]) / 2], ex][k];
      g.player.teleport(new V(p[0], p[1] + 0.9, p[2]), 0); g.clock.getDelta = () => 1 / 60;
      for (let i = 0; i < 5; i++) g.frame();
      g.maps.setDetail(g.maps.detail); g.frame();
      const o = {};
      for (const [id, m] of g.maps.loaded) if (m.sprites) o[id] = `${m.sprites.drawn}/${m.sprites.total}`;
      return { at: p.map(Math.round).join(','), ...o };
    }, [MAP, k]);
    console.log(MAP, k, JSON.stringify(r));
  }
  await browser.close();
})();

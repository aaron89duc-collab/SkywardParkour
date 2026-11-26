// Map 004 screenshots without the animation loop (swiftshader is slow with three maps in the world).
// Usage: node devtools/out/tour4.cjs '<json shots>' <prefix>   shot: {p:[x,y,z], cy, pitch, dist, w?, h?}
const { chromium } = require('playwright');
(async () => {
  const shots = JSON.parse(process.argv[2] || '[]');
  const prefix = process.argv[3] || '/tmp/t4';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map006'); g.ui.hideMenu(); g.state = 'playing'; });
  // no name dialog / menus over the picture
  await page.evaluate(() => { for (const el of document.body.querySelectorAll('*')) { const st = getComputedStyle(el); if ((st.position === 'fixed' || st.position === 'absolute') && el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.display = 'none'; } document.querySelector('canvas').style.filter = 'none'; });
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    await page.evaluate(async (s) => {
      const g = window.__game, V = g.player.pos.constructor;
      g.player.teleport(new V(s.p[0], s.p[1] + 0.9, s.p[2]), s.yaw ?? 0);
      g.cam.snapTo(new V(s.p[0], s.p[1], s.p[2]), s.cy ?? 0); g.cam.pitch = s.pitch ?? 0.3; g.cam.distance = s.dist ?? 8;
      for (let k = 0; k < (s.frames ?? 4); k++) { g.frame(); await new Promise((r) => setTimeout(r, 50)); }
    }, s);
    await page.screenshot({ path: `${prefix}_${i}.png` });
    console.log('shot', i);
  }
  await browser.close();
})();

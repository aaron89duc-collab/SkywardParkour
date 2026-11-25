// Render the same spots at each quality preset and report the mean brightness (a black frame = broken render).
const { chromium } = require('playwright');
const sharp = require('sharp');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)); });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const spots = JSON.parse(process.argv[2] || '[[-51.4,520,0.9],[0,2,10],[-59,600,0.4]]');
  const quals = (process.argv[3] || 'low,medium,high').split(',');
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map004'); g.ui.hideMenu(); g.state = 'playing';
    for (const el of document.body.querySelectorAll('*')) { const st = getComputedStyle(el); if ((st.position === 'fixed' || st.position === 'absolute') && el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.display = 'none'; } });
  for (const q of quals) {
    for (const [i, s] of spots.entries()) {
      await page.evaluate(async ([q, s]) => {
        const g = window.__game, V = g.player.pos.constructor;
        if (g.quality !== q) g.applyQuality(q);
        g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
        g.cam.snapTo(new V(s[0], s[1], s[2]), 0.6); g.cam.pitch = 0.2; g.cam.distance = 8;
        for (let k = 0; k < 4; k++) { g.frame(); await new Promise((r) => setTimeout(r, 30)); }
      }, [q, s]);
      const buf = await page.screenshot();
      const st = await sharp(buf).stats();
      const mean = st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
      if (process.env.SAVE) await sharp(buf).toFile(`/tmp/q_${q}_${i}.png`);
      console.log(q, i, JSON.stringify(s), 'mean', mean.toFixed(1));
    }
  }
  console.log('errors', errs.slice(0, 8));
  await browser.close();
})();

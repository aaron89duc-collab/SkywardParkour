const OUT = require('path').join(__dirname, 'out', 'shots'); require('fs').mkdirSync(OUT, { recursive: true });
const seedProfile = (c) => c.addInitScript(() => { try { const k = 'skyward-parkour.save.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.profile) { s.profile = { name: 'Tester', id: 'test-tools-0001', token: 'e'.repeat(64) }; localStorage.setItem(k, JSON.stringify(s)); } } catch {} });
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  for (const dev of ['Pixel 7', 'iPhone 13 landscape', 'Pixel 7 landscape']) {
    const ctx = await browser.newContext({ ...devices[dev] }); await seedProfile(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('pageerror', e.message));
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
    await page.waitForTimeout(600);
    const tag = dev.replace(/ /g, '_');
    await page.screenshot({ path: `${OUT}/m_${tag}_menu.png` });
    if (dev.includes('landscape')) {
      await page.tap('[data-mode=adventure]');
      await page.waitForTimeout(1200);
      await page.evaluate(() => { const g = window.__game; const V = g.player.pos.constructor; g.player.teleport(new V(-12.75, 141.2, -38), -Math.PI / 2); g.player.regrab = 0; });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/m_${tag}_play.png` });
      console.log(dev, await page.evaluate(() => ({ st: window.__game.player.state, pr: window.__game.renderer.getPixelRatio() })));
    }
    await ctx.close();
  }
  await browser.close();
})();

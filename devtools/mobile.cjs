const OUT = require('path').join(__dirname, 'out', 'shots'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('pageerror ' + e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/mobile_menu.png' });
  await page.tap('[data-a=start]');
  await page.waitForTimeout(1500);
  // simulate a joystick drag
  const box = page.viewportSize();
  await page.screenshot({ path: OUT + '/mobile_play.png' });
  const q = await page.evaluate(() => ({ quality: window.__game.quality, touch: !!window.__game.touch, state: window.__game.state }));
  console.log(JSON.stringify(q), box, logs.join('\n'));
  await browser.close();
})();

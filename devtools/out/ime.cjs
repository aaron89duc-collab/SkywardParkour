// Vietnamese input method check: W A S D arriving as IME characters (no physical code) still move the player.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async () => {
    const g = window.__game, I = g.input;
    I.enabled = true;
    const ev = (type, key, code) => window.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true }));
    const out = {};
    ev('keydown', 'ư', ''); ev('keyup', 'ư', ''); I.update(); out.wAsIme = I.moveY;
    await new Promise((r) => setTimeout(r, 300)); out.map = [...I.imeKeys.entries()].map(([k, v]) => [k, Math.round(v - performance.now())]); out.keys = [...I.keys]; I.update(); out.after300 = I.moveY;
    await new Promise((r) => setTimeout(r, 500)); I.update(); out.after800 = I.moveY;
    ev('keydown', 'đ', ''); I.update(); out.dAsIme = I.moveX;
    ev('keyup', 'd', 'KeyD'); I.update(); out.dReleased = I.moveX;
    ev('keydown', 'w', 'KeyW'); I.update(); out.wNormal = I.moveY; ev('keyup', 'w', 'KeyW');
    out.toast = document.querySelector('.toast .t1')?.textContent;
    return out;
  });
  console.log(JSON.stringify(r));
  await browser.close();
})();

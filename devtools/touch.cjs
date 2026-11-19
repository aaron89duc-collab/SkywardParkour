// Real multi-touch test of the mobile controls (CDP touch events -> browser pointer events -> TouchControls).
// Checks: dead zone + walk/run response, base follows the thumb, a camera swipe sliding over JUMP never presses it,
// a held JUMP that slides off the button stays held, stick + jump + look with three fingers at once.
// Usage: node devtools/touch.cjs
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.tap('[data-a=start]');
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); });
  const cdp = await ctx.newCDPSession(page);
  const pts = new Map();
  const send = async (type) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts.values()] }); await page.waitForTimeout(25); };
  const down = async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchStart'); };
  const move = async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchMove'); };
  const up = async (id) => { pts.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...pts.values()] }); await page.waitForTimeout(25); };
  const st = () => page.evaluate(() => { const I = window.__game.input; return { mx: +I.touchMoveX.toFixed(3), my: +I.touchMoveY.toFixed(3), held: I.touchJumpHeld, jump: I.peekJump(), lookX: +I.lookX.toFixed(1) }; });
  const vp = page.viewportSize();
  const jumpBox = await page.locator('.tbtn-jump').boundingBox();
  const out = {};
  // 1) stick response
  const sx = 140, sy = vp.height - 110;
  await down(1, sx, sy);
  for (const d of [4, 10, 20, 30, 40, 49, 58]) { await move(1, sx, sy - d); out[`stick ${d}px`] = (await st()).my; }
  // 2) drag past the rim, then reverse: the base followed, so a small reversal already walks backwards
  await move(1, sx, sy - 140);
  await move(1, sx, sy - 140 + 72.5 + 20); // the base now sits 72.5 px below the thumb (1.25 x radius)
  out['reverse after overdrag (20 px back)'] = (await st()).my;
  await up(1);
  out['released'] = await st();
  // 3) camera swipe from the right side that slides across the JUMP button
  const lx = jumpBox.x - 120, ly = jumpBox.y + jumpBox.height / 2;
  await page.evaluate(() => window.__game.input.consumeLook());
  await down(2, lx, ly);
  for (let k = 1; k <= 8; k++) await move(2, lx + k * 25, ly);
  const sw = await st();
  await up(2);
  out['swipe over JUMP'] = { jumpPressed: sw.jump || sw.held, lookX: sw.lookX };
  // 4) press JUMP, slide the finger off the button while holding
  await page.evaluate(() => window.__game.input.clearEdges());
  await down(3, jumpBox.x + jumpBox.width / 2, jumpBox.y + jumpBox.height / 2);
  await move(3, jumpBox.x - 40, jumpBox.y - 40);
  const h1 = await st();
  await up(3);
  const h2 = await st();
  out['jump slide-off'] = { pressed: h1.jump, heldAfterSlide: h1.held, heldAfterRelease: h2.held };
  // 5) three fingers: stick + look + jump together
  await page.evaluate(() => window.__game.input.clearEdges());
  await down(4, sx, sy); await move(4, sx + 58, sy);
  await down(5, lx, ly - 60); await move(5, lx + 30, ly - 60);
  await down(6, jumpBox.x + jumpBox.width / 2, jumpBox.y + jumpBox.height / 2);
  const m = await st();
  out['three fingers'] = { stickX: m.mx, look: m.lookX !== 0, jump: m.jump && m.held };
  await up(6); await up(5); await up(4);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();

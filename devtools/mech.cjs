const OUT = require('path').join(__dirname, 'out', 'shots'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await page.evaluate(() => window.__game.start());
  const sleep = (ms) => page.waitForTimeout(ms);
  const st = () => page.evaluate(() => { const g = window.__game, p = g.player; return { s: p.state, f: p.renderPos.toArray().map(v => +v.toFixed(2)), vy: +p.vel.y.toFixed(2), anim: p.model.current }; });
  // ledge grab test on pillar at (-4, top 3, 6)
  await page.evaluate(() => { const g = window.__game; const T = g.player.pos.constructor; g.player.teleport(new T(-4, 0, 9.2), Math.PI); g.cam.yaw = 0; g.cam.pitch = 0.25; });
  await sleep(400);
  await page.evaluate(() => { const g = window.__game; g.input.touchMoveY = 1; });
  await sleep(250);
  await page.evaluate(() => { const g = window.__game; g.input.pressJump(); g.input.touchJumpHeld = true; });
  const trace = [];
  for (let i = 0; i < 12; i++) { await sleep(70); trace.push(await st()); }
  console.log('jump->grab', JSON.stringify(trace.map(t => `${t.s}/${t.anim} ${t.f[1]} vy${t.vy}`)));
  await page.evaluate(() => { const g = window.__game; g.input.touchMoveY = 0; g.input.touchJumpHeld = false; });
  await sleep(500);
  await page.evaluate(() => { const g = window.__game; g.cam.yaw = 0.9; g.cam.pitch = 0.1; g.cam.distance = 4; });
  await sleep(300);
  await page.screenshot({ path: OUT + '/mech_hang.png' });
  console.log('hang', JSON.stringify(await st()));
  await page.evaluate(() => window.__game.input.pressJump());
  const t2 = [];
  for (let i = 0; i < 8; i++) { await sleep(150); t2.push(await st()); if (i === 2) await page.screenshot({ path: OUT + '/mech_climb.png' }); }
  console.log('climb', JSON.stringify(t2.map(t => `${t.s}/${t.anim} ${t.f.join(',')}`)));
  await sleep(300);
  await page.screenshot({ path: OUT + '/mech_top.png' });
  // run & jump across: run forward off the pillar and fall to the ground (hard landing?)
  await page.evaluate(() => { const g = window.__game; g.input.touchMoveY = 1; });
  const t3 = [];
  for (let i = 0; i < 14; i++) { await sleep(80); t3.push(await st()); }
  console.log('run off', JSON.stringify(t3.map(t => `${t.s}/${t.anim} y${t.f[1]}`)));
  console.log(logs.join('\n'));
  await browser.close();
})();

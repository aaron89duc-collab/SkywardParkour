// Adventure vs Challenge, in the real game (dev server: packs auto-installed).
// Challenge: always from 0 m, no continue / teleport / admin, nothing about the run is kept, only records +
// achievements (separate from Adventure). Usage: node devtools/modes.cjs
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 620 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const out = {};
  const menu = () => page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  // a player who already conquered both maps in Adventure (personal best 320 m); seeded before the game runs
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('skyward-parkour.save.v1', JSON.stringify({ personalBest: 320, highestMap: 'map002', bestTimes: { map001: 600, map002: 2400 }, profile: { name: 'Tester', id: 'test-modes-0001', token: 'e'.repeat(64) } }));
  });
  await page.goto('http://127.0.0.1:5173/');
  await menu();
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps(); g.ui.refreshMaps(); });
  out.menu = await page.evaluate(() => ({
    modes: [...document.querySelectorAll('[data-mode]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
    continue: [...document.querySelectorAll('[data-cont]')].map((b) => b.textContent.trim()),
    achButton: document.querySelector('[data-a=ach]')?.textContent,
  }));
  // ---------------- Challenge
  await page.click('[data-mode=challenge]');
  await page.waitForFunction(() => window.__game.state === 'playing');
  const tick = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { g.input.update(); g.updatePlaying(1 / 60); } }, n);
  out.challengeStart = await page.evaluate(() => {
    const g = window.__game; g.renderer.setAnimationLoop(null);
    return { mode: g.mode, feetY: +g.player.feetY.toFixed(2), badge: !document.querySelector('.mode-badge').classList.contains('hidden'), hudBest: document.querySelector('.hud .lines').textContent };
  });
  for (let i = 0; i < 5; i++) await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyF');
  out.challengeAdmin = await page.evaluate(() => ({ flying: window.__game.admin.flying, panel: !document.querySelector('.admin-panel').classList.contains('hidden'), toast: document.querySelector('.toast')?.textContent?.trim() }));
  // climb (the harness places the player; players cannot): 76 m, then fall from 140 m to the ground
  out.climb = await page.evaluate(async () => {
    const g = window.__game, P = g.player, V = P.pos.constructor;
    const wp = g.maps.map('map001').waypoints.find((w) => w.label.startsWith('Khu D'));
    P.teleport(new V(wp.p[0], wp.p[1] + 0.1, wp.p[2]), 0);
    for (let i = 0; i < 40; i++) { g.input.update(); g.updatePlaying(1 / 60); }
    const afterClimb = { runMax: +g.score.runMax.toFixed(1), chBest: +g.save.challenge.best.toFixed(1), advBest: g.save.personalBest, ach: Object.keys(g.save.challenge.achievements) };
    P.teleport(new V(0, 75, 20), 0); // open air above the village square
    for (let i = 0; i < 400 && !(P.state === 'ground' && P.feetY < 5); i++) { g.input.update(); g.updatePlaying(1 / 60); }
    for (let i = 0; i < 30; i++) { g.input.update(); g.updatePlaying(1 / 60); }
    return { afterClimb, landedAt: +P.feetY.toFixed(1), runMaxKept: +g.score.runMax.toFixed(1), ach: Object.keys(g.save.challenge.achievements) };
  });
  // finish Starter Village in Challenge
  out.finish = await page.evaluate(() => {
    const g = window.__game, P = g.player, V = P.pos.constructor;
    const ex = g.maps.map('map001').exit.p;
    P.teleport(new V(ex[0], ex[1] - 0.5, ex[2]), Math.PI);
    for (let i = 0; i < 20; i++) { g.input.update(); g.updatePlaying(1 / 60); }
    return { chTimes: g.save.challenge.bestTimes, advTimes: g.save.bestTimes, ach: Object.keys(g.save.challenge.achievements), state: g.state };
  });
  await page.waitForTimeout(500);
  // a new Challenge run: back at 0 m; nothing about the old run survives a reload
  out.restart = await page.evaluate(() => { const g = window.__game; g.restart(); return { feetY: +g.player.feetY.toFixed(2), runMax: g.score.runMax, runs: g.save.challenge.runs }; });
  await page.evaluate(() => window.__game.score.flush());
  await page.reload();
  await menu();
  await page.evaluate(async () => { const g = window.__game; g.renderer.setAnimationLoop(null); await g.loadOtherMaps(); });
  out.afterReload = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('skyward-parkour.save.v1'));
    return { keys: Object.keys(s.challenge), lastMode: s.mode, savedPositionFields: Object.keys(s).filter((k) => /pos|run|spawn|checkpoint/i.test(k)) };
  });
  await page.click('[data-mode=challenge]');
  await page.waitForFunction(() => window.__game.state === 'playing');
  out.challengeAgain = await page.evaluate(() => ({ feetY: +window.__game.player.feetY.toFixed(2), startMap: window.__game.startMap }));
  // ---------------- Adventure: continue from Rooftop City, admin allowed
  await page.evaluate(() => { const g = window.__game; g.state = 'menu'; g.ui.showHUD(false); g.ui.refreshMaps(); g.ui.showMenu(g.save, {}, g.quality); });
  await page.click('[data-cont=map002]');
  await page.waitForFunction(() => window.__game.state === 'playing');
  out.adventure = await page.evaluate(() => ({ mode: window.__game.mode, feetY: +window.__game.player.feetY.toFixed(1), adminAllowed: window.__game.mode !== 'challenge', badge: !document.querySelector('.mode-badge').classList.contains('hidden') }));
  out.achPanel = await page.evaluate(() => { window.__game.ui.online.openAchievements(window.__game.ach.list().map((d) => ({ title: d.title, desc: d.desc, at: window.__game.save.challenge?.achievements[d.id] ?? null }))); return [...document.querySelectorAll('.ach')].map((a) => (a.classList.contains('got') ? '★ ' : '☆ ') + a.querySelector('b').textContent.slice(2)); });
  await page.screenshot({ path: __dirname + '/out/shots/achievements.png' });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();

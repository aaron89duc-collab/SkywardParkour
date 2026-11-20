// Admin / map-test mode, end to end.
// Usage: node devtools/admin.cjs <url> [password]   (open: M pressed 5x, PC only)
//   dev server  (http://127.0.0.1:5173/): admin is unlocked without a password
//   production  (npx vite preview -> http://127.0.0.1:4173/): hidden, password required
const seedProfile = (c) => c.addInitScript(() => { try { const k = 'skyward-parkour.save.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.profile) { s.profile = { name: 'Tester', id: 'test-tools-0001', token: 'e'.repeat(64) }; localStorage.setItem(k, JSON.stringify(s)); } } catch {} });
const { chromium, devices } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:5173/';
  const pw = process.argv[3] || '';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const out = {};
  // ---------------- PC
  {
    const _ctx = await browser.newContext({ viewport: { width: 1100, height: 640 } }); await seedProfile(_ctx); const page = await _ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
    await page.evaluate(() => { localStorage.setItem('skyward-parkour.save.v1', JSON.stringify({ personalBest: 12.5, highestMap: null })); });
    await page.reload();
    await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
    // production build: Map 002 is a download (served from /content/ by the preview server here)
    await page.evaluate(async () => {
      const g = window.__game; g.renderer.setAnimationLoop(null);
      await g.content.check();
      for (const st of g.content.statuses()) if (st.state === 'download') await g.content.install(st.id);
      await g.loadOtherMaps();
      g.renderer.setAnimationLoop(() => g.frame());
    });
    await page.click('[data-mode=adventure]');
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
    const vis = () => page.evaluate(() => ({
      panel: !document.querySelector('.admin-panel').classList.contains('hidden'),
      prompt: !document.querySelector('.admin-prompt').classList.contains('hidden'),
      badge: !document.querySelector('.test-badge').classList.contains('hidden'),
      unlocked: window.__game.admin.unlocked, flying: window.__game.admin.flying, state: window.__game.state,
    }));
    out.pc_start = await vis();
    // M x5 (rendering paused meanwhile: the software GPU would space the key events ~1 s apart)
    await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
    for (let i = 0; i < 5; i++) await page.keyboard.press('KeyM');
    await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(() => g.frame()); });
    await page.waitForTimeout(300);
    out.pc_afterM5 = await vis();
    if (out.pc_afterM5.prompt) {
      await page.fill('.ap-input', 'wrong-password');
      await page.click('.admin-prompt [data-a=ok]');
      out.pc_wrong = { err: await page.textContent('.ap-err'), ...(await vis()) };
      await page.fill('.ap-input', pw);
      await page.click('.admin-prompt [data-a=ok]');
      await page.waitForTimeout(300);
      out.pc_right = await vis();
    }
    // fly up 1.5 s, forward 1 s, drop, land
    const pos = () => page.evaluate(() => { const P = window.__game.player; return [P.pos.x, P.feetY, P.pos.z].map((v) => +v.toFixed(2)).concat([P.state]); });
    await page.click('canvas.game').catch(() => {});
    await page.waitForTimeout(200);
    const p0 = await pos();
    await page.keyboard.press('KeyF');
    await page.keyboard.down('Space'); await page.waitForTimeout(1500); await page.keyboard.up('Space');
    const p1 = await pos();
    await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
    const p2 = await pos();
    out.fly = { start: p0, afterUp: p1, afterForward: p2, ...(await vis()) };
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(3500);
    out.dropped = { at: await pos(), ...(await vis()) };
    // teleport to every waypoint: must arrive standing, not stuck inside anything
    out.waypoints = await page.evaluate(async () => {
      const g = window.__game, A = g.admin, sel = document.querySelector('.admin-panel select');
      const res = [];
      for (const o of [...sel.options].filter((o) => o.value)) {
        sel.value = o.value;
        document.querySelector('.admin-panel [data-a=go]').click();
        const t0 = performance.now();
        while (performance.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 50));
        const [x, y, z] = o.value.split(',').map(Number);
        const P = g.player;
        res.push({ wp: o.textContent, ok: P.state === 'ground' && Math.abs(P.feetY - y) < 0.6 && Math.hypot(P.pos.x - x, P.pos.z - z) < 0.8, state: P.state, dy: +(P.feetY - y).toFixed(2) });
      }
      void A;
      return res;
    });
    // G: stand on the surface below after flying high
    await page.keyboard.press('KeyF');
    await page.keyboard.down('Space'); await page.waitForTimeout(1200); await page.keyboard.up('Space');
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(1200);
    out.placeOnGround = await pos();
    // nothing recorded
    out.saved = await page.evaluate(() => { window.__game.score.flush(); const s = JSON.parse(localStorage.getItem('skyward-parkour.save.v1')); return { personalBest: s.personalBest, highestMap: s.highestMap, runMax: +window.__game.score.runMax.toFixed(1) }; });
    // restart -> normal run again
    await page.evaluate(() => window.__game.restart());
    out.afterRestart = { test: await page.evaluate(() => window.__game.score.test), ...(await vis()) };
    await page.close();
  }
  // ---------------- phone: admin must not exist at all (taps on the HUD, M presses from a BT keyboard)
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] }); await seedProfile(ctx);
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
    await page.tap('[data-mode=adventure]');
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
    await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
    for (let i = 0; i < 5; i++) await page.tap('.hud .height').catch(() => {});
    for (let i = 0; i < 5; i++) await page.keyboard.press('KeyM');
    await page.waitForTimeout(300);
    out.phone = await page.evaluate(() => ({ pcOnly: window.__game.admin.pcOnly, unlocked: window.__game.admin.unlocked,
      prompt: !document.querySelector('.admin-prompt').classList.contains('hidden'), panel: !document.querySelector('.admin-panel').classList.contains('hidden') }));
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();

// Automatic map downloads, end to end, against a production build (`npx vite build`, `npx vite preview --port 4173`).
//  1. the window: playing map N keeps maps N+1..N+3 (logic, with a fake list of 6 maps)
//  2. first launch online: Map 002 downloads by itself (no tap, nothing shown), the gate at 140 m opens
//  3. offline with the next map missing: warning + gate sign "bật mạng"; the Maps list still shows every map
//  4. back online: downloads by itself (nothing shown), the warning goes away, the map joins the world
// Usage: node devtools/autosync.cjs [url]
const seedProfile = (c) => c.addInitScript(() => { try { const k = 'skyward-parkour.save.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.profile) { s.profile = { name: 'Tester', id: 'test-tools-0001', token: 'e'.repeat(64) }; localStorage.setItem(k, JSON.stringify(s)); } } catch {} });
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:4173/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  await seedProfile(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  let clicks = 0;
  await page.exposeFunction('__countClick', () => { clicks++; });
  const out = {};
  const pill = () => page.evaluate(() => { const p = document.querySelector('.sync-pill'); return p.classList.contains('hidden') ? null : `${p.dataset.kind}: ${p.textContent.replace(/\s+/g, ' ').trim()}`; });
  const pills = [];
  const watch = setInterval(async () => { try { const p = await pill(); if (p && pills[pills.length - 1] !== p.replace(/\d+%/, '%')) pills.push(p.replace(/\d+%/, '%')); } catch {} }, 250);

  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(() => { window.__game.renderer.setAnimationLoop(null); document.addEventListener('click', () => window.__countClick(), true); });

  // ---------------- 1. window of maps kept ahead
  out.window = await page.evaluate(() => {
    const g = window.__game, c = g.content, a = g.autoSync;
    const real = c.statuses.bind(c);
    const fake = [1, 2, 3, 4, 5, 6].map((o) => ({ id: `map00${o}`, name: `Map ${o}`, order: o, state: o === 1 ? 'ready' : 'download', bytes: 1 }));
    c.statuses = () => fake;
    const save = g.save.highestMap, map = g.map;
    const res = {};
    g.save.highestMap = null; res.playing001 = a.wanted().map((s) => s.id);
    g.save.highestMap = 'map002'; res.conquered002 = a.wanted().map((s) => s.id);
    c.statuses = real; g.save.highestMap = save; g.map = map;
    return res;
  });

  // ---------------- 2. first launch online: no tap needed
  const t0 = Date.now();
  await page.waitForFunction(() => !!window.__game.maps.map('map002'), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__game.autoSync.view.kind === 'idle', null, { timeout: 60000 });
  out.firstLaunch = await page.evaluate(() => ({
    settingsToggle: !!document.querySelector('[data-k=automaps]'),
    statuses: window.__game.content.statuses().map((s) => `${s.id}:${s.state}`),
    gate140Closed: window.__game.maps.gates.closed('map001'), view: window.__game.autoSync.view.kind,
  }));
  out.firstLaunch.seconds = Math.round((Date.now() - t0) / 1000);

  // ---------------- 3. offline, next map missing (removed to simulate a new map announced earlier)
  await ctx.setOffline(true);
  await page.evaluate(async () => { await window.__game.content.remove('map002'); window.__game.autoSync.kick(); });
  await page.waitForFunction(() => window.__game.autoSync.view.kind === 'offline', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  out.offline = await page.evaluate(() => ({
    pill: document.querySelector('.sync-pill').textContent.replace(/\s+/g, ' ').trim(),
    gateSign: window.__game.nextInfo('map002', '').sub, installing: !!window.__game.content.installing,
    statuses: window.__game.content.statuses().map((s) => `${s.id}:${s.state}`),
  }));
  out.offline.mapsList = await page.evaluate(() => { window.__game.ui.online.openMaps(); return { rows: [...document.querySelectorAll('.maps-box .map-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()), buttons: document.querySelectorAll('.maps-box button').length }; });
  await page.evaluate(() => window.__game.frame());
  await page.screenshot({ path: __dirname + '/out/shots/autosync_maps.png' });
  await page.evaluate(() => { document.querySelector('.maps-box').classList.add('hidden'); window.__game.frame(); });
  await page.screenshot({ path: __dirname + '/out/shots/autosync_offline.png' });
  // the same warning while playing (HUD)
  await page.evaluate(async () => { const g = window.__game; await g.start(); g.renderer.setAnimationLoop(null); g.frame(); });
  await page.screenshot({ path: __dirname + '/out/shots/autosync_offline_hud.png' });

  // ---------------- 4. back online: downloads by itself, warning disappears
  const t1 = Date.now();
  await ctx.setOffline(false);
  await page.waitForFunction(() => window.__game.content.statuses().find((s) => s.id === 'map002')?.state === 'ready', null, { timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.sync-pill').classList.contains('hidden'), null, { timeout: 20000 });
  out.backOnline = await page.evaluate(() => ({
    statuses: window.__game.content.statuses().map((s) => `${s.id}:${s.state}`), view: window.__game.autoSync.view.kind,
    pillHidden: document.querySelector('.sync-pill').classList.contains('hidden'),
  }));
  out.backOnline.seconds = Math.round((Date.now() - t1) / 1000);
  out.pillsSeen = pills;
  out.clicks = clicks;
  clearInterval(watch);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();

// Download Once – Play Offline – Update When Online, end to end, against a production build.
// Needs: `VITE_API_URL=http://127.0.0.1:8787 npx vite build`, `npx vite preview --port 4173`, and the API worker
// (`cd server && npx wrangler dev --local --port 8787`).
// Usage: node devtools/offline.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const URL0 = 'http://127.0.0.1:4173/';
const API = 'http://127.0.0.1:8787';

function contentBuild() {
  execFileSync('node', ['devtools/content.mjs', 'build'], { cwd: ROOT, stdio: 'pipe' });
  fs.rmSync(path.join(ROOT, 'dist/content'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'content-dist'), path.join(ROOT, 'dist/content'), { recursive: true, filter: (s) => !path.basename(s).startsWith('.') });
}

(async () => {
  const out = {};
  const mapJson = path.join(ROOT, 'packs/map002/maps/map002.json');
  const packJson = path.join(ROOT, 'packs/map002/pack.json');
  const backup = { map: fs.readFileSync(mapJson), pack: fs.readFileSync(packJson) };
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const fileReqs = [];
  page.on('request', (r) => { if (r.url().includes('/content/files/')) fileReqs.push(r.url()); });
  const menu = () => page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const still = () => page.evaluate(() => window.__game.renderer.setAnimationLoop(null));
  try {
    // ---------------- 1. first launch, online
    await page.goto(URL0);
    await menu();
    out.firstLaunch = await page.evaluate(() => ({ nameAsked: !document.querySelector('.name-box').classList.contains('hidden'), maps: window.__game.content.entries().map((e) => e.id) }));
    await page.fill('.name-input', 'Đức Test');
    await page.click('.name-box [data-a=ok]');
    await still();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('skyward-app-')), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__game.content.online === true, null, { timeout: 60000 });
    await page.evaluate(() => window.__game.loadOtherMaps());
    out.beforeDownload = await page.evaluate(() => ({
      profile: window.__game.save.profile?.name, statuses: window.__game.content.statuses().map((s) => `${s.id}:${s.state}:${(s.bytes / 1048576).toFixed(1)}MB`),
      gateMap001Closed: window.__game.maps.gates.closed('map001'), news: document.querySelector('.news')?.textContent?.replace(/\s+/g, ' ').trim(),
    }));
    // the closed gate at the top of Map 001 holds: run north into it
    out.gateBlocks = await page.evaluate(() => {
      const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
      g.state = 'playing'; I.enabled = true;
      P.teleport(new V(-9, 140.1, -38.2), Math.PI);
      I.touchMoveY = 1;
      for (let i = 0; i < 150; i++) { I.update(); P.fixedUpdate(1 / 60, I, 0); g.physics.step(); }
      I.touchMoveY = 0; g.state = 'menu';
      return { z: +P.pos.z.toFixed(2), y: +P.feetY.toFixed(2) };
    });
    // ---------------- 2. download Map 002 from the Maps panel
    await page.click('[data-a=maps]');
    await page.click('.maps-box [data-m=get][data-id=map002]');
    await page.waitForFunction(() => !!window.__game.maps.map('map002'), null, { timeout: 240000 });
    out.afterDownload = await page.evaluate(() => ({
      statuses: window.__game.content.statuses().map((s) => `${s.id}:${s.state}:v${s.version}`), gateMap001Closed: window.__game.maps.gates.closed('map001'),
      gateMap002Closed: window.__game.maps.gates.closed('map002'), files: Object.keys(window.__game.content.state.packs.map002.files).length,
    }));
    out.downloadRequests = fileReqs.length;

    // ---------------- 3. airplane mode: reopen the game
    await ctx.setOffline(true);
    await page.reload();
    await menu();
    await still();
    await page.waitForFunction(() => window.__game.content.online === false, null, { timeout: 60000 });
    await page.evaluate(() => window.__game.loadOtherMaps());
    out.offlineStart = await page.evaluate(async () => ({
      online: navigator.onLine, maps: [...window.__game.maps.loaded.keys()], controlledBySW: !!navigator.serviceWorker.controller,
      gateMap001Closed: window.__game.maps.gates.closed('map001'), gateMap002Closed: window.__game.maps.gates.closed('map002'),
      mapsPanel: (window.__game.ui.online.openMaps(), document.querySelector('.maps-status span').textContent),
    }));
    // ---------------- 4. play Map 002 offline to the top: finish counts, the safe gate holds
    out.offlinePlay = await page.evaluate(async () => {
      const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
      document.querySelector('.maps-box').classList.add('hidden');
      await g.start();
      g.renderer.setAnimationLoop(null);
      P.teleport(new V(-33.2, 318.9, -9.2), -Math.PI / 2);
      for (let i = 0; i < 30; i++) { I.update(); g.updatePlaying(1 / 60); }
      const st1 = g.state;
      const finishText = [...document.querySelectorAll('.overlay')].find((o) => !o.classList.contains('hidden') && /Chinh phục/.test(o.textContent))?.textContent?.replace(/\s+/g, ' ').slice(0, 220) ?? '';
      g.state = 'playing'; I.enabled = true;
      // walk west into the summit's closed gate
      P.teleport(new V(-36.5, 318.9, -9.2), -Math.PI / 2);
      I.touchMoveX = 0; I.touchMoveY = 1; g.cam.yaw = Math.PI / 2;
      for (let i = 0; i < 150; i++) { I.update(); P.fixedUpdate(1 / 60, I, Math.PI / 2); g.physics.step(); }
      I.touchMoveY = 0;
      g.score.flush();
      return { stateAfterExit: st1, finishText, xAgainstGate: +P.pos.x.toFixed(2), y: +P.feetY.toFixed(2), best: +g.save.personalBest.toFixed(1), highestMap: g.save.highestMap, lbDirty: g.lb.dirty };
    });
    // ---------------- 5. leaderboard while offline
    out.lbOffline = await page.evaluate(async () => {
      const ok = await window.__game.lb.sync();
      const b = await window.__game.lb.board('height');
      return { sent: ok, board: b ? `cached ${b.cached}` : 'none (no saved copy yet)', online: window.__game.lb.online };
    });
    // ---------------- back online: waiting results go out by themselves ('online' event)
    await ctx.setOffline(false);
    await page.waitForFunction(() => !window.__game.lb.dirty, null, { timeout: 30000 }).catch(() => {});
    out.lbOnline = await page.evaluate(async () => {
      const b = await window.__game.lb.board('height');
      const me = b?.entries.find((e) => e.me);
      return { dirty: window.__game.lb.dirty, me: me ? `${me.rank}. ${me.name} #${me.tag} ${me.v} m` : null, cached: b?.cached };
    });
    out.apiSays = await fetch(`${API}/v1/board?b=height`).then((r) => r.json()).then((j) => j.entries.map((e) => `${e.rank}. ${e.name} ${e.v}`)).catch(() => 'no API running (leaderboard not set up): skipped');

    // ---------------- 6. incremental update: one file of Map 002 changes on the server
    const j = JSON.parse(backup.map);
    j.waypoints.push({ label: 'test update', p: [0, 200, 0] });
    fs.writeFileSync(mapJson, JSON.stringify(j));
    contentBuild();
    fileReqs.length = 0;
    out.update = await page.evaluate(async () => {
      const c = window.__game.content;
      await c.check();
      const s = c.statuses().find((x) => x.id === 'map002');
      const before = { state: s.state, version: s.version, remote: s.remote.version, bytes: s.bytes };
      await c.install('map002');
      return { before, after: c.state.packs.map002.version, pendingRestart: c.updatePendingRestart('map002') };
    });
    out.update.downloadedFiles = fileReqs.length;
    await page.reload();
    await menu();
    await still();
    out.afterRestart = await page.evaluate(async () => { await window.__game.loadOtherMaps(); return { version: window.__game.content.statuses().find((x) => x.id === 'map002').version, testWaypoint: window.__game.maps.map('map002').waypoints.some((w) => w.label === 'test update') }; });

    // ---------------- 7. a corrupted download never replaces the working version
    j.waypoints.push({ label: 'second update', p: [0, 210, 0] });
    fs.writeFileSync(mapJson, JSON.stringify(j));
    contentBuild();
    await page.route('**/content/files/**', async (route) => route.fulfill({ status: 200, body: Buffer.alloc(26000, 7), headers: { 'content-type': 'application/octet-stream' } }));
    out.corrupt = await page.evaluate(async () => {
      const c = window.__game.content;
      await c.check();
      let err = null;
      try { await c.install('map002'); } catch (e) { err = e.message; }
      return { error: err, installedVersion: c.state.packs.map002.version, remoteVersion: c.statuses().find((x) => x.id === 'map002').remote.version };
    });
    await page.unroute('**/content/files/**');
    await ctx.setOffline(true);
    await page.reload();
    await menu();
    await still();
    out.afterCorrupt = await page.evaluate(async () => { await window.__game.loadOtherMaps(); return { maps: [...window.__game.maps.loaded.keys()], version: window.__game.content.statuses().find((x) => x.id === 'map002').version }; });
  } finally {
    fs.writeFileSync(mapJson, backup.map);
    fs.writeFileSync(packJson, backup.pack);
    contentBuild();
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 1));
})();

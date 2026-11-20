// Standing on a moving platform: does the character's feet touch the deck? (physics + visual, per tick)
// Usage: node devtools/mover.cjs [url] [moverId]      default http://127.0.0.1:4173/ (vite preview) and hover2
// Writes side-view shots to devtools/out/shots/mover_*.png
const seedProfile = (c) => c.addInitScript(() => { try { const k = 'skyward-parkour.save.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.profile) { s.profile = { name: 'Tester', id: 'test-tools-0001', token: 'e'.repeat(64) }; localStorage.setItem(k, JSON.stringify(s)); } } catch {} });
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'out', 'shots');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:4173/';
  const id = process.argv[3] || 'hover2';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await seedProfile(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  await page.evaluate(async () => {
    const g = window.__game; g.renderer.setAnimationLoop(null);
    await g.content.check();
    for (const st of g.content.statuses()) if (st.state === 'download' || st.state === 'update') await g.content.install(st.id);
    await g.loadOtherMaps();
    g.renderer.setAnimationLoop(() => g.frame());
  });
  await page.click('[data-mode=adventure]');
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => window.__game.renderer.setAnimationLoop(null));

  // helpers live in the page
  await page.evaluate(() => {
    const g = window.__game, P = g.player;
    window.__feet = () => {
      let min = Infinity; const v = P.pos.clone();
      P.model.root.updateMatrixWorld(true);
      P.model.root.traverse((o) => { if (o.isBone && /foot|toe/i.test(o.name)) { o.getWorldPosition(v); min = Math.min(min, v.y); } });
      return min;
    };
    window.__tick = (n) => { for (let i = 0; i < n; i++) g.updatePlaying(1 / 60); };
    window.__shot = (side) => {
      const c = g.cam.camera, f = P.renderPos;
      c.position.set(f.x + side[0], f.y + side[1], f.z + side[2]);
      c.lookAt(f.x, f.y + 0.6, f.z);
      c.updateMatrixWorld(true);
      if (g.composer) g.composer.render(0); else g.renderer.render(g.scene, c);
    };
  });

  const out = {};
  // baseline: standing still on solid ground (spawn)
  out.ground = await page.evaluate(() => { window.__tick(90); const P = window.__game.player; return { state: P.state, grounded: P.grounded, feetY: +P.feetY.toFixed(3), footBoneMinMinusFeet: +(window.__feet() - P.renderPos.y).toFixed(3) }; });

  // onto the platform
  out.ride = await page.evaluate((id) => {
    const g = window.__game, P = g.player;
    let mv = null;
    for (const m of g.maps.loaded.values()) for (const x of m.movers.movers) if (x.data.id === id) mv = x;
    if (!mv) return { error: 'no mover ' + id };
    const p = mv.pos.clone(); p.y += 0.05;
    P.teleport(p, 0);
    window.__mv = mv;
    const rows = [];
    for (let i = 0; i < 1300; i++) {
      window.__tick(1);
      if (i % 10 === 0) rows.push({
        i, moverY: +mv.pos.y.toFixed(3), deckVisY: +mv.group.position.y.toFixed(3), feetY: +P.feetY.toFixed(3),
        renderY: +P.renderPos.y.toFixed(3), footBone: +window.__feet().toFixed(3), state: P.state, grounded: P.grounded, riding: !!P.riding,
        moving: mv.vel.length() > 0.01,
      });
    }
    const gaps = rows.filter((r) => r.state !== 'air');
    const stat = (k) => { const v = gaps.map(k); return { min: +Math.min(...v).toFixed(3), max: +Math.max(...v).toFixed(3) }; };
    return {
      cycle: mv.cycle, samples: rows.length, offPlatform: rows.filter((r) => !r.riding).length,
      states: [...new Set(rows.map((r) => r.state + (r.grounded ? '' : '(air)')))],
      physGap_feetMinusDeck: stat((r) => r.feetY - r.moverY),
      visGap_renderMinusDeckVis: stat((r) => r.renderY - r.deckVisY),
      visGapMoving: (() => { const v = gaps.filter((r) => r.moving).map((r) => r.renderY - r.deckVisY); return v.length ? { min: +Math.min(...v).toFixed(3), max: +Math.max(...v).toFixed(3) } : null; })(),
      footBoneMinusDeckVis: stat((r) => r.footBone - r.deckVisY),
      sample: rows.filter((_, k) => k % 13 === 0),
    };
  }, id);

  // side views: parked and moving
  for (const [name, side] of [['side', [3.2, 0.6, 0]], ['front', [0, 0.8, 3.4]]]) {
    await page.evaluate((s) => window.__shot(s), side);
    await page.screenshot({ path: path.join(OUT, `mover_${id}_${name}.png`) });
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();

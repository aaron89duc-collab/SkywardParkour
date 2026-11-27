// Stutter probe: plays a map for a few seconds (running + jumping) and times each part of every frame.
// Prints the worst frames with their breakdown, the per-part averages/max and the JS heap growth (GC pressure).
// usage: node devtools/out/stutter.cjs [map001] [seconds] [quality]
const { chromium } = require('playwright');
const MAP = process.argv[2] || 'map001';
const SECS = Number(process.argv[3] || 10);
const Q = process.argv[4] || 'medium';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const r = await page.evaluate(async ({ MAP, SECS, Q }) => {
    const g = window.__game, V = g.player.pos.constructor;
    await g.loadOtherMaps(MAP);
    const md = g.maps.loaded.get(MAP)?.data;
    g.applyQuality(Q);
    g.ui.hideMenu(); g.state = 'playing'; g.input.enabled = true;
    if (md) { const s = md.spawn?.p; if (s) g.player.teleport(new V(s[0] ?? s.x, (s[1] ?? s.y) + 0.9, s[2] ?? s.z), 0); }
    const parts = {};
    const wrap = (obj, name, label) => {
      if (!obj || typeof obj[name] !== 'function') return;
      const f = obj[name].bind(obj);
      parts[label] = { cur: 0, tot: 0, max: 0 };
      obj[name] = (...a) => { const t = performance.now(); try { return f(...a); } finally { parts[label].cur += performance.now() - t; } };
    };
    wrap(g, 'adaptResolution', 'adaptRes');
    wrap(g, 'watchBlackFrames', 'blackFrames');
    wrap(g.maps, 'stepMovers', 'movers.step');
    wrap(g.maps, 'syncMovers', 'movers.sync');
    wrap(g.player, 'fixedUpdate', 'player.fixed');
    wrap(g.player, 'syncVisual', 'player.visual');
    wrap(g.physics, 'step', 'physics');
    wrap(g.env, 'update', 'env');
    wrap(g.clouds, 'update', 'clouds');
    wrap(g.fx, 'update', 'fx');
    wrap(g.maps, 'update', 'maps.update');
    wrap(g.audio, 'update', 'audio');
    wrap(g.cam, 'update', 'camera');
    wrap(g.ui, 'updateHUD', 'hud');
    wrap(g.score, 'update', 'score');
    wrap(g, 'updateDropShadow', 'dropShadow');
    wrap(g.maps, 'mapAt', 'mapAt');
    wrap(g.maps, 'zoneAt', 'zoneAt');
    if (g.composer) wrap(g.composer, 'render', 'render'); else wrap(g.renderer, 'render', 'render');
    wrap(g, 'frame', 'FRAME');
    const frames = [];
    const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code.slice(-1).toLowerCase() }));
    key('KeyW', true);
    let lastT = performance.now(), heap0 = performance.memory?.usedJSHeapSize ?? 0, heapDrops = 0, prevHeap = heap0, allocated = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const now = performance.now();
        const row = { gap: now - lastT };
        lastT = now;
        for (const [k, p] of Object.entries(parts)) { row[k] = p.cur; p.tot += p.cur; p.max = Math.max(p.max, p.cur); p.cur = 0; }
        frames.push(row);
        const h = performance.memory?.usedJSHeapSize ?? 0;
        if (h < prevHeap) heapDrops++; else allocated += h - prevHeap;
        prevHeap = h;
        const el = (now - t0) / 1000;
        // steer: jump now and then, turn a little
        if (frames.length % 50 === 0) { key('Space', true); setTimeout(() => key('Space', false), 80); }
        if (frames.length % 120 === 0) { key('KeyA', true); setTimeout(() => key('KeyA', false), 300); }
        if (el > SECS) res(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    key('KeyW', false);
    frames.shift();
    const n = frames.length;
    const avg = {}; for (const [k, p] of Object.entries(parts)) avg[k] = [+(p.tot / n).toFixed(2), +p.max.toFixed(1)];
    const worst = frames.slice().sort((a, b) => b.FRAME - a.FRAME).slice(0, 6).map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v > 0.6).map(([k, v]) => [k, +v.toFixed(1)])));
    const ft = frames.map((f) => f.FRAME).sort((a, b) => a - b);
    return {
      map: MAP, quality: Q, frames: n, secs: SECS,
      frameMs: { p50: +ft[Math.floor(n * 0.5)].toFixed(1), p95: +ft[Math.floor(n * 0.95)].toFixed(1), p99: +ft[Math.floor(n * 0.99)].toFixed(1), max: +ft[n - 1].toFixed(1) },
      heapMB: +(prevHeap / 1e6).toFixed(1), allocMBperSec: +(allocated / 1e6 / SECS).toFixed(2), gcs: heapDrops,
      partsAvgMax: avg, worst,
    };
  }, { MAP, SECS, Q });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

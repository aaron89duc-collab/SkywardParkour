// Find what turns the bloom frame black (NaN/Inf pixels spread by the bloom blur): hide scene parts one by one.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 200000 });
  const s = JSON.parse(process.argv[2] || '[-51.4,520,0.9]');
  const r = await page.evaluate(async (s) => {
    const g = window.__game, V = g.player.pos.constructor;
    g.renderer.setAnimationLoop(null); await g.loadOtherMaps('map004'); g.ui.hideMenu(); g.state = 'playing';
    if (g.quality !== 'high' || window.__forceApply) g.applyQuality('high');
    g.player.teleport(new V(s[0], s[1] + 0.9, s[2]), 0);
    g.cam.snapTo(new V(s[0], s[1], s[2]), 0.6); g.cam.pitch = 0.2; g.cam.distance = 8;
    const gl = g.renderer.getContext();
    const bright = () => { g.frame(); const px = new Uint8Array(4 * 64); let sum = 0; for (let k = 0; k < 8; k++) { gl.readPixels(Math.floor((k + 0.5) * gl.drawingBufferWidth / 8), Math.floor(gl.drawingBufferHeight / 2), 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4 * 64)); } const all = new Uint8Array(4 * gl.drawingBufferWidth * 4); gl.readPixels(0, Math.floor(gl.drawingBufferHeight / 2), gl.drawingBufferWidth, 4, gl.RGBA, gl.UNSIGNED_BYTE, all); for (let i = 0; i < all.length; i += 4) sum += all[i] + all[i + 1] + all[i + 2]; return sum / (all.length / 4) / 3; };
    for (let k = 0; k < 4; k++) bright();
    const out = { quality: g.quality, base: bright() };
    // top-level scene children
    const walk = (list, prefix, depth) => { for (const c of list) { const v = c.visible; c.visible = false; const b = bright(); c.visible = v; bright(); const key = prefix + (c.name || c.type) + '#' + list.indexOf(c); out[key] = +b.toFixed(1); if (b > 60 && out.base < 30 && depth < 4 && c.children.length) walk(c.children, key + ' > ', depth + 1); } };
    walk(g.scene.children, '', 0);
    return out;
  }, s);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

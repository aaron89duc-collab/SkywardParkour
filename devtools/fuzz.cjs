// Fuzz: random play around solid prefabs; detect the player ending up enclosed inside a collider.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const map = JSON.parse(fs.readFileSync(__dirname + '/../public/maps/' + (process.argv[2] || 'map001') + '.json', 'utf8'));
  const ticks = parseInt(process.argv[3] || '700');
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  await page.evaluate(() => { const g = window.__game; g.renderer.setAnimationLoop(null); g.state = 'playing'; g.input.enabled = true; });
  const res = await page.evaluate(({ prefabs, ticks, SEED }) => {
    const g = window.__game, P = g.player, I = g.input, V = P.pos.constructor;
    const ph = g.physics;
    const enclosed = () => {
      const c = new V(P.pos.x, P.pos.y + 0.2, P.pos.z);
      let h0 = null;
      const up = ph.raycast(c, new V(0, 1, 0), 30);
      if (!up) return null;
      h0 = up.collider.handle;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        const h = ph.raycast(c, new V(Math.sin(a), 0, Math.cos(a)), 25);
        if (!h || h.collider.handle !== h0) return null;
      }
      return h0;
    };
    let seed = SEED; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const out = []; const unstuck = [];
    for (const pf of prefabs) {
      if (/island|bridge/.test(pf.id)) continue;
      for (let trial = 0; trial < 10; trial++) {
        const a = rnd() * Math.PI * 2, r = pf.s * (0.55 + rnd() * 0.5);
        const sx = pf.p[0] + Math.sin(a) * r, sz = pf.p[2] + Math.cos(a) * r;
        P.teleport(new V(sx, pf.p[1] + 6 + rnd() * pf.s, sz), 0);
        const log = [];
        let found = null; let encl = 0;
        for (let i = 0; i < ticks && !found; i++) {
          if (i % 25 === 0) {
            // aim mostly toward the prefab centre
            const tx = pf.p[0] - P.pos.x + (rnd() - 0.5) * pf.s, tz = pf.p[2] - P.pos.z + (rnd() - 0.5) * pf.s;
            const cy = rnd() * 6.28;
            const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = Math.cos(cy), rz = -Math.sin(cy);
            const len = Math.hypot(tx, tz) || 1; const wx = tx / len, wz = tz / len;
            I.touchMoveX = wx * rx + wz * rz; I.touchMoveY = wx * fx + wz * fz; I._cy = cy;
            if (rnd() < 0.2) { I.touchMoveX *= 0.4; I.touchMoveY *= 0.4; }
          }
          if (rnd() < 0.08) { I.touchJumpHeld = !I.touchJumpHeld; if (I.touchJumpHeld) I.pressJump(); }
          I.update();
          P.fixedUpdate(1 / 60, I, I._cy || 0);
          ph.step();
          for (const e of P.drainEvents()) { if (e.type === 'unstuck') unstuck.push({ prefab: pf.id, tick: i, log: log.slice(-6), pos: [P.pos.x, P.pos.y - 0.8, P.pos.z].map(v => +v.toFixed(2)) }); log.push(i + ':' + e.type + '@' + P.state + (P.moveKind ? '/' + P.moveKind : ''));
          } if (log.length > 12) log.shift();
          if (i % 6 === 0) {
            const h = P.state === 'move' ? null : enclosed();
            if (h != null) { encl++; if (encl >= 12) found = { tick: i, pos: [P.pos.x, P.pos.y - 0.8, P.pos.z].map(v => +v.toFixed(2)), state: P.state, solid: ph.raycast(new V(P.pos.x, P.pos.y + 0.2, P.pos.z), new V(1, 0, 0), 25).distance < 0.01, log: log.slice() }; }
            else encl = 0;
          }
        }
        if (found) out.push({ prefab: pf.id, p: pf.p, s: pf.s, ...found });
      }
    }
    return { out, unstuck };
  }, { prefabs: map.prefabs, ticks, SEED: parseInt(process.argv[4] || '12345') });
  console.log(JSON.stringify(res.out, null, 0).replace(/\},\{/g, '},\n{'));
  console.log(JSON.stringify(res.unstuck, null, 0).replace(/\},\{/g, '},\n{'));
  console.log('stuck (not rescued) cases', res.out.length, 'unstuck rescues', res.unstuck.length);
  await browser.close();
})();

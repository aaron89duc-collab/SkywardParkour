const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8765/devtools/viewer.html');
  await page.waitForFunction(() => window.ready);
  const r = await page.evaluate(async () => {
    const THREE = window.THREE;
    const g = await loadGLB('/public/assets/characters/hero-male.glb');
    const out = {};
    for (const clip of g.animations) {
      const tr = clip.tracks.find(t => /Hips\.quaternion$/.test(t.name));
      const it = tr.createInterpolant();
      const yaws = [];
      for (let i = 0; i <= 8; i++) {
        const t = clip.duration * i / 8;
        const v = it.evaluate(t); const q = new THREE.Quaternion(v[0], v[1], v[2], v[3]);
        const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        yaws.push(Math.round(Math.atan2(f.x, f.z) * 180 / Math.PI));
      }
      out[clip.name] = yaws.join(' ');
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();

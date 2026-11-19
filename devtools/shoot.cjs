const OUT = require('path').join(__dirname, 'out', 'shots'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const mode = process.argv[2];
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type()==='error') console.log('ERR', m.text()); });
  await page.goto('http://localhost:8765/devtools/viewer.html');
  await page.waitForFunction(() => window.ready);
  const sharp = require('sharp');
  async function sheet(imgs, out, cols) {
    const bufs = imgs.map(d => Buffer.from(d.split(',')[1], 'base64'));
    const rows = Math.ceil(bufs.length / cols);
    const comp = bufs.map((b, i) => ({ input: b, left: (i % cols) * 400, top: Math.floor(i / cols) * 400 }));
    await sharp({ create: { width: cols * 400, height: rows * 400, channels: 3, background: '#000' } }).composite(comp).png().toFile(out);
  }
  fs.mkdirSync(OUT, { recursive: true });
  if (mode === 'props') {
    for (const f of process.argv.slice(3)) {
      const r = await page.evaluate(([u]) => renderViews(u, [[0,10],[90,10],[180,10],[0,80]]), ['/public/assets/map001/' + f + '.glb']);
      console.log(f, JSON.stringify(r.box));
      await sheet(r.imgs, `${OUT}/prop_${f}.png`, 4);
    }
  } else if (mode === 'anim') {
    const [, , , file, clip, n, az] = process.argv;
    const dur = await page.evaluate(async ([u, c]) => { const g = await loadGLB(u); return g.animations.find(a => a.name === c).duration; }, [file, clip]);
    const N = parseInt(n || '8'); const times = [...Array(N)].map((_, i) => dur * i / (N - 1));
    const r = await page.evaluate(([u, c, t, a]) => renderAnim(u, c, t, a), [file, clip, times, parseFloat(az || '30')]);
    console.log(clip, 'dur', r.dur.toFixed(2), 'hips', JSON.stringify(r.hips));
    if (process.argv[9] === 'bones') console.log(r.bones.join(','));
    await sheet(r.imgs, `${OUT}/anim_${clip}.png`, Math.min(N, 6));
  }
  await browser.close();
})();

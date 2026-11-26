// Records the sound of every map offline (music bed, ambience, wind, a few footsteps, a jump and a landing)
// into one mp3 for listening: devtools/out/soundtour.mp3 (needs ffmpeg).
//   node devtools/out/soundtour.cjs [seconds per map]
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const SEC = parseFloat(process.argv[2] || '10');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 240000 });
  const maps = ['map001', 'map002', 'map003', 'map004', 'map005', 'map006', 'map007'];
  const dir = '/tmp/soundtour';
  fs.mkdirSync(dir, { recursive: true });
  for (const id of maps) {
    const b64 = await page.evaluate(async ({ id, SEC }) => {
      const g = window.__game, SR = 22050;
      g.renderer.setAnimationLoop(null);
      const A = new g.audio.constructor();
      const off = new OfflineAudioContext(1, Math.round(SR * SEC), SR);
      A.init(off);
      A.setVolume(0.8);
      A.setMap(id);
      A.mus.gain.cancelScheduledValues(0); A.mus.gain.value = 0.6 * 1.2; A.nextNote = 0.05;
      const height = { map001: 60, map002: 200, map003: 400, map004: 600, map005: 800, map006: 1000, map007: 1200 }[id];
      const Q = 1024 / SR;
      let k = 0, lastStep = 0;
      for (let t = Q; t < SEC - 0.1; t += Q) {
        const tt = t;
        off.suspend(tt).then(() => {
          A.update(Q, height, 0, tt);
          // a short run, a jump and a landing in the middle of the clip
          if (tt > SEC * 0.4 && tt < SEC * 0.6 && tt - lastStep > 0.33) { lastStep = tt; A.step(true); }
          if (Math.abs(tt - SEC * 0.62) < Q / 2) A.jump();
          if (Math.abs(tt - SEC * 0.7) < Q / 2) A.land(0.4);
          off.resume();
        });
        k++;
      }
      const buf = await off.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0;
      for (const v of d) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      // 16-bit WAV
      const n = d.length, ab = new ArrayBuffer(44 + n * 2), dv = new DataView(ab);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
      let s = ''; const u8 = new Uint8Array(ab);
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { wav: btoa(s), peak, rms: Math.sqrt(sum / n) };
    }, { id, SEC });
    fs.writeFileSync(`${dir}/${id}.wav`, Buffer.from(b64.wav, 'base64'));
    console.log(id, 'peak', b64.peak.toFixed(2), 'rms', b64.rms.toFixed(3));
  }
  await browser.close();
  fs.writeFileSync(`${dir}/list.txt`, maps.map((m) => `file '${m}.wav'`).join('\n'));
  execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i ${dir}/list.txt -af "afade=t=in:d=0.3" -b:a 96k ${__dirname}/soundtour.mp3`);
  console.log('wrote devtools/out/soundtour.mp3');
})();

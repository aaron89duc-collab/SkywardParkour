// App icons for Android AND the web, from one picture: devtools/icon/skyward-icon-master.png
// (square, any size ≥ 1024, rounded corners may be transparent). Run: node devtools/android-icons.mjs
//
// web  (public/):  icon-192/512.png        the picture as drawn (rounded corners)       manifest "any", favicon
//                  icon-maskable-192/512   full square, picture at 84 % (safe zone)     manifest "maskable" (Android Chrome)
//                  apple-touch-icon.png    180 px full square, no transparency          iPhone / iPad home screen
//                  favicon-32.png          browser tab
// android (android/app/src/main/res/):     legacy ic_launcher (rounded picture), ic_launcher_round (circle),
//                  adaptive ic_launcher_foreground (108 dp layer, picture over the 72 dp visible part), splash screens
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const MASTER = 'devtools/icon/skyward-icon-master.png';
const PUB = 'public';
const RES = 'android/app/src/main/res';

// ---- 1. full-bleed square: fill the transparent corners by growing the edge colours inwards, then smooth them
const { data: src, info } = await sharp(MASTER).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const N = info.width;
if (info.height !== N) throw new Error('the master icon must be square');
const fill = Buffer.from(src);
const known = new Uint8Array(N * N);
for (let i = 0; i < N * N; i++) known[i] = src[i * 4 + 3] >= 250 ? 1 : 0;
let frontier = [];
for (let i = 0; i < N * N; i++) if (!known[i]) frontier.push(i);
while (frontier.length) {
  const next = [], set = [];
  for (const i of frontier) {
    const x = i % N, y = (i / N) | 0;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < N && yy < N && known[yy * N + xx]) {
        const j = (yy * N + xx) * 4; r += fill[j]; g += fill[j + 1]; b += fill[j + 2]; n++;
      }
    }
    if (n) set.push([i, r / n, g / n, b / n]); else next.push(i);
  }
  if (!set.length) break;
  for (const [i, r, g, b] of set) { const j = i * 4; fill[j] = r; fill[j + 1] = g; fill[j + 2] = b; fill[j + 3] = 255; known[i] = 1; }
  frontier = next;
}
for (let i = 0; i < N * N; i++) fill[i * 4 + 3] = 255;
// soften the streaks of the grown corners, then put the original picture (with its soft edge) back on top
const grown = await sharp(fill, { raw: { width: N, height: N, channels: 4 } }).blur(N / 90).png().toBuffer();
const full = await sharp(grown).composite([{ input: MASTER }]).flatten().png().toBuffer();

// ---- 2. extended square: the full-bleed picture in the middle of a wider canvas whose border is a blurred mirror
//         of it, feathered so no frame shows. Picture = 74/108 of the canvas (adaptive icon); crops give the rest.
const E = Math.round((N * 108) / 74), pad = Math.round((E - N) / 2);
const mirror = await sharp(full).extend({ top: pad, bottom: E - N - pad, left: pad, right: E - N - pad, extendWith: 'mirror' })
  .blur(N / 22).png().toBuffer();
const feather = Math.round(N * 0.03);
const fmask = Buffer.from(`<svg width="${N}" height="${N}"><defs><filter id="f"><feGaussianBlur stdDeviation="${feather / 2}"/></filter></defs>` +
  `<rect x="${feather}" y="${feather}" width="${N - 2 * feather}" height="${N - 2 * feather}" fill="#fff" filter="url(#f)"/></svg>`);
const soft = await sharp(full).ensureAlpha().composite([{ input: fmask, blend: 'dest-in' }]).png().toBuffer();
const ext = await sharp(mirror).composite([{ input: soft, left: pad, top: pad }]).flatten().png().toBuffer();
/** a centred square crop of the extended canvas where the picture takes `share` of the width */
const crop = async (share) => {
  const s = Math.min(E, Math.round(N / share)), o = Math.round((E - s) / 2);
  return sharp(ext).extract({ left: o, top: o, width: s, height: s }).png().toBuffer();
};
const circle = (n) => Buffer.from(`<svg width="${n}" height="${n}"><circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="#fff"/></svg>`);
const out = (img, n, file, small = false) => sharp(img).resize(n, n, { kernel: 'lanczos3' })
  .png(small ? { palette: true, quality: 95, effort: 10, dither: 0.7 } : { compressionLevel: 9 }).toFile(file);

// ---- 3. web
// the 512 px web icons are precached by the service worker for every player: palette PNG (~90 KB instead of ~500 KB)
await out(MASTER, 512, `${PUB}/icon-512.png`, true);
await out(MASTER, 192, `${PUB}/icon-192.png`);
await out(MASTER, 32, `${PUB}/favicon-32.png`);
const maskable = await crop(0.84);
await out(maskable, 512, `${PUB}/icon-maskable-512.png`, true);
await out(maskable, 192, `${PUB}/icon-maskable-192.png`);
await sharp(full).resize(180, 180, { kernel: 'lanczos3' }).flatten().png({ compressionLevel: 9 }).toFile(`${PUB}/apple-touch-icon.png`);

// ---- 4. android launcher icons (48 dp legacy, 108 dp adaptive layer)
const round = await crop(0.94);
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = `${RES}/mipmap-${d}`;
  const n = Math.round(48 * k), f = Math.round(108 * k);
  await out(MASTER, n, `${dir}/ic_launcher.png`);
  await sharp(round).resize(n, n, { kernel: 'lanczos3' }).composite([{ input: circle(n), blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher_round.png`);
  await out(ext, f, `${dir}/ic_launcher_foreground.png`);
}
fs.writeFileSync(`${RES}/values/ic_launcher_background.xml`, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1E8CF0</color>\n</resources>\n');

// ---- 5. splash screens: sky gradient with the icon in the middle, same sizes as the template's
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(RES).filter((f) => path.basename(f) === 'splash.png')) {
  const { width: w, height: h } = await sharp(f).metadata();
  const s = Math.round(Math.min(w, h) * 0.42);
  const bg = Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#1e8cf0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const icon = await sharp(MASTER).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer();
  await sharp(bg).composite([{ input: icon, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(f + '.tmp');
  fs.renameSync(f + '.tmp', f);
}
console.log('icons done: web (public/) + android (res/)');

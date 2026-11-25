// Android launcher icons + splash screens from public/icon-512.png (run after `npx cap add android`).
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
const RES = 'android/app/src/main/res';
const SRC = 'public/icon-512.png';
const BLUE = { r: 0x3c, g: 0x84, b: 0xd6, alpha: 1 };
// the icon on a solid sky blue square (its rounded corners filled)
const square = await sharp({ create: { width: 512, height: 512, channels: 4, background: BLUE } }).composite([{ input: SRC }]).png().toBuffer();
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = `${RES}/mipmap-${d}`;
  const n = Math.round(48 * k), f = Math.round(108 * k);
  await sharp(SRC).resize(n, n).png().toFile(`${dir}/ic_launcher.png`);
  const circle = Buffer.from(`<svg width="${n}" height="${n}"><circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}"/></svg>`);
  await sharp(square).resize(n, n).composite([{ input: circle, blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher_round.png`);
  // adaptive icon foreground: the whole picture, full bleed (the launcher's mask cuts the corners)
  await sharp(square).resize(f, f).png().toFile(`${dir}/ic_launcher_foreground.png`);
}
fs.writeFileSync(`${RES}/values/ic_launcher_background.xml`, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#3C84D6</color>\n</resources>\n');
// splash screens: sky gradient with the icon in the middle, same sizes as the template's
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(RES).filter((f) => path.basename(f) === 'splash.png')) {
  const { width: w, height: h } = await sharp(f).metadata();
  const s = Math.round(Math.min(w, h) * 0.42);
  const bg = Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc8ff"/><stop offset="1" stop-color="#3c84d6"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const icon = await sharp(SRC).resize(s, s).png().toBuffer();
  await sharp(bg).composite([{ input: icon, gravity: 'center' }]).png().toFile(f + '.tmp');
  fs.renameSync(f + '.tmp', f);
}
console.log('android icons + splash done');

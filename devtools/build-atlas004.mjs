// Map 004 scenery atlas: the artist's 10 PNGs (E:\game\Parkout\Asset map 4) + a generated soap bubble, trimmed and
// packed into one 2048 WebP billboard atlas (assets/map004/map004_atlas.webp/.json, same format as Map 001's).
//   node devtools/build-atlas004.mjs <png dir>
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = process.argv[2] ?? '/mnt/user-data/uploads/Parkout/Asset map 4';
const OUT = new URL('../packs/map004/assets/map004/', import.meta.url).pathname;
const PAGE = 2048, PAD = 6;
// longest side per item: the big backdrops get more pixels
const MAX = { castle_far: 820, rainbow: 780, candy_island: 720, choco_fall: 680, lollipop_grove: 700, cloud_pink: 600, cloud_mint: 600, cloud_lilac: 600, candy_balloon: 520, flying_candies: 520, bubble: 160 };

// a cartoon soap bubble: opaque rim + highlights, empty middle (the sprite shader alpha-tests at 0.5)
const bubbleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bff6ff"/><stop offset="0.5" stop-color="#ffc6f1"/><stop offset="1" stop-color="#c9b8ff"/></linearGradient></defs>
  <circle cx="128" cy="128" r="112" fill="none" stroke="url(#g)" stroke-width="16"/>
  <path d="M70 92 A70 70 0 0 1 120 52" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/>
  <circle cx="160" cy="176" r="9" fill="#ffffff"/></svg>`;

const items = [];
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.png')).sort();
const srcs = files.map((f) => ({ name: f.replace('.png', ''), input: path.join(SRC, f) }));
srcs.push({ name: 'bubble', input: Buffer.from(bubbleSvg) });
for (const s of srcs) {
  const trimmed = await sharp(s.input).ensureAlpha().trim({ threshold: 2 }).toBuffer({ resolveWithObject: true });
  const { width: w0, height: h0 } = trimmed.info;
  const k = Math.min(1, (MAX[s.name] ?? 400) / Math.max(w0, h0));
  const w = Math.max(4, Math.round(w0 * k)), h = Math.max(4, Math.round(h0 * k));
  const buf = await sharp(trimmed.data).resize(w, h).png().toBuffer();
  items.push({ name: s.name, w, h, buf });
}
items.sort((a, b) => b.h - a.h);
let x = PAD, y = PAD, rowH = 0;
const comps = [], rects = {};
for (const it of items) {
  if (x + it.w + PAD > PAGE) { x = PAD; y += rowH + PAD; rowH = 0; }
  if (y + it.h + PAD > PAGE) throw new Error('atlas overflow');
  comps.push({ input: it.buf, left: x, top: y });
  rects[it.name] = { id: it.name, cat: 'map004', u0: x / PAGE, v0: 1 - (y + it.h) / PAGE, u1: (x + it.w) / PAGE, v1: 1 - y / PAGE, aspect: +(it.w / it.h).toFixed(4) };
  x += it.w + PAD; rowH = Math.max(rowH, it.h);
}
console.log('atlas used height', y + rowH + PAD, 'items', items.length);
await sharp({ create: { width: PAGE, height: PAGE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(comps).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(OUT, 'map004_atlas.webp'));
fs.writeFileSync(path.join(OUT, 'map004_atlas.json'), JSON.stringify(rects));
console.log(Object.entries(rects).map(([k, r]) => `${k} ${r.aspect}`).join(' · '));

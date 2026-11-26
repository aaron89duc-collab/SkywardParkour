// Map 005 scenery atlas: the artist's 15 PNGs (E:\game\Parkout\Asset map 5, renamed to the doc's names in
// devtools/out/png5), trimmed and packed into one 2048 WebP billboard atlas (assets/map005/map005_atlas.webp/.json).
//   node devtools/build-atlas005.mjs [png dir]
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = process.argv[2] ?? new URL('./out/png5', import.meta.url).pathname;
const OUT = new URL('../packs/map005/assets/map005/', import.meta.url).pathname;
const PAGE = 2048, PAD = 6;
// longest side per item: the big backdrops get more pixels
const MAX = { toy_city_far: 860, train_viaduct_far: 860, teddy_island_far: 640, toy_island_far: 600, ferris_wheel_far: 560, ring_stacker_far: 560, mushroom_island_far: 640, blocks_pile: 440, cloud_white_a: 520, cloud_white_b: 380, balloon_bunch: 300, toy_plane: 520, paper_plane: 300, kite: 360, toy_blimp: 460 };

// a cartoon soap bubble: opaque rim + highlights, empty middle (the sprite shader alpha-tests at 0.5)
const bubbleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bff6ff"/><stop offset="0.5" stop-color="#ffc6f1"/><stop offset="1" stop-color="#c9b8ff"/></linearGradient></defs>
  <circle cx="128" cy="128" r="112" fill="none" stroke="url(#g)" stroke-width="16"/>
  <path d="M70 92 A70 70 0 0 1 120 52" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/>
  <circle cx="160" cy="176" r="9" fill="#ffffff"/></svg>`;

const items = [];
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.png')).sort();
const srcs = files.map((f) => ({ name: f.replace('.png', ''), input: path.join(SRC, f) }));
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
  rects[it.name] = { id: it.name, cat: 'map005', u0: x / PAGE, v0: 1 - (y + it.h) / PAGE, u1: (x + it.w) / PAGE, v1: 1 - y / PAGE, aspect: +(it.w / it.h).toFixed(4) };
  x += it.w + PAD; rowH = Math.max(rowH, it.h);
}
console.log('atlas used height', y + rowH + PAD, 'items', items.length);
await sharp({ create: { width: PAGE, height: PAGE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(comps).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(OUT, 'map005_atlas.webp'));
fs.writeFileSync(path.join(OUT, 'map005_atlas.json'), JSON.stringify(rects));
console.log(Object.entries(rects).map(([k, r]) => `${k} ${r.aspect}`).join(' · '));

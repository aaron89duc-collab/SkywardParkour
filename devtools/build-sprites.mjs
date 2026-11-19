// Packs the Map 001 PNG source-art pack into one billboard atlas (trimmed, WebP with alpha).
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
const SRC = process.argv[2];
const OUT = process.argv[3];
const MAX = 236, PAGE = 2048, PAD = 6;
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const items = [];
for (const m of manifest) {
  const file = path.join(SRC, m.file);
  const img = sharp(file).ensureAlpha();
  const trimmed = await img.trim({ threshold: 2 }).toBuffer({ resolveWithObject: true });
  const { width: w0, height: h0 } = trimmed.info;
  const s = Math.min(1, MAX / Math.max(w0, h0));
  const w = Math.max(4, Math.round(w0 * s)), h = Math.max(4, Math.round(h0 * s));
  const buf = await sharp(trimmed.data).resize(w, h).png().toBuffer();
  items.push({ name: m.name, id: m.id, category: m.category, w, h, buf });
}
items.sort((a, b) => b.h - a.h);
let x = PAD, y = PAD, rowH = 0;
const comps = [], rects = {};
for (const it of items) {
  if (x + it.w + PAD > PAGE) { x = PAD; y += rowH + PAD; rowH = 0; }
  if (y + it.h + PAD > PAGE) throw new Error('atlas overflow');
  comps.push({ input: it.buf, left: x, top: y });
  rects[it.name] = { id: it.id, cat: it.category, u0: x / PAGE, v0: 1 - (y + it.h) / PAGE, u1: (x + it.w) / PAGE, v1: 1 - y / PAGE, aspect: +(it.w / it.h).toFixed(4) };
  x += it.w + PAD; rowH = Math.max(rowH, it.h);
}
const usedH = y + rowH + PAD;
console.log('atlas used height', usedH, 'items', items.length);
await sharp({ create: { width: PAGE, height: PAGE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(comps).webp({ quality: 88, alphaQuality: 90 }).toFile(path.join(OUT, 'map001_atlas.webp'));
fs.writeFileSync(path.join(OUT, 'map001_atlas.json'), JSON.stringify(rects));

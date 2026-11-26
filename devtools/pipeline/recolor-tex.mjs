// Colour variant of a textured raw model (before prefab.mjs): every base-colour texture repainted in one colour, its
// light and shade kept (the texture's brightness, relative to its mean, times the target colour).
// Usage: node devtools/pipeline/recolor-tex.mjs <in.glb> <out.glb> <#rrggbb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
const [, , input, output, hex] = process.argv;
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const tgt = [1, 3, 5].map((i) => parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16));
let n = 0;
for (const m of doc.getRoot().listMaterials()) {
  const t = m.getBaseColorTexture();
  if (!t) continue;
  const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, cnt = 0;
  for (let i = 0; i < data.length; i += 4) { sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; cnt++; }
  const mean = sum / cnt;
  for (let i = 0; i < data.length; i += 4) {
    const k = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / mean;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(tgt[c] * k)));
  }
  const img = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  t.setImage(new Uint8Array(img)).setMimeType('image/png');
  n++;
}
await io.write(output, doc);
console.log(`recoloured ${n} textures ${hex} -> ${output}`);

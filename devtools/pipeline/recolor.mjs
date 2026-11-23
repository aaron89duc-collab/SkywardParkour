// Colour variants of a vertex-coloured prefab: every strongly blue vertex gets the target hue (shading kept).
// Usage: node devtools/pipeline/recolor.mjs <in.glb> <out.glb> <hueDeg> [valueMul=1] [satMul=1]
//   SHIFT=1: rotate the hue of EVERY coloured vertex by hueDeg instead (candy colour variants of any model)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';
const [, , input, output, hueS, vmulS = '1', smulS = '1'] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const hue = +hueS / 360, vmul = +vmulS, smul = +smulS;
const toS = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055), toL = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function rgb2hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-6) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return [h, mx > 0 ? d / mx : 0, mx]; }
function hsv2rgb(h, s, v) { const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6]; }
const done = new Set();
let n = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const C = prim.getAttribute('COLOR_0');
  if (!C || done.has(C)) continue;
  done.add(C);
  const e = [0, 0, 0, 1];
  for (let i = 0; i < C.getCount(); i++) {
    C.getElement(i, e);
    const [h, s, v] = rgb2hsv(toS(e[0]), toS(e[1]), toS(e[2]));
    if (process.env.SHIFT ? s > 0.18 : h > 0.52 && h < 0.73 && s > 0.35) {
      const [r, g, b] = hsv2rgb(process.env.SHIFT ? (h + hue) % 1 : hue, Math.min(1, s * smul), Math.min(1, v * vmul));
      e[0] = toL(r); e[1] = toL(g); e[2] = toL(b);
      C.setElement(i, e);
      n++;
    }
  }
}
await doc.transform(reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(output, doc);
for (const ext of ['.col.bin', '.info.json']) fs.copyFileSync(input.replace(/\.glb$/, ext), output.replace(/\.glb$/, ext));
console.log('recoloured', n, 'vertices ->', output);

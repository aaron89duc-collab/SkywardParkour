// Asset pipeline (Node). Usage:
//   node devtools/pipeline/prefab.mjs <Meshy_AI_model.glb> public/assets/map001 <name> [baseTex=1024] [colTris=1800]
//   node devtools/pipeline/character.mjs <hero.glb> public/assets/characters/hero-male.glb char 2048
// Needs: npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, resample, textureCompress, meshopt, reorder, quantize, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [,, input, output, mode='prop', baseSize='1024'] = process.argv;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const bs = parseInt(baseSize);
const ops = [dedup(), prune(), weld()];
if (mode === 'char') ops.push(resample());
if (mode === 'prop-lod') ops.push(simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.002 }));
ops.push(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [bs, bs], slots: /^baseColor/, quality: 85 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [bs/2|0, bs/2|0], slots: /^normal/, quality: 85 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], slots: /^metallicRoughness/, quality: 80 }),
  reorder({ encoder: MeshoptEncoder }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await doc.transform(...ops);
// stylized: soften metallic/roughness, single-sided for props
for (const m of doc.getRoot().listMaterials()) {
  m.setMetallicFactor(mode === 'char' ? 0.0 : 0.0);
  m.setRoughnessFactor(1.0);
  if (mode !== 'char') m.setDoubleSided(false);
}
await io.write(output, doc);

// Rotate a raw model before import (a part modelled standing up that must lie flat, e.g. Map 004's chocolate river).
// Usage: node devtools/pipeline/rotate.mjs <in.glb> <out.glb> <axis x|y|z> <degrees>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
const [, , input, output, axis, degS] = process.argv;
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const h = ((+degS * Math.PI) / 180) / 2, s = Math.sin(h);
const q = [axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(h)];
for (const scene of doc.getRoot().listScenes()) {
  const root = doc.createNode('rot').setRotation(q);
  for (const n of scene.listChildren()) { scene.removeChild(n); root.addChild(n); }
  scene.addChild(root);
}
await io.write(output, doc);
console.log('rotated', input, axis, degS);

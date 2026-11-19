import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const dir = process.argv[2];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.glb'))) {
  const doc = await io.read(dir + '/' + f);
  const out = [];
  for (const m of doc.getRoot().listMeshes()) {
    let t = 0; for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
    out.push(m.getName() + ':' + t);
  }
  const tex = doc.getRoot().listTextures().map(t => { const s = t.getSize(); return s ? s.join('x') : '?'; });
  console.log(f.padEnd(28), out.join(' '), 'tex', tex.join(','), (fs.statSync(dir + '/' + f).size / 1024).toFixed(0) + 'KB');
}

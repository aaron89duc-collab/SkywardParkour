// List connected components (welded by position) of a normalized prefab GLB with their bounding boxes.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION'), I = prim.getIndices();
const n = P.getCount(); const v = [0, 0, 0]; const pos = new Float32Array(n * 3);
for (let i = 0; i < n; i++) { P.getElement(i, v); pos.set(v, i * 3); }
const key = (i) => `${Math.round(pos[i*3]*5000)},${Math.round(pos[i*3+1]*5000)},${Math.round(pos[i*3+2]*5000)}`;
const m = new Map(); const rep = new Int32Array(n);
for (let i = 0; i < n; i++) { const k = key(i); if (!m.has(k)) m.set(k, i); rep[i] = m.get(k); }
const par = new Int32Array(n).map((_, i) => i);
const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
const idx = I.getArray();
for (let t = 0; t < idx.length; t += 3) { const a = find(rep[idx[t]]), b = find(rep[idx[t+1]]), c = find(rep[idx[t+2]]); par[b] = a; par[find(c)] = a; }
const comps = new Map();
for (let t = 0; t < idx.length; t += 3) {
  const r = find(rep[idx[t]]);
  let c = comps.get(r); if (!c) comps.set(r, c = { tris: 0, min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] });
  c.tris++;
  for (let e = 0; e < 3; e++) { const i = idx[t+e]; for (let k = 0; k < 3; k++) { c.min[k] = Math.min(c.min[k], pos[i*3+k]); c.max[k] = Math.max(c.max[k], pos[i*3+k]); } }
}
const list = [...comps.values()].sort((a, b) => b.tris - a.tris);
for (const c of list.slice(0, 30)) console.log(String(c.tris).padStart(6), 'min', c.min.map(x => x.toFixed(3)).join(','), 'max', c.max.map(x => x.toFixed(3)).join(','));
console.log('components', list.length);

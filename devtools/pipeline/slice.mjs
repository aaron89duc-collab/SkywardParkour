// Print an occupancy map (x-y side view or x-z top view) of a prefab's triangles, in normalized units, applying node transforms.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const view = process.argv[3] || 'xy';
const node = doc.getRoot().listNodes().find(n => n.getMesh() && n.getName() !== 'lod1');
const M = node.getWorldMatrix();
const prim = node.getMesh().listPrimitives()[0];
const P = prim.getAttribute('POSITION'), I = prim.getIndices().getArray();
const v = [0, 0, 0];
const W = 60, H = 40;
const grid = Array.from({ length: H }, () => new Array(W).fill(0));
const pts = [];
for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); const x = M[0]*v[0]+M[4]*v[1]+M[8]*v[2]+M[12], y = M[1]*v[0]+M[5]*v[1]+M[9]*v[2]+M[13], z = M[2]*v[0]+M[6]*v[1]+M[10]*v[2]+M[14]; pts.push([x, y, z]); }
let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
const ax = view === 'xy' ? [0, 1] : view === 'zy' ? [2, 1] : [0, 2];
for (const p of pts) {
  const gx = Math.min(W - 1, Math.floor((p[ax[0]] - mn[ax[0]]) / (mx[ax[0]] - mn[ax[0]]) * W));
  const gy = Math.min(H - 1, Math.floor((p[ax[1]] - mn[ax[1]]) / (mx[ax[1]] - mn[ax[1]]) * H));
  grid[gy][gx]++;
}
console.log('bounds', mn.map(x => x.toFixed(3)), mx.map(x => x.toFixed(3)), 'view', view);
for (let r = H - 1; r >= 0; r--) {
  const yv = mn[ax[1]] + (r + 0.5) / H * (mx[ax[1]] - mn[ax[1]]);
  console.log(yv.toFixed(2).padStart(6), grid[r].map(c => c === 0 ? '.' : c < 3 ? ':' : c < 10 ? 'o' : '#').join(''));
}
console.log('       x from', mn[ax[0]].toFixed(2), 'to', mx[ax[0]].toFixed(2));

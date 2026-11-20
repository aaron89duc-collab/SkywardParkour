// Asset pipeline (Node). Usage:
//   node devtools/pipeline/prefab.mjs <Meshy_AI_model.glb> public/assets/map001 <name> [baseTex=1024] [colTris=1800]
//   node devtools/pipeline/character.mjs <hero.glb> public/assets/characters/hero-male.glb char 2048
// Needs: npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// Normalize Meshy prop: bottom at y=0, centered XZ, height = 1. Export optimized visual GLB + simplified collision mesh (.col.bin) + top heightmap.
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt, reorder, center, transformMesh, flatten, dequantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
const [,, input, outDir, name, baseSize='1024', colTris='1800'] = process.argv;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
// quantized exports (KHR_mesh_quantization: int16 positions, int8 normals) must be float before any transform is baked in
await doc.transform(dequantize(), flatten(), center({ pivot: 'below' }));
const scene = doc.getRoot().listScenes()[0];
let b = getBounds(scene);
const h = b.max[1] - b.min[1];
const s = 1 / h;
// bake node transforms + scale into mesh
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix().slice();
  for (let i = 0; i < 12; i++) m[i] *= s; // scale rows (column-major: scale first 3 columns)
  m[12] *= s; m[13] *= s; m[14] *= s;
  transformMesh(mesh, m);
  node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
  // reparent to scene root
  const parent = node.getParentNode(); if (parent) { parent.removeChild(node); scene.addChild(node); }
}
b = getBounds(scene);
// optional: cut away triangles whose centroid lies in a box (normalised coords), e.g. CUT="-0.56,-0.31,0.38,0.775,-0.2,0.2"
// (several boxes separated by ';')
// KEEP="box;box" does the opposite: keeps only the triangles inside the boxes (cut a moving part out of a model)
if (process.env.CUT || process.env.KEEP) {
  // several boxes: "box1;box2"
  const keepMode = !!process.env.KEEP;
  const boxes = (process.env.KEEP || process.env.CUT).split(';').map((b) => b.split(',').map(Number));
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), I = prim.getIndices();
    const a = [0, 0, 0], bb = [0, 0, 0], c = [0, 0, 0];
    const keep = [];
    let cut = 0;
    for (let t = 0; t < I.getCount(); t += 3) {
      const i0 = I.getScalar(t), i1 = I.getScalar(t + 1), i2 = I.getScalar(t + 2);
      P.getElement(i0, a); P.getElement(i1, bb); P.getElement(i2, c);
      const cx = (a[0] + bb[0] + c[0]) / 3, cy = (a[1] + bb[1] + c[1]) / 3, cz = (a[2] + bb[2] + c[2]) / 3;
      // a triangle taller than the box (a long post running through it) is never "inside"
      const ty = Math.max(a[1], bb[1], c[1]) - Math.min(a[1], bb[1], c[1]);
      const inBox = boxes.some(([x0, x1, y0, y1, z0, z1]) => cx > x0 && cx < x1 && cy > y0 && cy < y1 && cz > z0 && cz < z1 && ty <= y1 - y0);
      if (inBox !== keepMode) { cut++; continue; }
      keep.push(i0, i1, i2);
    }
    const arr = P.getCount() > 65535 ? new Uint32Array(keep) : new Uint16Array(keep);
    I.setArray(arr);
    console.log('  cut', cut, 'triangles');
  }
}
// --- collision mesh
const pos = [], idx = [];
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const P = p.getAttribute('POSITION'); const I = p.getIndices(); const base = pos.length / 3;
  const v = [0,0,0];
  for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); pos.push(v[0], v[1], v[2]); }
  if (I) for (let i = 0; i < I.getCount(); i++) idx.push(I.getScalar(i) + base); else for (let i = 0; i < P.getCount(); i++) idx.push(i + base);
}
// weld by position (UV seams)
const key = (i) => `${Math.round(pos[i*3]*2000)},${Math.round(pos[i*3+1]*2000)},${Math.round(pos[i*3+2]*2000)}`;
const map = new Map(), wpos = [], remap = [];
for (let i = 0; i < pos.length/3; i++) { const k = key(i); let j = map.get(k); if (j === undefined) { j = wpos.length/3; map.set(k, j); wpos.push(pos[i*3], pos[i*3+1], pos[i*3+2]); } remap.push(j); }
let widx = new Uint32Array(idx.map(i => remap[i]));
const wposF = new Float32Array(wpos);
const target = Math.min(widx.length, parseInt(colTris) * 3);
const [simp, err] = MeshoptSimplifier.simplify(widx, wposF, 3, target, 0.02, []);
// compact vertices
const used = new Map(); const cpos = []; const cidx = [];
for (const i of simp) { let j = used.get(i); if (j === undefined) { j = cpos.length/3; used.set(i, j); cpos.push(wposF[i*3], wposF[i*3+1], wposF[i*3+2]); } cidx.push(j); }
const nv = cpos.length/3, ni = cidx.length;
const buf = Buffer.alloc(8 + nv*12 + ni*4);
buf.writeUInt32LE(nv, 0); buf.writeUInt32LE(ni, 4);
for (let i = 0; i < cpos.length; i++) buf.writeFloatLE(cpos[i], 8 + i*4);
for (let i = 0; i < ni; i++) buf.writeUInt32LE(cidx[i], 8 + nv*12 + i*4);
fs.writeFileSync(`${outDir}/${name}.col.bin`, buf);
// --- heightmap (top Y) by rasterizing collision triangles on a grid
const G = 20; const minx=b.min[0], maxx=b.max[0], minz=b.min[2], maxz=b.max[2];
const top = Array.from({length:G}, () => new Array(G).fill(-1));
for (let t = 0; t < ni; t += 3) {
  const a = cidx[t]*3, bb = cidx[t+1]*3, c = cidx[t+2]*3;
  const ax=cpos[a],ay=cpos[a+1],az=cpos[a+2],bx=cpos[bb],by=cpos[bb+1],bz=cpos[bb+2],cx=cpos[c],cy=cpos[c+1],cz=cpos[c+2];
  const d = (bz-cz)*(ax-cx)+(cx-bx)*(az-cz); if (Math.abs(d) < 1e-12) continue;
  for (let gx = 0; gx < G; gx++) for (let gz = 0; gz < G; gz++) {
    const px = minx + (gx+0.5)/G*(maxx-minx), pz = minz + (gz+0.5)/G*(maxz-minz);
    const l1 = ((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/d, l2 = ((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/d, l3 = 1-l1-l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const y = l1*ay + l2*by + l3*cy; if (y > top[gz][gx]) top[gz][gx] = y;
  }
}
// --- visual optimize
await doc.transform(dedup(), prune(), weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+baseSize, +baseSize], slots: /^baseColor/, quality: 85 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+baseSize/2, +baseSize/2], slots: /^normal/, quality: 85 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], slots: /^metallicRoughness/, quality: 80 }),
  );
// --- LOD1: simplified index buffer sharing the same vertex attributes
{
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const P = prim.getAttribute('POSITION');
  const I = prim.getIndices();
  const posArr = new Float32Array(P.getCount() * 3);
  const tmpv = [0,0,0];
  for (let i = 0; i < P.getCount(); i++) { P.getElement(i, tmpv); posArr.set(tmpv, i*3); }
  const idxArr = new Uint32Array(I.getCount()); for (let i = 0; i < idxArr.length; i++) idxArr[i] = I.getScalar(i);
  const [lodIdx] = MeshoptSimplifier.simplify(idxArr, posArr, 3, Math.floor(idxArr.length * 0.2 / 3) * 3, 0.03, ['Permissive', 'Prune']);
  const lodPrim = prim.clone();
  const acc = doc.createAccessor('lod1_indices').setType('SCALAR').setArray(P.getCount() > 65535 ? new Uint32Array(lodIdx) : new Uint16Array(lodIdx)).setBuffer(I.getBuffer());
  lodPrim.setIndices(acc);
  // LOD1 is drawn with per-vertex colours sampled from the base colour texture (UV seams collapse at this LOD)
  {
    const tex = prim.getMaterial().getBaseColorTexture();
    const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(256, 256).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const UV = prim.getAttribute('TEXCOORD_0');
    // quantized exports keep UVs as integers + KHR_texture_transform (scale / offset): apply it before sampling
    const tt = prim.getMaterial().getBaseColorTextureInfo()?.getExtension('KHR_texture_transform');
    const tsc = tt ? tt.getScale() : [1, 1], tof = tt ? tt.getOffset() : [0, 0];
    const n = P.getCount();
    const col = new Float32Array(n * 4);
    const tuv = [0, 0];
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    for (let i = 0; i < n; i++) {
      UV.getElement(i, tuv);
      tuv[0] = tuv[0] * tsc[0] + tof[0]; tuv[1] = tuv[1] * tsc[1] + tof[1];
      const x = Math.min(info.width - 1, Math.max(0, Math.floor((tuv[0] - Math.floor(tuv[0])) * info.width)));
      const y = Math.min(info.height - 1, Math.max(0, Math.floor((tuv[1] - Math.floor(tuv[1])) * info.height)));
      const k = (y * info.width + x) * 3;
      col.set([lin(data[k]), lin(data[k + 1]), lin(data[k + 2]), 1], i * 4);
    }
    const colAcc = doc.createAccessor('lod1_color').setType('VEC4').setArray(col).setBuffer(I.getBuffer());
    lodPrim.setAttribute('COLOR_0', colAcc);
    const lodMat = doc.createMaterial('lod1_mat').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0);
    lodPrim.setMaterial(lodMat);
  }
  const lodMesh = doc.createMesh('lod1').addPrimitive(lodPrim);
  const lodNode = doc.createNode('lod1').setMesh(lodMesh);
  doc.getRoot().listScenes()[0].addChild(lodNode);
  console.log('  lod1 tris', lodIdx.length/3, 'of', idxArr.length/3);
}
await doc.transform(reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
for (const m of doc.getRoot().listMaterials()) { m.setMetallicFactor(0); m.setRoughnessFactor(1); m.setDoubleSided(false); }
await io.write(`${outDir}/${name}.glb`, doc);
const info = { name, size: [+(maxx-minx).toFixed(3), 1, +(maxz-minz).toFixed(3)], min: b.min.map(v=>+v.toFixed(3)), max: b.max.map(v=>+v.toFixed(3)), colTris: ni/3, simpErr: +err.toFixed(4),
  top: top.map(r => r.map(v => v < 0 ? '  .' : String(Math.round(v*100)).padStart(3)).join('')) };
fs.writeFileSync(`${outDir}/${name}.info.json`, JSON.stringify(info, null, 1));
console.log(name, 'size', info.size, 'colTris', info.colTris, 'err', info.simpErr);

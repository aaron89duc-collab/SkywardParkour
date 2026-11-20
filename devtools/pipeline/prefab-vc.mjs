// Asset pipeline for multi-part models (many meshes / materials / textures, e.g. "model-rough" exports).
// Bakes every material into per-vertex colour, merges everything into ONE mesh with ONE material (what the prefab
// system draws), simplifies it with colour-aware simplification, then writes the same outputs as prefab.mjs:
// normalised GLB (base y=0, centred, height 1) + lod1, collision mesh (.col.bin) and info.json (top heightmap).
// Usage: node devtools/pipeline/prefab-vc.mjs <in.glb> <outDir> <name> [targetTris=30000] [colTris=1800]
//   env CUT="x0,x1,y0,y1,z0,z1" drops triangles whose centroid lies in that box (normalised coordinates)
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { center, flatten, meshopt, reorder, prune, dedup, dequantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

const [, , input, outDir, name, targetTris = '30000', colTris = '1800'] = process.argv;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
await doc.transform(dequantize(), flatten(), center({ pivot: 'below' }));
const scene = doc.getRoot().listScenes()[0];
const b0 = getBounds(scene);
const S = 1 / (b0.max[1] - b0.min[1]);

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const texCache = new Map();
async function texData(tex) {
  if (texCache.has(tex)) return texCache.get(tex);
  const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(512, 512, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = { data, w: info.width, h: info.height };
  texCache.set(tex, t);
  return t;
}

// ---- gather every primitive in world space (normalised), with a baked colour per vertex
const P = [], N = [], C = [], I = [];
const v = [0, 0, 0], n3 = [0, 0, 0], uv = [0, 0];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const M = node.getWorldMatrix();
  const xf = (x, y, z) => [(M[0] * x + M[4] * y + M[8] * z + M[12]) * S, (M[1] * x + M[5] * y + M[9] * z + M[13]) * S, (M[2] * x + M[6] * y + M[10] * z + M[14]) * S];
  const xn = (x, y, z) => { const a = [M[0] * x + M[4] * y + M[8] * z, M[1] * x + M[5] * y + M[9] * z, M[2] * x + M[6] * y + M[10] * z]; const l = Math.hypot(...a) || 1; return a.map((q) => q / l); };
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const nor = prim.getAttribute('NORMAL'), tc = prim.getAttribute('TEXCOORD_0');
    const mat = prim.getMaterial();
    const fac = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1];
    const tex = mat?.getBaseColorTexture() ?? null;
    const ti = mat?.getBaseColorTextureInfo() ?? null;
    const tt = ti?.getExtension?.('KHR_texture_transform') ?? null;
    const em = mat ? mat.getEmissiveFactor() : [0, 0, 0];
    const emS = mat?.getExtension?.('KHR_materials_emissive_strength')?.getEmissiveStrength?.() ?? 1;
    const glow = Math.max(...em) * Math.min(emS, 3) > 0.05;
    const td = tex && tc ? await texData(tex) : null;
    const base = P.length / 3;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      P.push(...xf(v[0], v[1], v[2]));
      if (nor) { nor.getElement(i, n3); N.push(...xn(n3[0], n3[1], n3[2])); } else N.push(0, 1, 0);
      let r = fac[0], g = fac[1], bb = fac[2];
      if (td) {
        tc.getElement(i, uv);
        let u = uv[0], w = uv[1];
        if (tt) { const sc = tt.getScale(), of = tt.getOffset(); u = u * sc[0] + of[0]; w = w * sc[1] + of[1]; }
        const x = Math.min(td.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * td.w)));
        const y = Math.min(td.h - 1, Math.max(0, Math.floor((w - Math.floor(w)) * td.h)));
        const k = (y * td.w + x) * 3;
        r *= lin(td.data[k] / 255); g *= lin(td.data[k + 1] / 255); bb *= lin(td.data[k + 2] / 255);
      }
      // self-lit parts (lamps, light strips): keep them bright in the baked colour
      if (glow) { r = Math.max(r, em[0]); g = Math.max(g, em[1]); bb = Math.max(bb, em[2]); }
      C.push(r, g, bb);
    }
    const idx = prim.getIndices();
    if (idx) for (let i = 0; i < idx.getCount(); i++) I.push(idx.getScalar(i) + base);
    else for (let i = 0; i < pos.getCount(); i++) I.push(base + i);
  }
}
console.log(`${name}: ${P.length / 3} verts, ${I.length / 3} tris before`);

// ---- optional cut
let idxAll = I;
if (process.env.CUT) {
  const [x0, x1, y0, y1, z0, z1] = process.env.CUT.split(',').map(Number);
  const keep = [];
  for (let t = 0; t < idxAll.length; t += 3) {
    const a = idxAll[t] * 3, b = idxAll[t + 1] * 3, c = idxAll[t + 2] * 3;
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (cx > x0 && cx < x1 && cy > y0 && cy < y1 && cz > z0 && cz < z1) continue;
    keep.push(idxAll[t], idxAll[t + 1], idxAll[t + 2]);
  }
  console.log('  cut', (idxAll.length - keep.length) / 3, 'triangles');
  idxAll = keep;
}

// ---- weld identical vertices (position + colour), then colour-aware simplification
const key = (i) => `${Math.round(P[i * 3] * 4000)},${Math.round(P[i * 3 + 1] * 4000)},${Math.round(P[i * 3 + 2] * 4000)},${Math.round(C[i * 3] * 60)},${Math.round(C[i * 3 + 1] * 60)},${Math.round(C[i * 3 + 2] * 60)}`;
const wmap = new Map(), wP = [], wN = [], wC = [], remap = new Int32Array(P.length / 3);
for (let i = 0; i < P.length / 3; i++) {
  const k = key(i);
  let j = wmap.get(k);
  if (j === undefined) { j = wP.length / 3; wmap.set(k, j); wP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); wN.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); wC.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]); }
  remap[i] = j;
}
const wI = new Uint32Array(idxAll.map((i) => remap[i]));
const fP = new Float32Array(wP), fC = new Float32Array(wC);
const target = Math.min(wI.length, parseInt(targetTris) * 3);
let sI = wI;
if (target < wI.length) {
  const [r, err] = MeshoptSimplifier.simplifyWithAttributes(wI, fP, 3, fC, 3, [0.6, 0.6, 0.6], null, Math.floor(target / 3) * 3, parseFloat(process.env.ERR || '0.01'), []);
  console.log(`  simplified to ${r.length / 3} tris (err ${err.toFixed(4)})`);
  sI = r;
}
// compact
const used = new Map(); const cP = [], cN = [], cC = [], cI = [];
for (const i of sI) { let j = used.get(i); if (j === undefined) { j = cP.length / 3; used.set(i, j); cP.push(fP[i * 3], fP[i * 3 + 1], fP[i * 3 + 2]); cN.push(wN[i * 3], wN[i * 3 + 1], wN[i * 3 + 2]); cC.push(fC[i * 3], fC[i * 3 + 1], fC[i * 3 + 2], 1); } cI.push(j); }
const nv = cP.length / 3;
let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9;
for (let i = 0; i < nv; i++) { minx = Math.min(minx, cP[i * 3]); maxx = Math.max(maxx, cP[i * 3]); miny = Math.min(miny, cP[i * 3 + 1]); maxy = Math.max(maxy, cP[i * 3 + 1]); minz = Math.min(minz, cP[i * 3 + 2]); maxz = Math.max(maxz, cP[i * 3 + 2]); }

// ---- collision mesh (positions only, welded by position, simplified)
{
  const pk = (i) => `${Math.round(cP[i * 3] * 2000)},${Math.round(cP[i * 3 + 1] * 2000)},${Math.round(cP[i * 3 + 2] * 2000)}`;
  const m2 = new Map(), q = [], r = [];
  for (let i = 0; i < nv; i++) { const k = pk(i); let j = m2.get(k); if (j === undefined) { j = q.length / 3; m2.set(k, j); q.push(cP[i * 3], cP[i * 3 + 1], cP[i * 3 + 2]); } r.push(j); }
  const ci = new Uint32Array(cI.map((i) => r[i])), cp = new Float32Array(q);
  const [simp] = MeshoptSimplifier.simplify(ci, cp, 3, Math.min(ci.length, parseInt(colTris) * 3), 0.02, []);
  const u2 = new Map(), op = [], oi = [];
  for (const i of simp) { let j = u2.get(i); if (j === undefined) { j = op.length / 3; u2.set(i, j); op.push(cp[i * 3], cp[i * 3 + 1], cp[i * 3 + 2]); } oi.push(j); }
  const buf = Buffer.alloc(8 + op.length * 4 + oi.length * 4);
  buf.writeUInt32LE(op.length / 3, 0); buf.writeUInt32LE(oi.length, 4);
  for (let i = 0; i < op.length; i++) buf.writeFloatLE(op[i], 8 + i * 4);
  for (let i = 0; i < oi.length; i++) buf.writeUInt32LE(oi[i], 8 + op.length * 4 + i * 4);
  fs.writeFileSync(`${outDir}/${name}.col.bin`, buf);
  // top heightmap
  const G = 20; const top = Array.from({ length: G }, () => new Array(G).fill(-1));
  for (let t = 0; t < oi.length; t += 3) {
    const a = oi[t] * 3, b = oi[t + 1] * 3, c = oi[t + 2] * 3;
    const ax = op[a], ay = op[a + 1], az = op[a + 2], bx = op[b], by = op[b + 1], bz = op[b + 2], cx = op[c], cy = op[c + 1], cz = op[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-12) continue;
    for (let gx = 0; gx < G; gx++) for (let gz = 0; gz < G; gz++) {
      const px = minx + ((gx + 0.5) / G) * (maxx - minx), pz = minz + ((gz + 0.5) / G) * (maxz - minz);
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const y = l1 * ay + l2 * by + l3 * cy; if (y > top[gz][gx]) top[gz][gx] = y;
    }
  }
  const info = { name, size: [+(maxx - minx).toFixed(3), +(maxy - miny).toFixed(3), +(maxz - minz).toFixed(3)], min: [minx, miny, minz].map((q2) => +q2.toFixed(3)), max: [maxx, maxy, maxz].map((q2) => +q2.toFixed(3)), colTris: oi.length / 3, tris: cI.length / 3, vertexColors: true,
    top: top.map((row) => row.map((q2) => (q2 < 0 ? '  .' : String(Math.round(q2 * 100)).padStart(3))).join('')) };
  fs.writeFileSync(`${outDir}/${name}.info.json`, JSON.stringify(info, null, 1));
  console.log(name, 'size', info.size, 'tris', info.tris, 'colTris', info.colTris);
}

// ---- new document: one mesh, one vertex-coloured material, plus lod1 (20 % of the triangles, same vertices)
for (const m of doc.getRoot().listMeshes()) m.dispose();
for (const nd of doc.getRoot().listNodes()) nd.dispose();
for (const t of doc.getRoot().listTextures()) t.dispose();
for (const m of doc.getRoot().listMaterials()) m.dispose();
for (const a of doc.getRoot().listAccessors()) a.dispose();
const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
const mat = doc.createMaterial('vc').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0);
const aP = doc.createAccessor().setType('VEC3').setArray(new Float32Array(cP)).setBuffer(buffer);
const aN = doc.createAccessor().setType('VEC3').setArray(new Float32Array(cN)).setBuffer(buffer);
const aC = doc.createAccessor().setType('VEC4').setArray(new Float32Array(cC)).setBuffer(buffer);
const aI = doc.createAccessor().setType('SCALAR').setArray(nv > 65535 ? new Uint32Array(cI) : new Uint16Array(cI)).setBuffer(buffer);
const prim = doc.createPrimitive().setAttribute('POSITION', aP).setAttribute('NORMAL', aN).setAttribute('COLOR_0', aC).setIndices(aI).setMaterial(mat);
const mesh = doc.createMesh(name).addPrimitive(prim);
const sc = doc.getRoot().listScenes()[0];
sc.addChild(doc.createNode(name).setMesh(mesh));
{
  const [lodIdx] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(cI), new Float32Array(cP), 3, new Float32Array(cC.filter((_, i) => i % 4 !== 3)), 3, [0.4, 0.4, 0.4], null, Math.floor((cI.length * 0.2) / 3) * 3, 0.04, []);
  const lp = doc.createPrimitive().setAttribute('POSITION', aP).setAttribute('NORMAL', aN).setAttribute('COLOR_0', aC)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(nv > 65535 ? new Uint32Array(lodIdx) : new Uint16Array(lodIdx)).setBuffer(buffer))
    .setMaterial(doc.createMaterial('lod1_mat').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0));
  sc.addChild(doc.createNode('lod1').setMesh(doc.createMesh('lod1').addPrimitive(lp)));
  console.log('  lod1 tris', lodIdx.length / 3);
}
await doc.transform(prune(), dedup(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(`${outDir}/${name}.glb`, doc);
console.log('  wrote', `${outDir}/${name}.glb`, (fs.statSync(`${outDir}/${name}.glb`).size / 1024).toFixed(0), 'KB');

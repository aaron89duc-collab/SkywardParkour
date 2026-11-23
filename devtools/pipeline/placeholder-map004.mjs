// Placeholder models for Map 004 (Candy Kingdom): simple candy-coloured shapes with the SAME names, proportions and
// standable tops as the 12 GLBs the artist is making (see the Map 004 doc). The map is built and tested with these;
// when the real files arrive they go through the same pipeline (prefab-vc.mjs) and replace them one for one.
// Usage: node devtools/pipeline/placeholder-map004.mjs <outDir>   (writes <name>.glb raw models, metres)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Document, NodeIO } from '@gltf-transform/core';
import fs from 'fs';

const OUT = process.argv[2] ?? 'devtools/out/raw4';
fs.mkdirSync(OUT, { recursive: true });

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const rgb = (hex) => { const c = new THREE.Color(hex); return [lin(c.r), lin(c.g), lin(c.b), 1]; };

/** parts: [geometry, colour hex, roughness] (geometry already placed in metres, base at y = 0) */
async function write(name, parts) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(name);
  for (const [i, [g0, col, rough]] of parts.entries()) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const n = pos.count;
    const idx = new Uint32Array(n); for (let k = 0; k < n; k++) idx[k] = k;
    const mat = doc.createMaterial(`${name}_${i}`).setBaseColorFactor(rgb(col)).setRoughnessFactor(rough ?? 0.6).setMetallicFactor(0);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.array)).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor.array)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
      .setMaterial(mat);
    scene.addChild(doc.createNode(`${name}_${i}`).setMesh(doc.createMesh(`${name}_${i}`).addPrimitive(prim)));
  }
  await new NodeIO().write(`${OUT}/${name}.glb`, doc);
  console.log('wrote', name);
}

// ---------------------------------------------------------------- helpers (all return geometries in metres)
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const rbox = (w, h, d, r, x = 0, y = 0, z = 0) => new RoundedBoxGeometry(w, h, d, 3, r).translate(x, y + h / 2, z);
const cyl = (rt, rb, h, y = 0, seg = 32, x = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);
const sph = (r, x, y, z, sy = 1) => new THREE.SphereGeometry(r, 16, 12).scale(1, sy, 1).translate(x, y, z);
const tor = (R, t, y, seg = 40) => new THREE.TorusGeometry(R, t, 14, seg).rotateX(Math.PI / 2).translate(0, y, 0);

// 1 cookie_deck: 17 x 0.8 x 28 (long side along X: 28 m on X, 17 m on Z? No: the doc gives width 17 x length 28; the
// long axis lies along X like every long piece, so X = 28, Z = 17)
{
  const parts = [[box(28, 0.62, 17), '#b8783c', 0.9], [rbox(27.7, 0.36, 16.7, 0.12, 0, 0.44, 0), '#e2ad62', 0.85]];
  // scalloped rim: half-buried rounded bumps along the edges (below the top surface)
  for (let x = -13; x <= 13.01; x += 2) for (const z of [-8.2, 8.2]) parts.push([sph(0.45, x, 0.45, z, 0.7), '#c98a47', 0.9]);
  for (let z = -7; z <= 7.01; z += 2) for (const x of [-13.7, 13.7]) parts.push([sph(0.45, x, 0.45, z, 0.7), '#c98a47', 0.9]);
  // chocolate chips on the sides only (the top stays perfectly flat)
  for (let i = 0; i < 18; i++) { const x = -12 + ((i * 7.3) % 24), z = i % 2 ? 8.36 : -8.36; parts.push([box(0.5, 0.25, 0.12, x, 0.2, z), '#4a2a16', 0.7]); }
  await write('cookie_deck', parts);
}
// 2 cupcake: wrapper r1.2 h1.6, frosting r1.5 overhanging, flat top r1.3 at 3.0
{
  const parts = [[cyl(1.2, 1.0, 1.6, 0, 24), '#7cc8f0', 0.7]];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; parts.push([box(0.12, 1.5, 0.1, Math.sin(a) * 1.12, 0.05, Math.cos(a) * 1.12).rotateY(0), '#a9dcf7', 0.7]); }
  parts.push([cyl(1.5, 1.35, 0.55, 1.6), '#ffb3d1', 0.55], [tor(1.2, 0.28, 2.2), '#ffc4dc', 0.55], [cyl(1.3, 1.45, 0.8, 2.2), '#ffd0e3', 0.5]);
  parts.push([sph(0.28, 1.25, 2.05, 0.5), '#e8243c', 0.3]);
  for (let i = 0; i < 10; i++) { const a = i * 2.4; parts.push([box(0.18, 0.06, 0.06, Math.sin(a) * 1.46, 1.9 + (i % 3) * 0.12, Math.cos(a) * 1.46), ['#ffe066', '#7be0c3', '#9f7bff'][i % 3], 0.5]); }
  await write('cupcake', parts);
}
// 3 donut: outer r3.0, height 1.6, flat icing + jam centre
{
  const parts = [[new THREE.TorusGeometry(2.2, 0.8, 16, 48).rotateX(Math.PI / 2).translate(0, 0.8, 0), '#d99a55', 0.8]];
  parts.push([cyl(2.98, 2.98, 0.22, 1.38, 48), '#ff8fc0', 0.45], [cyl(1.45, 1.45, 1.3, 0.1, 32), '#d6283f', 0.35]);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + 0.3; parts.push([cyl(0.22, 0.22, 0.5, 0.95, 10, Math.sin(a) * 2.88, Math.cos(a) * 2.88), '#ff8fc0', 0.45]); }
  for (let i = 0; i < 14; i++) { const a = i * 2.1, r = 1.7 + (i % 4) * 0.3; parts.push([box(0.3, 0.04, 0.08, Math.sin(a) * r, 1.6, Math.cos(a) * r), ['#ffffff', '#7be0c3', '#ffe066', '#7d9bff'][i % 4], 0.5]); }
  await write('donut', parts);
}
// 4 macaron: two shells + cream
{
  await write('macaron', [[cyl(1.5, 1.35, 0.5, 0), '#9de8cf', 0.6], [cyl(1.53, 1.53, 0.12, 0.42, 40), '#86d9bd', 0.8], [cyl(1.3, 1.3, 0.42, 0.52), '#fff4e0', 0.5], [cyl(1.53, 1.53, 0.12, 0.92, 40), '#86d9bd', 0.8], [cyl(1.4, 1.5, 0.46, 1.04), '#9de8cf', 0.6]]);
}
// 5 lollipop: stick 5.5, swirl disc r1.5 x 0.5 on top
{
  const parts = [[cyl(0.175, 0.175, 5.6, 0, 12), '#fbfbf7', 0.4], [cyl(1.5, 1.5, 0.5, 5.5, 48), '#ff5fa2', 0.25]];
  // the swirl: flat coloured rings painted 5 mm above the disc top (the top stays flat)
  for (const [r0, r1, c] of [[1.12, 1.36, '#ffffff'], [0.78, 0.98, '#ffd84d'], [0.44, 0.64, '#ffffff'], [0.0, 0.28, '#7be0c3']]) parts.push([new THREE.RingGeometry(r0, r1, 40).rotateX(-Math.PI / 2).translate(0, 6.005, 0), c, 0.25]);
  parts.push([tor(1.5, 0.08, 5.75, 48), '#ffffff', 0.3]);
  await write('lollipop', parts);
}
// 6 chocolate_bar: 6 x 0.5 x 1 (long axis X), six raised squares on top
{
  const parts = [[box(6, 0.46, 1), '#6a3a1d', 0.5]];
  for (let i = 0; i < 6; i++) parts.push([box(0.92, 0.04, 0.9, -2.5 + i, 0.46, 0), '#7b4423', 0.45]);
  await write('chocolate_bar', parts);
}
// 7 wafer_bridge: 8 x 0.6 x 2, wafer / cream layers
{
  await write('wafer_bridge', [[box(8, 0.18, 2), '#e3b46c', 0.85], [box(7.96, 0.06, 1.96, 0, 0.18), '#fff3dc', 0.6], [box(8, 0.18, 2, 0, 0.24), '#e3b46c', 0.85], [box(7.96, 0.06, 1.96, 0, 0.42), '#ff9fc6', 0.6], [box(8, 0.12, 2, 0, 0.48), '#eabe78', 0.85]]);
}
// 8 jelly_block: rounded 3 x 2 x 3
{
  await write('jelly_block', [[rbox(3, 2, 3, 0.28), '#ff4f7a', 0.12], [rbox(2.2, 0.06, 2.2, 0.03, 0, 1.94, 0), '#ff7b9c', 0.1]]);
}
// 9 gummy_bear: flat bear 2.5 x 0.6 x 2.5 (head towards -Z)
{
  const c = '#ffb02e', h = 0.6;
  await write('gummy_bear', [[cyl(0.85, 0.85, h, 0, 28).scale(1, 1, 1.15).translate(0, 0, 0.25), c, 0.2], [cyl(0.62, 0.62, h, 0, 24, 0, -0.75), c, 0.2],
    [cyl(0.22, 0.22, h, 0, 14, -0.45, -1.1), c, 0.2], [cyl(0.22, 0.22, h, 0, 14, 0.45, -1.1), c, 0.2],
    [cyl(0.3, 0.3, h, 0, 14, -0.95, 0.0), c, 0.2], [cyl(0.3, 0.3, h, 0, 14, 0.95, 0.0), c, 0.2],
    [cyl(0.34, 0.34, h, 0, 14, -0.6, 0.92), c, 0.2], [cyl(0.34, 0.34, h, 0, 14, 0.6, 0.92), c, 0.2]]);
}
// 10 candy_cane: straight striped bar, 5 long (X), diameter 0.3
{
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push([cyl(0.15, 0.15, 0.25, 0, 14).translate(0, -0.125, 0).rotateZ(Math.PI / 2).translate(-2.375 + i * 0.25, 0.15, 0), i % 2 ? '#ffffff' : '#e3263a', 0.3]);
  parts.push([sph(0.15, -2.5, 0.15, 0), '#e3263a', 0.3], [sph(0.15, 2.5, 0.15, 0), '#e3263a', 0.3]);
  await write('candy_cane', parts);
}
// 11 cotton_cloud: 5 x 2 x 4 puffs, flat-ish top r1.5 at 2.0
{
  const parts = [];
  for (const [x, y, z, r, c] of [[0, 0.9, 0, 1.25, '#ffc1e3'], [-1.6, 0.85, 0.3, 0.95, '#f3b5ff'], [1.6, 0.85, -0.2, 0.95, '#ffc1e3'], [0.3, 0.8, 1.3, 0.8, '#e9c4ff'], [-0.4, 0.8, -1.3, 0.8, '#ffd3ea'], [1.2, 0.95, 1.0, 0.7, '#f3b5ff'], [-1.3, 0.9, -1.0, 0.75, '#ffd3ea']])
    parts.push([sph(r, x, y, z, 0.78), c, 0.95]);
  parts.push([cyl(1.5, 1.5, 0.3, 1.7, 32), '#ffd9ee', 0.95]);
  await write('cotton_cloud', parts);
}
// 12 castle_tower: r3 x 12, flat floor at 11.4 with merlons (0.6) and a 1.5 m gap facing +Z
{
  const parts = [[cyl(3.2, 3.4, 0.8, 0, 40), '#f3c6d6', 0.8], [cyl(3, 3, 10.0, 0.8, 40), '#f7a8c4', 0.75], [cyl(3.25, 3.25, 0.35, 4.6, 40), '#fff1f6', 0.6], [cyl(3.3, 3.0, 0.6, 10.8, 40), '#fff1f6', 0.6]];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (i === 0) continue; // the gap (local +Z)
    parts.push([box(1.1, 0.6, 0.45, 0, 11.4, 0).translate(0, 0, 2.9).rotateY(a), '#f7a8c4', 0.75]);
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; parts.push([box(0.8, 1.4, 0.2, 0, 6.6, 3.0).rotateY(a), '#7d5cff', 0.4]); parts.push([box(0.8, 1.2, 0.2, 0, 2.2, 3.0).rotateY(a + 0.5), '#7be0c3', 0.4]); }
  await write('castle_tower', parts);
}

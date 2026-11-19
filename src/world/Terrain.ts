import * as THREE from 'three';
import { Physics } from '../core/Physics';
import { COLLISION } from '../config';
import type { TerrainData, BoundaryGap } from './MapTypes';
import * as T from './Textures';
import * as CT from './CityTextures';

export type Footprint = { x: number; z: number; w: number; d: number; r: number };

/** Invisible ring wall around a plateau (never fall into the void), with optional openings (bridges). */
function boundaryRing(physics: Physics, cx: number, cy: number, cz: number, R: number, top: number, gaps: BoundaryGap[] = []) {
  const segs = 72, wallR = R - 1.2;
  const y0 = cy - 6, y1 = cy + top;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const half = ((2 * Math.PI * wallR) / segs) * 0.6;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    // world angle convention for gaps: atan2(z - cz, x - cx)
    const gap = gaps.find((g) => Math.abs(((a - g.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < g.half);
    const spans: [number, number][] = gap ? [[y0, gap.y0], [gap.y1, y1]] : [[y0, y1]];
    for (const [lo, hi] of spans) {
      if (hi - lo < 0.5) continue;
      const c = new THREE.Vector3(cx + Math.cos(a) * (wallR + 0.5), (lo + hi) / 2, cz + Math.sin(a) * (wallR + 0.5));
      physics.addBox(c, new THREE.Vector3(0.5, (hi - lo) / 2, half), q, COLLISION.BOUNDARY);
    }
  }
}

/** Rocky underside of a floating plateau. */
function underside(R: number, depth: number, seed: number) {
  const profile = [
    new THREE.Vector2(R + 0.4, 0.05), new THREE.Vector2(R + 0.2, -1.2), new THREE.Vector2(R * 0.97, -depth * 0.07), new THREE.Vector2(R * 0.9, -depth * 0.17),
    new THREE.Vector2(R * 0.74, -depth * 0.31), new THREE.Vector2(R * 0.52, -depth * 0.49), new THREE.Vector2(R * 0.3, -depth * 0.69), new THREE.Vector2(R * 0.12, -depth * 0.89), new THREE.Vector2(0.01, -depth),
  ];
  const under = new THREE.LatheGeometry(profile, 72);
  const up = under.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < up.count; i++) {
    const x = up.getX(i), y = up.getY(i), z = up.getZ(i);
    if (y < -1) {
      const a = Math.atan2(z, x);
      const n = Math.sin(a * 7 + y * 0.3 + seed) * 0.06 + Math.sin(a * 17 - y * 0.5) * 0.03 + Math.sin(a * 3 + seed) * 0.04;
      up.setXYZ(i, x * (1 + n), y + Math.sin(a * 11 + seed) * 1.5, z * (1 + n));
    }
  }
  under.computeVertexNormals();
  const uu = under.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uu.count; i++) uu.setXY(i, uu.getX(i) * 36, uu.getY(i) * 6);
  const mesh = new THREE.Mesh(under, new THREE.MeshStandardMaterial({ map: T.rockTex(41), roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** Rooftop City deck: painted streets & sidewalks, curb ring, rock underside, colliders. */
function buildCityDeck(data: TerrainData, physics: Physics, footprints: Footprint[]) {
  const R = data.radius;
  const [cx, cy, cz] = data.center ?? [0, 0, 0];
  const group = new THREE.Group();
  group.name = 'terrain';
  const top = new THREE.CircleGeometry(R, 96);
  top.rotateX(-Math.PI / 2);
  const uv = top.attributes.uv as THREE.BufferAttribute, pos = top.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + R) / (2 * R), 1 - (pos.getZ(i) + R) / (2 * R));
  const tex = CT.deckTex([cx, cz], R, footprints, data.plazas, data.paths);
  tex.flipY = true;
  const deck = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
  deck.position.set(cx, cy, cz);
  deck.receiveShadow = true;
  deck.name = 'deck';
  group.add(deck);
  // curb / low wall around the deck edge
  const curb = new THREE.Mesh(new THREE.TorusGeometry(R + 0.1, 0.35, 6, 120), new THREE.MeshStandardMaterial({ map: CT.concreteTex(5, 74), roughness: 0.9 }));
  curb.rotation.x = Math.PI / 2;
  curb.scale.z = 1.6;
  curb.position.set(cx, cy + 0.1, cz);
  curb.castShadow = false;
  group.add(curb);
  const under = underside(R, Math.min(80, R * 1.1), 2.3);
  under.position.set(cx, cy, cz);
  group.add(under);
  physics.addBox(new THREE.Vector3(cx, cy - 2, cz), new THREE.Vector3(R, 2, R));
  boundaryRing(physics, cx, cy, cz, R, data.wallTop ?? 230, data.gaps);
  return group;
}

/** The floating plateau the Starter Village is built on: grass, cobble paths, rock underside, colliders. */
export function buildTerrain(data: TerrainData, physics: Physics, footprints: Footprint[] = []): THREE.Group {
  if (data.style === 'none') { const g = new THREE.Group(); g.name = 'terrain'; return g; }
  if (data.style === 'city') return buildCityDeck(data, physics, footprints);
  const R = data.radius;
  const group = new THREE.Group();
  group.name = 'terrain';

  // grass top
  const grassMap = T.grassTex(31, 1.4);
  const top = new THREE.CircleGeometry(R, 96);
  top.rotateX(-Math.PI / 2);
  const uv = top.attributes.uv as THREE.BufferAttribute;
  const pos = top.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 7, pos.getZ(i) / 7);
  const ground = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1, metalness: 0, color: new THREE.Color(0.95, 1, 0.92) }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // cobblestone plazas & paths
  const cobble = T.cobbleTex();
  const cobMat = new THREE.MeshStandardMaterial({ map: cobble, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const pz of data.plazas) {
    const g = new THREE.CircleGeometry(pz.r, 48);
    g.rotateX(-Math.PI / 2);
    const u = g.attributes.uv as THREE.BufferAttribute, p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < u.count; i++) u.setXY(i, (p.getX(i) + pz.p[0]) / 3.2, (p.getZ(i) + pz.p[1]) / 3.2);
    const m = new THREE.Mesh(g, cobMat);
    m.position.set(pz.p[0], 0.012, pz.p[1]);
    m.receiveShadow = true;
    group.add(m);
  }
  for (const path of data.paths) {
    const a = new THREE.Vector2(...path.a), b = new THREE.Vector2(...path.b);
    const len = a.distanceTo(b);
    const g = new THREE.PlaneGeometry(path.w, len, 1, Math.max(1, Math.round(len / 4)));
    g.rotateX(-Math.PI / 2);
    const u = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < u.count; i++) u.setXY(i, (u.getX(i) * path.w) / 3.2, (u.getY(i) * len) / 3.2);
    const m = new THREE.Mesh(g, cobMat);
    m.position.set((a.x + b.x) / 2, 0.01, (a.y + b.y) / 2);
    m.rotation.y = Math.atan2(b.x - a.x, b.y - a.y);
    m.receiveShadow = true;
    group.add(m);
  }

  // rocky underside (a giant floating island)
  group.add(underside(R, 70, 0));
  // grass lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.45, 6, 96), new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1 }));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.2;
  group.add(lip);

  // colliders: solid ground disc + invisible boundary so the player can never fall into the void
  // flat box (exact top plane) – the invisible ring wall keeps players inside the round plateau
  physics.addBox(new THREE.Vector3(0, -2, 0), new THREE.Vector3(R, 2, R));
  boundaryRing(physics, 0, 0, 0, R, data.wallTop ?? 225, data.gaps);
  return group;
}

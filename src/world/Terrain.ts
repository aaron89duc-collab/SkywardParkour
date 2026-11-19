import * as THREE from 'three';
import { Physics } from '../core/Physics';
import { COLLISION } from '../config';
import type { MapData } from './MapTypes';
import * as T from './Textures';

/** The floating plateau the Starter Village is built on: grass, cobble paths, rock underside, colliders. */
export function buildTerrain(data: MapData['terrain'], physics: Physics): THREE.Group {
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
  const profile = [
    new THREE.Vector2(R + 0.4, 0.05), new THREE.Vector2(R + 0.2, -1.2), new THREE.Vector2(R * 0.97, -5), new THREE.Vector2(R * 0.9, -12),
    new THREE.Vector2(R * 0.74, -22), new THREE.Vector2(R * 0.52, -34), new THREE.Vector2(R * 0.3, -48), new THREE.Vector2(R * 0.12, -62), new THREE.Vector2(0.01, -70),
  ];
  const under = new THREE.LatheGeometry(profile, 72);
  const up = under.attributes.position as THREE.BufferAttribute;
  // break the silhouette with noise
  for (let i = 0; i < up.count; i++) {
    const x = up.getX(i), y = up.getY(i), z = up.getZ(i);
    if (y < -1) {
      const a = Math.atan2(z, x);
      const n = Math.sin(a * 7 + y * 0.3) * 0.06 + Math.sin(a * 17 - y * 0.5) * 0.03 + Math.sin(a * 3) * 0.04;
      up.setXYZ(i, x * (1 + n), y + Math.sin(a * 11) * 1.5, z * (1 + n));
    }
  }
  under.computeVertexNormals();
  const uu = under.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uu.count; i++) uu.setXY(i, uu.getX(i) * 36, uu.getY(i) * 6);
  const rockMat = new THREE.MeshStandardMaterial({ map: T.rockTex(41), roughness: 1, metalness: 0 });
  const underMesh = new THREE.Mesh(under, rockMat);
  underMesh.receiveShadow = true;
  group.add(underMesh);
  // grass lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.45, 6, 96), new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1 }));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.2;
  group.add(lip);

  // colliders: solid ground disc + invisible boundary so the player can never fall into the void
  // flat box (exact top plane) – the invisible ring wall keeps players inside the round plateau
  physics.addBox(new THREE.Vector3(0, -2, 0), new THREE.Vector3(R, 2, R));
  const segs = 64, wallR = R - 1.2;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = new THREE.Vector3(Math.cos(a) * (wallR + 0.5), 110, Math.sin(a) * (wallR + 0.5));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    physics.addBox(c, new THREE.Vector3(0.5, 115, ((2 * Math.PI * wallR) / segs) * 0.6), q, COLLISION.BOUNDARY);
  }
  return group;
}

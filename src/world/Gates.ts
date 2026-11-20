import * as THREE from 'three';
import { Physics } from '../core/Physics';
import { COLLISION } from '../config';
import type { MapData } from './MapTypes';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Safe end of a map. Every map's exit names the spot where the next map's path attaches (`exit.gate`).
 * While the next map is not on this device, that spot is closed by an energy wall: the player cannot walk or
 * jump into the empty air where the next map's colliders would be. Reaching the exit still counts as finishing
 * the map. When the next map is downloaded and loaded the wall disappears and the way on opens.
 * The wall blocks only the player (camera and ledge probes ignore it, so it can not be grabbed or climbed).
 */
type Gate = { mapId: string; next: string; group: THREE.Group; collider: RAPIER.Collider; mat: THREE.MeshBasicMaterial; tex: THREE.CanvasTexture };

function stripes() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(120,220,255,0)');
  grd.addColorStop(0.5, 'rgba(120,220,255,0.9)');
  grd.addColorStop(1, 'rgba(120,220,255,0)');
  for (let y = 0; y < 256; y += 32) { g.fillStyle = grd; g.globalAlpha = 0.25 + (y % 64 ? 0.15 : 0.45); g.fillRect(0, y, 64, 14); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function label(title: string, sub: string) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,30,55,0.78)';
  g.beginPath(); g.roundRect(8, 8, 1008, 240, 40); g.fill();
  g.strokeStyle = 'rgba(140,225,255,0.9)'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = '800 76px "Baloo 2", "Be Vietnam Pro", sans-serif';
  g.fillText(title, 512, 112);
  g.font = '500 44px "Be Vietnam Pro", sans-serif';
  g.fillStyle = '#bfe9ff';
  g.fillText(sub, 512, 192);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GateSystem {
  group = new THREE.Group();
  private gates = new Map<string, Gate>();

  constructor(private physics: Physics) { this.group.name = 'gates'; }

  /**
   * Close the gates whose next map is not loaded, open the ones whose next map is. Returns the ids of maps whose
   * gate just opened (for a "the way on is open" message).
   */
  sync(maps: MapData[], loaded: (id: string) => boolean, text: (nextId: string, fallback: string) => { title: string; sub: string }) {
    const opened: string[] = [];
    for (const m of maps) {
      const ex = m.exit;
      if (!ex?.gate || !ex.next) continue;
      const open = loaded(ex.next);
      const g = this.gates.get(m.id);
      if (open && g) { this.remove(g); this.gates.delete(m.id); opened.push(ex.next); }
      else if (!open && !g) this.gates.set(m.id, this.build(m, text(ex.next, ex.label)));
      else if (!open && g) this.relabel(g, text(ex.next, ex.label));
    }
    return opened;
  }

  private build(m: MapData, t: { title: string; sub: string }): Gate {
    const gd = m.exit.gate!;
    const group = new THREE.Group();
    group.position.set(gd.p[0], gd.p[1], gd.p[2]);
    group.rotation.y = gd.yaw;
    const tex = stripes();
    tex.repeat.set(gd.w / 2, gd.h / 3);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#8fe3ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(gd.w, gd.h), mat);
    wall.position.y = gd.h / 2;
    group.add(wall);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(gd.w + 1.5, 6), Math.min(gd.w + 1.5, 6) / 4), new THREE.MeshBasicMaterial({ map: label(t.title, t.sub), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    sign.position.y = gd.h + 0.9;
    sign.name = 'sign';
    group.add(sign);
    this.group.add(group);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), gd.yaw);
    const collider = this.physics.addBox(new THREE.Vector3(gd.p[0], gd.p[1] + gd.h / 2, gd.p[2]), new THREE.Vector3(gd.w / 2, gd.h / 2, 0.3), q, COLLISION.BOUNDARY);
    return { mapId: m.id, next: m.exit.next, group, collider, mat, tex };
  }

  private relabel(g: Gate, t: { title: string; sub: string }) {
    const sign = g.group.getObjectByName('sign') as THREE.Mesh;
    const mat = sign.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = label(t.title, t.sub);
    mat.needsUpdate = true;
  }

  private remove(g: Gate) {
    this.physics.removeCollider(g.collider);
    this.group.remove(g.group);
    g.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mt = m.material as THREE.MeshBasicMaterial; mt.map?.dispose(); mt.dispose(); } });
  }

  update(time: number) {
    for (const g of this.gates.values()) {
      g.tex.offset.y = -time * 0.35;
      g.mat.opacity = 0.45 + Math.sin(time * 2.2) * 0.1;
    }
  }

  closed(mapId: string) { return this.gates.has(mapId); }
}

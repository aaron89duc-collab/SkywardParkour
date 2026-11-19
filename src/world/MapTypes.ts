export type V3 = [number, number, number];

export type KitKind = 'crate' | 'barrel' | 'plank' | 'beam' | 'log' | 'post' | 'stone' | 'pillar' | 'stairs' | 'fence' | 'rope';

export interface KitData {
  k: KitKind;
  /** top-centre of the piece (rope: start point) */
  p: V3;
  /** yaw in degrees */
  r?: number;
  /** size parameters (see Kit.ts for meaning per kind) */
  s: number[];
  /** material variant (e.g. 'grass', 'dark') */
  m?: string;
  /** rope end point */
  q?: V3;
  /** no collider (decor only) */
  nc?: boolean;
}

export interface PrefabData {
  id: string;
  p: V3; // base (bottom-centre)
  r: number; // yaw degrees
  s: number; // height in metres (models are normalised to height 1)
  col?: boolean; // default true
  tag?: string;
}

export interface SpriteData {
  n: string; // atlas name
  p: V3; // bottom-centre
  h: number; // height in metres
  sway?: number; // wind sway amount (vegetation)
  flip?: boolean;
}

export type FxData =
  | { t: 'waterfall'; p: V3; w: number; h: number; r: number; fall?: number }
  | { t: 'shrine'; p: V3; s: number; exit?: boolean }
  | { t: 'glow'; p: V3; s: number; c?: string }
  | { t: 'milestone'; p: V3; h: number };

export interface ZoneData {
  id: string;
  name: string;
  y0: number;
  y1: number;
  color: string;
}

export interface MapData {
  id: string;
  name: string;
  version: number;
  height: number;
  origin: V3;
  spawn: { p: V3; yaw: number };
  exit: { p: V3; r: number; next: string; label: string };
  zones: ZoneData[];
  milestones: number[];
  terrain: { radius: number; plazas: { p: [number, number]; r: number }[]; paths: { a: [number, number]; b: [number, number]; w: number }[] };
  prefabs: PrefabData[];
  kit: KitData[];
  sprites: SpriteData[];
  fx: FxData[];
  /** distant non-collidable scenery islands */
  scenery?: { id: string; p: V3; r: number; s: number }[];
}

export interface MapRegistryEntry {
  id: string;
  name: string;
  file: string;
  yMin: number;
  yMax: number;
}

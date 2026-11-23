export type V3 = [number, number, number];

export type KitKind =
  | 'crate' | 'barrel' | 'plank' | 'beam' | 'log' | 'post' | 'stone' | 'pillar' | 'stairs' | 'fence' | 'rope'
  // Rooftop City
  | 'building' // p top-centre, s [w, h, d], m facade style, par = parapet height (0 = none), roof = roof style
  | 'slab' // ledge / balcony / landing: s [w, t, d], m concrete | metal | grate | tile | wood
  | 'pipe' // p -> q, s [radius], m metal | yellow | copper
  | 'girder' // I-beam, long axis = local Z: s [w, h, len]
  | 'billboard' // p top-centre of the poster, s [w, h, legs], m = ad index; catwalk in front (local +Z)
  | 'rail' // metal railing along local X: s [len, h]
  | 'lamp' // street lamp: s [h]
  | 'antenna' // lattice mast: s [h, w]
  | 'awning' // striped awning sloping toward local +Z: s [w, d, drop], m hue
  | 'sign' // painted sign board: s [w, h], m 'TEXT|sub'
  | 'wall' // invisible boundary box: p centre, s [hx, hy, hz]
  | 'rock' // rocky underside of a floating chunk (visual): p top-centre, s [w, d, depth]
  | 'solid'; // invisible solid box (simplified collider for a decorative model): p top-centre, s [w, h, d]

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
  /** building: parapet height (default 0.8, 0 = none) */
  par?: number;
  /** building: roof style */
  roof?: string;
  /** building: blank (windowless) wall faces, bit mask +X=1 -X=2 +Z=4 -Z=8 */
  blank?: number;
}

export interface PrefabData {
  id: string;
  p: V3; // base (bottom-centre)
  r: number; // yaw degrees
  s: number; // height in metres (models are normalised to height 1)
  col?: boolean; // default true
  tag?: string;
}

/**
 * Moving platform, stepped deterministically from the simulation time (parentless colliders moved every tick).
 *  - crane / hover: ping-pong along `pts` (platform top-centres) with `wait` seconds parked at each end
 *  - swing: a container hanging from `pivot` on a cable of length `len`, swinging `amp` degrees either side in the
 *    vertical plane facing yaw `r`, period `period`; it stays level (spreader on parallel cables). pts[0] / pts[1] =
 *    its roof centre at the two extremes (filled in by the map builder)
 *  - rotor: a crane jib turning about the vertical axis through `center` (walkway top at center.y) between yaw
 *    angles a0 and a1 (degrees) with `wait` at each end, `speed` in degrees per second; pts = the jib tip at a0 / a1
 */
export interface MoverData {
  id: string;
  kind: 'crane' | 'hover' | 'swing' | 'rotor';
  pts: V3[];
  speed: number; // m/s along the path (rotor: degrees per second)
  wait: number; // seconds parked at each end
  phase?: number; // seconds offset in the cycle
  r?: number; // yaw degrees of the platform (swing: of the swing plane)
  s?: number; // model scale (hover / swing) / pallet size (crane)
  jib?: number; // crane: height of the trolley rail; hover 'lift': height of the hoist rope's top
  /**
   * Fully data-driven look (any kind): a GLB plus its solid parts, so a new map can bring a new moving object
   * with no app update. Units are the model's normalised units (height 1) times `s`; offsets are relative to the
   * mover's reference point (deck top centre; rotor: the axis at walkway height), before the mover's yaw.
   */
  model?: { file: string; s?: number; off?: V3; yaw?: number; boxes: [number, number, number, number, number, number][] };
  /** hover only: what it looks like: hover platform (default), a cargo pallet stand, a lift car (on a lift tower),
   * a trolley platform hanging from an overhead rail (moves along the model's x axis, boarded from its open -z side) */
  look?: 'hover' | 'pallet' | 'lift' | 'trolley';
  // swing
  pivot?: V3;
  len?: number;
  amp?: number;
  period?: number;
  // rotor
  center?: V3;
  arm?: number; // rotor: distance of the reference stand point from the axis (along the jib)
  off?: number; // rotor: sideways offset of the walkway centre line from the axis
  width?: number;
  a0?: number;
  a1?: number;
}

/** jump pad: launches upward; speed pad: dash in the arrow direction (local +Z). p = top-centre of the pad surface. */
export interface PadData {
  t: 'jump' | 'speed';
  p: V3;
  r: number;
  v?: number; // jump: launch speed up / speed: dash speed
  s?: number; // model scale
  /** jump pad: the landing point it aims at (arrow + landing marker); the launch only covers ~3/4 of the way */
  tg?: V3;
}

/** Speed ring: flying through the hoop (centre p, normal = local +Z) boosts along the normal. */
export interface RingData { p: V3; r: number; s: number; v?: number }

/** Climbable ladder: p = bottom centre on the wall surface, r = yaw of the outward normal (local +Z). */
export interface LadderData { p: V3; h: number; r: number; w?: number; nv?: boolean }

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
  | { t: 'milestone'; p: V3; h: number }
  | { t: 'portal'; p: V3; s: number; r: number };

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
  exit: {
    p: V3; r: number; next: string; label: string;
    /** where the next map's path attaches: closed by an energy wall (w x h, facing yaw) until that map is loaded */
    gate?: { p: V3; yaw: number; w: number; h: number };
  };
  /** extra prefab models of this map: id -> logical path without extension (pack assets) */
  prefabFiles?: Record<string, string>;
  /** self-lit prefabs: id -> emissive intensity */
  emissive?: Record<string, number>;
  /** shown when the map is finished (end-of-content hint) */
  finishHint?: string;
  zones: ZoneData[];
  milestones: number[];
  terrain: TerrainData;
  prefabs: PrefabData[];
  kit: KitData[];
  sprites: SpriteData[];
  fx: FxData[];
  /** distant non-collidable scenery islands */
  scenery?: { id: string; p: V3; r: number; s: number }[];
  movers?: MoverData[];
  pads?: PadData[];
  rings?: RingData[];
  ladders?: LadderData[];
  /** admin / test teleport targets (feet positions on standable route points) */
  waypoints?: { label: string; p: V3 }[];
  /** the map's own jump-pad model (default: Map 002's): file without .glb, normalised w x d, pad surface height */
  padModel?: { file: string; w: number; d: number; top: number };
  /** gameplay devices (crumbling floors, conveyors, fans, ziplines ...): see src/world/Devices.ts */
  devices?: import('./Devices').DeviceData[];
  /** sprite atlas (logical path without extension); default: Map 001's */
  atlas?: string;
  /** models of the moving-platform looks this map uses (logical paths without .glb), overriding the engine's
   *  defaults: a later map can bring its own trolley / lift car / container / jib model without an app update */
  moverModels?: Partial<Record<'hover' | 'pallet' | 'lift' | 'trolley' | 'swing' | 'rotor', string>>;
  /** horizontal region of this map (for "which map am I in") */
  region?: { c: [number, number]; r: number };
}

/** opening in the invisible boundary ring (angle in radians around the terrain centre, world heights) */
export interface BoundaryGap { a: number; half: number; y0: number; y1: number }

export interface TerrainData {
  radius: number;
  style?: 'village' | 'city' | 'none';
  /** centre of the plateau (default [0,0,0]); y = walkable top */
  center?: V3;
  plazas: { p: [number, number]; r: number }[];
  paths: { a: [number, number]; b: [number, number]; w: number }[];
  /** height of the invisible boundary ring above the plateau (default 230) */
  wallTop?: number;
  gaps?: BoundaryGap[];
}

export interface MapRegistryEntry {
  id: string;
  name: string;
  file: string;
  yMin: number;
  yMax: number;
  /** position in the column, bottom = 1 */
  order?: number;
}

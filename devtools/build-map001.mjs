// Map 001 – Starter Village. Hand-authored layout; connectors are deterministic.
// Run: node devtools/build-map001.mjs  -> public/maps/map001.json (+ devtools/out/map001_plan.png)
import fs from 'fs';
import { MapBuilder, r2, makeWaypoints } from './mapgen/lib.mjs';
import { plotMap } from './mapgen/plot.mjs';

const B = new MapBuilder({ radius: 85 });
// top of a prefab at (x,z); if (x,z) is off the model, walk from its centre toward (x,z) and stop `inset` m inside the edge
const T = (o, x, z, dy = 0, inset = 0.7) => {
  const y = o.topAt(x, z);
  const cy = o.topAt(o.x, o.z);
  if (y !== null && (cy === null || Math.abs(y - cy) < 2.5 || o.id !== 'floating_rock_island')) return [x, r2(y + dy), z];
  const dx = x - o.x, dz = z - o.z, L = Math.hypot(dx, dz) || 1;
  let lastOk = 0;
  for (let d = 0; d <= L; d += 0.15) {
    const t = o.topAt(o.x + (dx / L) * d, o.z + (dz / L) * d);
    if (t === null || (cy !== null && Math.abs(t - cy) > 1.2)) break;
    lastOk = d;
  }
  const d = Math.max(0, lastOk - inset);
  const px = o.x + (dx / L) * d, pz = o.z + (dz / L) * d;
  const py = o.topAt(px, pz);
  if (py === null) throw new Error(`no top on ${o.name} toward ${x},${z}`);
  if (Math.hypot(px - x, pz - z) > 0.2) console.log(`    T(${o.name}) moved ${x},${z} -> ${px.toFixed(1)},${pz.toFixed(1)}`);
  return [r2(px), r2(py + dy), r2(pz)];
};
const deco = (list, x, y, z, spread, n, hMin, hMax, sway = 0.6) => {
  for (let i = 0; i < n; i++) {
    const a = B.rnd() * Math.PI * 2, d = Math.sqrt(B.rnd()) * spread;
    B.sprite(B.pick(list), x + Math.cos(a) * d, y, z + Math.sin(a) * d, hMin + B.rnd() * (hMax - hMin), sway, B.rnd() < 0.5);
  }
};
const FLOWERS = ['daisy_patch', 'yellow_wildflowers', 'purple_wildflowers', 'tall_grass', 'pink_flower_bush', 'green_bush'];
const TREES = ['green_oak_tree', 'evergreen_pine'];

// =====================================================================================
// ZONE A – VILLAGE SPAWN (0–14 m): the ground village on a giant floating plateau
// =====================================================================================
const SPAWN = [0, 0, 45];
const gateS = B.prefab('wooden_village_gate', 0, 0, 52, 0, 6.5, { name: 'South Gate' });
const H1 = B.prefab('starter_house', -16, 0, 30, 90, 8, { name: 'H1' });
const H2 = B.prefab('starter_house', 15, 0, 26, -90, 8.5, { name: 'H2' });
const H3 = B.prefab('starter_house', -17, 0, 6, 90, 9, { name: 'H3' });
const H4 = B.prefab('starter_house', 17, 0, 2, -90, 9, { name: 'H4' });
const H5 = B.prefab('starter_house', -15, 0, -24, 45, 8, { name: 'H5' });
const MS1 = B.prefab('market_stall', 8, 0, 38, -90, 4, { name: 'MS1' });
B.prefab('blue_tent_stall', -8.5, 0, 40, 90, 3.6, { name: 'BT1' });
B.prefab('market_stall', -7.5, 0, 17, 90, 4, { name: 'MS2' });
B.prefab('blue_tent_stall', 7.5, 0, 15, -90, 3.5, { name: 'BT2' });
B.prefab('crystal_blue_shrine', 0, 0, 6, 0, 4, { name: 'Starter Crystal' });
const SA1 = B.prefab('stone_arch_gate', 0, 0, -14, 0, 7, { name: 'SA1' });
const W1 = B.prefab('windmill', 36, 0, -14, -90, 24, { name: 'W1' });

// plaza decoration (2D source-art pack as billboards)
B.sprite('map_001_village_sign', -3.6, 0, 41.5, 2.6);
B.sprite('direction_sign', 3.4, 0, 39.8, 2.3);
B.banner(-3.6, 0, 50.5); B.banner(3.6, 0, 50.5);
for (const [x, z] of [[-4.5, 36], [4.5, 33], [-4.5, 22], [4.5, 20], [-4.5, -4], [4.5, -4], [-3.5, -22], [3.5, -26]]) B.lantern(x, 0, z);
B.sprite('fruit_cart', 11.5, 0, 33.5, 2.0);
B.sprite('large_barrel', 5.6, 0, 35.2, 1.25); B.sprite('small_barrel', 6.2, 0, 34.4, 0.95);
B.sprite('canvas_sack', -5.9, 0, 38.6, 0.9); B.sprite('coiled_rope', -6.2, 0, 42.4, 0.6);
B.sprite('large_wooden_crate', -11.5, 0, 36.5, 1.2); B.sprite('treasure_chest', -11.2, 0, 43.2, 0.9);
B.sprite('garden_bench', 6.5, 0, 1.5, 1.1); B.sprite('garden_bench', -6.5, 0, 1.5, 1.1, 0, true);
B.sprite('stone_plant_bed', 4.5, 0, 12, 1.0); B.sprite('stone_plant_bed', -4.5, 0, 12, 1.0);
B.sprite('campfire', -24, 0, 18, 1.2); B.fx.push({ t: 'glow', p: [-24, 0.7, 18], s: 2.6, c: '255,170,80' });
B.sprite('crystal_gold_shrine', 24, 0, 30, 2.2); B.fx.push({ t: 'glow', p: [24, 1.4, 30], s: 2.2, c: '255,220,120' });
B.sprite('stone_milestone', 2.6, 0, 46.5, 1.1);
B.sprite('wall_lantern_bracket', -12, 0, 28, 2.2);
B.sprite('clock_village_stone_arch', -38, 0, 22, 6);
B.sprite('stone_wood_fence', -30, 0, 36, 1.4); B.sprite('wooden_railing', 30, 0, 40, 1.2);
B.sprite('window_flower_box', -12.3, 2.2, 30, 1.0);
B.sprite('mossy_boulders', 26, 0, 20, 1.8); B.sprite('mossy_boulders', -28, 0, -8, 2.2, 0, true);
B.sprite('rock_grass_block_a', -40, 0, -30, 2.8); B.sprite('rock_grass_block_b', 44, 0, 18, 2.6);
B.sprite('stone_step_rock', 38, 0, 30, 2.4); B.sprite('stone_stairs', -34, 0, 44, 2.2);
B.sprite('single_stone_tile', 12, 0.01, 46, 0.4); B.sprite('mossy_paver_tile', -12, 0.01, 47, 0.4);
// trees ring + meadow
for (let i = 0; i < 46; i++) {
  const a = (i / 46) * Math.PI * 2 + B.rnd() * 0.08;
  const r = 46 + B.rnd() * 30;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (Math.hypot(x - 36, z + 14) < 14) continue;
  B.sprite(B.pick(TREES), x, 0, z, 6 + B.rnd() * 5, 0.25, B.rnd() < 0.5);
}
for (const [x, z] of [[-24, 30], [24, 12], [-25, -12], [10, -26], [-10, 50], [12, 52], [28, -32], [-30, 10]]) B.sprite(B.pick(TREES), x, 0, z, 6.5 + B.rnd() * 2, 0.25);
deco(FLOWERS, 0, 0, 20, 34, 140, 0.5, 1.1, 1);
deco(['red_mushrooms', 'tall_grass', 'daisy_patch'], 0, 0, -30, 40, 60, 0.4, 0.9, 1);

// ---------------- Main route A: market crates -> MS1 canopy -> H2 roof -> chimney -> watchtower
B.mark('main', SPAWN, 'spawn');
B.banner(5.5, 0, 44);
const msTop = T(MS1, 9.2, 39.4);
B.steps('main', [6.2, 0, 44.4], msTop, { style: 'crates', diff: 'easy', size: 1.1, via: [10.5, 43.5], startHalf: 0.5, endHalf: 0.9 });
B.mark('main', msTop, 'MS1 canopy');
const h2Eave = T(H2, 13.2, 29.0);
B.steps('main', T(MS1, 8.6, 35.6), h2Eave, { style: 'scaffold', diff: 'easy', size: 1.8, startHalf: 0.6, endHalf: 0.5, lanterns: true });
B.mark('main', h2Eave, 'H2 roof');
const h2Chimney = T(H2, 18.2, 25.8);
B.mark('main', h2Chimney, 'H2 chimney');
// watchtower T1
const T1 = [23.5, 11.6, 16.5];
B.steps('main', h2Chimney, [T1[0] - 1.2, T1[1], T1[2] + 1.6], { style: 'scaffold', diff: 'easy', size: 1.8, startHalf: 0.5, endHalf: 1.6, lanterns: true });
B.scaffold(T1[0], T1[1], T1[2], 3.4, 3.4, 20);
B.kitPiece('fence', [T1[0] + 1.6, T1[1] + 1.0, T1[2]], [3.2, 1.0], 110, { nc: true });
B.banner(T1[0] + 1.2, T1[1], T1[2] - 1.2); B.lantern(T1[0] - 1.3, T1[1], T1[2] - 1.3);
B.mark('main', T1, 'Watchtower');

// =====================================================================================
// ZONE B – VILLAGE PARKOUR (14–40 m): around the BACK of the big windmill, then the beam run
// =====================================================================================
const WC = [36, -14], WR = 9.6;
const spiralStart = [WC[0] + WR * Math.sin(0.15), 12.6, WC[1] + WR * Math.cos(0.15)];
B.steps('main', T1, spiralStart, { style: 'scaffold', diff: 'easy', size: 1.8, via: [30, 6], startHalf: 1.6, endHalf: 0.9, lanterns: true });
// spiral of scaffolds behind the windmill (pathfinding #1: the way up is hidden at the back)
let prevY = 12.6;
const NSP = 12;
for (let i = 0; i <= NSP; i++) {
  const th = 0.15 + (i / NSP) * (Math.PI - 0.15);
  const x = WC[0] + WR * Math.sin(th), z = WC[1] + WR * Math.cos(th);
  const y = 12.6 + i * 1.02;
  B.scaffold(x, y, z, 1.9, 1.9, (th * 180) / Math.PI, { maxPost: 40 });
  if (i % 3 === 1) B.lantern(x, y, z);
  B.mark('main', [x, y, z]);
  prevY = y;
}
B.banner(WC[0] + WR + 0.6, 12.6 + 6 * 1.02, WC[1] + 0.5);
const NEST = [WC[0] - 0.6, prevY + 1.0, WC[1] - WR - 2.2];
B.scaffold(NEST[0], NEST[1], NEST[2], 3.4, 3.0, 0, { maxPost: 40 });
B.banner(NEST[0] - 1.2, NEST[1], NEST[2] - 1.0); B.lantern(NEST[0] + 1.3, NEST[1], NEST[2] - 1.0);
B.mark('main', NEST, 'Windmill nest');

// Challenge 1 – "Xà Ngang Cối Xay": narrow beams + logs high above the village
const I1 = B.prefab('floating_rock_island', 15, 31 - 0.885 * 6, -43, 20, 6, { name: 'I1' });
const i1Edge = T(I1, 19.5, -39.5);
B.steps('main', [NEST[0], NEST[1], NEST[2] - 1.0], i1Edge, { style: 'beams', diff: 'medium', size: 3.4, via: [30, -38], startHalf: 1.5, endHalf: 0.8, beamW: 0.45 });
B.mark('main', i1Edge, 'I1');
// ---------------- Shortcut S1: H4 roof -> stone pillars -> straight to I1 (skips the windmill spiral + beam run)
B.sprite('red_mushrooms', 21.6, 0, 5.4, 0.7); B.sprite('red_mushrooms', 22.2, 0, 4.4, 0.5);
B.steps('S1', [22.4, 0, 6.2], T(H4, 19.8, 4.6), { style: 'crates', diff: 'easy', size: 1.2, startHalf: 0.4, endHalf: 0.6, log: false });
const h4Chim = T(H4, 20.4, 1.8);
B.mark('S1', h4Chim, 'H4 chimney');
const s1Mid = [19.2, 20.0, -30.6];
B.steps('S1', h4Chim, s1Mid, { style: 'pillars', diff: 'hard', size: 1.3, via: [25, -12], startHalf: 0.5, endHalf: 0.65, maxPillar: 14 });
B.kitPiece('pillar', s1Mid, [1.3, 12], 0);
B.mark('S1', s1Mid);
B.steps('S1', s1Mid, T(I1, 16.8, -38.0), { style: 'pillars', diff: 'grab', size: 1.4, startHalf: 0.65, endHalf: 0.6, maxPillar: 10 });

// =====================================================================================
// ZONE C – UPPER VILLAGE (40–75 m): floating rock islands with houses, a hidden bridge, a stone arch
// =====================================================================================
const H6 = B.prefab('starter_house', 14.6, 30.85, -43.6, 20, 6.5, { name: 'H6' });
// crates to the eave
const h6Eave = T(H6, 17.5, -41.6);
B.steps('main', T(I1, 20.6, -39.4), h6Eave, { style: 'crates', diff: 'easy', size: 1.1, startHalf: 0.3, endHalf: 0.5, n: 2 });
B.mark('main', h6Eave, 'H6 eave');
B.mark('main', T(H6, 14.0, -46.2), 'H6 chimney side');
// pathfinding #2: hidden rope bridge behind H6 (north side) heading west
const bridgeA = [11.4, 37.0, -50.5];
B.scaffold(bridgeA[0] + 0.8, bridgeA[1], bridgeA[2] + 1.4, 2.6, 2.4, 20, { maxPost: 10 });
const I2 = B.prefab('floating_rock_island', -9, 42 - 0.885 * 7, -57, -15, 7, { name: 'I2' });
const bridgeB = [2.4, 37.0, -53.6];
B.bridge('main', bridgeA, bridgeB);
B.banner(bridgeA[0] + 1.6, bridgeA[1], bridgeA[2] + 2.2);
B.kitPiece('stairs', [-3.3, 42.05, -55.9], [2.6, 5.05, 5.2, 12], -110);
B.mark('main', [-3.3, 42.05, -55.9], 'I2 stairs');
const MS3 = B.prefab('market_stall', -11.5, T(I2, -11.5, -58.5)[1] - 0.15, -58.5, 0, 4.4, { name: 'MS3' });
B.prefab('blue_tent_stall', -6.5, T(I2, -6.5, -61)[1] - 0.1, -61.5, 160, 3.4, { name: 'BT3' });
deco(FLOWERS, -9, 42, -56, 4, 14, 0.4, 0.9, 1); B.sprite('evergreen_pine', -14.5, 41.9, -53, 5.5, 0.2);
B.lantern(-4.2, 42, -58.4); B.banner(-6.2, 42, -54.2);
const ms3Top = T(MS3, -9.2, -58.6);
B.steps('main', [-4.6, 42, -59.2], [-6.9, ms3Top[1] - 0.9, -58.8], { style: 'crates', diff: 'easy', size: 1.1, startHalf: 0.4, endHalf: 0.6, n: 2 });
B.kitPiece('crate', [-6.9, ms3Top[1] - 0.9, -58.8], [1.1], 8);
B.mark('main', [-6.9, ms3Top[1] - 0.9, -58.8]);
B.mark('main', ms3Top, 'MS3 canopy');
// stones up to I3 (tall cone island) with the stone arch on top
const I3 = B.prefab('floating_island', -27, 52 - 0.95 * 10, -48, 30, 10, { name: 'I3' });
const SA2 = B.prefab('stone_arch_gate', -27, 51.9, -48, 90, 5.5, { name: 'SA2' });
const i3Edge = T(I3, -23.6, -50.6);
B.steps('main', [-12.6, ms3Top[1], -57.5], i3Edge, { style: 'stones', diff: 'medium', size: 2.0, via: [-20, -60], startHalf: 1.0, endHalf: 0.8 });
B.mark('main', i3Edge, 'I3');
// up the arch: crate -> pillar cap -> arch top
const saPillar = T(SA2, -27.4, -52.5);
B.steps('main', i3Edge, saPillar, { style: 'crates', diff: 'easy', size: 1.0, startHalf: 0.4, endHalf: 0.5, n: 2 });
const saTop = T(SA2, -27.2, -48);
B.mark('main', saPillar, 'SA2 pillar'); B.mark('main', saTop, 'SA2 top');
B.banner(-29.5, 52, -46.0);
// ---------------- Shortcut S2: from I2 west edge, hidden logs under I3 straight to I4 (skips MS3 + arch)
B.sprite('red_mushrooms', -14.6, 42, -59.6, 0.6);
const I4 = B.prefab('floating_rock_island', -31, 61 - 0.885 * 9, -21, 0, 9, { name: 'I4' });
const W2 = B.prefab('windmill_variant', -31, 60.75, -21, 90, 16, { name: 'W2' });
const i4North = T(I4, -32, -27.8);
B.steps('S2', [-14.4, 42.2, -60.6], [-35.5, 52.0, -35.0], { style: 'logs', diff: 'hard', via: [-36, -60], startHalf: 0.6, endHalf: 0.6, logR: 0.38 });
B.kitPiece('pillar', [-35.5, 52.0, -35.0], [1.4, 6], 0);
B.mark('S2', [-35.5, 52.0, -35.0]);
B.steps('S2', [-35.5, 52.0, -35.0], i4North, { style: 'pillars', diff: 'grab', size: 1.4, startHalf: 0.7, endHalf: 0.7, maxPillar: 7 });
B.mark('S2', i4North);
// main: arch top -> planks -> I4
B.steps('main', saTop, i4North, { style: 'scaffold', diff: 'medium', size: 1.8, via: [-30, -38], startHalf: 2.2, endHalf: 0.7, posts: false });
B.mark('main', i4North, 'I4');
B.banner(-28.2, 61, -27.0); B.lantern(-34, 61, -26.5);
deco(FLOWERS, -31, 61, -21, 6, 18, 0.4, 1.0, 1);
// climb around the back (west) of the second windmill
const W2C = [-31, -21], W2R = 9.2;
let wy = 61.6;
for (let i = 0; i <= 11; i++) {
  const th = Math.PI + 0.25 + (i / 11) * (Math.PI - 0.5);
  const x = W2C[0] + W2R * Math.sin(th), z = W2C[1] + W2R * Math.cos(th);
  wy = 61.6 + i * 1.05;
  B.scaffold(x, wy, z, 1.9, 1.9, (th * 180) / Math.PI, { posts: false });
  B.kitPiece('rope', [x, wy, z], [0.03, 0.1], 0, { q: [W2C[0] + (x - W2C[0]) * 0.35, wy + 1.4, W2C[1] + (z - W2C[1]) * 0.35] });
  if (i % 4 === 2) B.lantern(x, wy, z);
  B.mark('main', [x, wy, z]);
}
const NEST2 = [W2C[0] + 2.0, wy + 1.0, W2C[1] + W2R + 1.8];
B.scaffold(NEST2[0], NEST2[1], NEST2[2], 3.2, 3.0, 0, { posts: false });
B.banner(NEST2[0] + 1.1, NEST2[1], NEST2[2] + 1.0);
B.mark('main', NEST2, 'W2 nest');
// S2 (part 2): a grab column hidden on the windmill's blade side, straight up to the nest (skips the W2 spiral)
{
  const base = T(I4, -24.6, -25.2);
  B.sprite('red_mushrooms', base[0] + 0.6, base[1], base[2] + 0.4, 0.55);
  B.mark('S2', base);
  B.steps('S2', base, [NEST2[0] + 1.2, NEST2[1], NEST2[2] - 1.2], { style: 'pillars', diff: 'grab', size: 1.4, via: [-22.5, -16], startHalf: 0.6, endHalf: 1.2, maxPillar: 6 });
}

// =====================================================================================
// ZONE D – FLOATING ISLANDS (75–112 m): sky stepping stones, behind the waterfall, island cluster
// =====================================================================================
const WF1 = B.prefab('waterfall_island', -21, 89 - 0.99 * 10, 15, 0, 10, { name: 'WF1' });
const wf1West = T(WF1, -25.2, 13.6);
// Challenge 2 – "Đá Bay": small floating rocks, big gaps
B.steps('main', NEST2, wf1West, { style: 'rocks', diff: 'medium', size: 3.0, via: [-44, 6], startHalf: 1.4, endHalf: 0.8 });
B.mark('main', wf1West, 'WF1 rim');
// pathfinding #3: behind the waterfall — stones hidden behind the falling water, then up to I5
const wfFront = [-19.1 + 0.0, 0, 15 + 0.55 * 10];
const behind1 = [-19.3, 86.4, 21.6];
B.kitPiece('stone', behind1, [2.0, 1.4, 2.0], 0, { m: 'grass' });
B.mark('main', behind1, 'behind waterfall');
const I5 = B.prefab('floating_rock_island', 4, 94 - 0.885 * 5, 27, 40, 5, { name: 'I5' });
const i5West = T(I5, 0.6, 26.4);
B.steps('main', behind1, i5West, { style: 'stones', diff: 'easy', size: 1.8, via: [-10, 28], startHalf: 1.0, endHalf: 0.8 });
B.mark('main', i5West, 'I5');
void wfFront;
// island cluster (pathfinding #4): I6 is a dead-end viewpoint, I7 continues
const I6 = B.prefab('floating_island', 14, 99 - 0.95 * 6, 41, 0, 6, { name: 'I6' });
B.steps('dead', T(I5, 6.0, 30.0), T(I6, 12.4, 38.6), { style: 'logs', diff: 'medium', startHalf: 0.6, endHalf: 0.8, logR: 0.4 });
B.sprite('treasure_chest', 14.5, 99, 41.5, 1.0); B.sprite('gold_star_coin', 13.4, 100.2, 40.6, 0.6);
B.sprite('green_oak_tree', 15.8, 99, 43, 4.5, 0.25);
const I7 = B.prefab('floating_rock_island', 21, 100 - 0.885 * 6, 18, -30, 6, { name: 'I7' });
B.prefab('blue_tent_stall', 22.5, T(I7, 22.5, 19.5)[1] - 0.1, 19.5, -120, 3.2, { name: 'BT4' });
const i7West = T(I7, 17.0, 20.0);
B.steps('main', T(I5, 6.5, 25.5), i7West, { style: 'scaffold', diff: 'medium', size: 1.8, startHalf: 0.8, endHalf: 0.7, posts: false });
B.mark('main', i7West, 'I7');
B.banner(19.5, 100, 14.6); B.lantern(22.4, 100, 14.6);
// rope bridge north to the second waterfall island, then stairs up onto its rim
const WF2 = B.prefab('waterfall_island', 23, 105 - 0.99 * 8, -12, -90, 8, { name: 'WF2' });
const br2A = [21.6, 100.2, 13.6], br2B = [21.8, 100.4, -2.6];
B.bridge('main', br2A, br2B);
B.kitPiece('stairs', [22.2, 104.9, -7.2], [2.4, 4.6, 4.6, 11], 180);
B.mark('main', [22.2, 104.9, -7.2], 'WF2 stairs');
const wf2Top = T(WF2, 23.6, -8.6);
B.mark('main', wf2Top, 'WF2 rim');
// ---------------- Shortcut S3: from I5, a column of grab-pillars straight up toward the summit tower
B.sprite('red_mushrooms', 4.6, 94, 30.4, 0.6);

// =====================================================================================
// ZONE E – UPPER EXIT (112–140 m): the spiral tower, summit island, gate to Map 002
// =====================================================================================
const TC = [6, -20], TR = 6.6;
// central column (landmark)
B.kitPiece('pillar', [TC[0], 127.5, TC[1]], [3.6, 30], 0, { m: 'light' });
B.fx.push({ t: 'glow', p: [TC[0], 129.2, TC[1]], s: 5, c: '160,220,255' });
// from WF2 rim, logs west to the tower base ring
const ring = [];
const NR = 13;
for (let i = 0; i < NR; i++) {
  const th = 1.15 + i * 0.52;
  ring.push([TC[0] + TR * Math.sin(th), 0, TC[1] + TR * Math.cos(th), th]);
}
const ringY = (i) => 109.5 + i * 1.62 + (i % 3 === 2 ? 1.2 : 0);
B.steps('main', wf2Top, [ring[0][0], ringY(0), ring[0][2]], { style: 'logs', diff: 'easy', startHalf: 0.8, endHalf: 0.8, logR: 0.45 });
// Challenge 3 – "Tháp Xoắn": pillars around the column, some need a ledge grab
for (let i = 0; i < NR; i++) {
  const [x, , z, th] = ring[i];
  const y = ringY(i);
  B.kitPiece('pillar', [x, y, z], [1.8, 6.5], (th * 180) / Math.PI);
  if (i % 4 === 1) B.kitPiece('log', [x, y - 0.0, z], [0.32, 2.2], (th * 180) / Math.PI, { nc: true });
  B.mark('main', [x, y, z]);
}
B.banner(ring[4][0], ringY(4), ring[4][2], 1.8);
const last = ring[NR - 1];
const I8 = B.prefab('floating_rock_island', -8, 134 - 0.885 * 8, -36, 10, 8, { name: 'I8 Summit' });
const i8East = T(I8, -3.0, -32.5);
B.steps('main', [last[0], ringY(NR - 1), last[2]], i8East, { style: 'scaffold', diff: 'easy', size: 1.7, startHalf: 0.9, endHalf: 0.8, posts: false });
B.mark('main', i8East, 'Summit');
// summit: stairs up to a stone podium at exactly 140 m, gate to Map 002 on top, beacon shrine beside it
const podC = [-9, -37];
const podBase = T(I8, podC[0], podC[1]);
const PODIUM_TOP = 140;
B.kitPiece('stone', [podC[0], PODIUM_TOP, podC[1]], [6.4, PODIUM_TOP - podBase[1] + 1.2, 6.4], 0, { m: 'light' });
// stairs ascend toward -x (local +z -> world -x for r=-90)
const stH = PODIUM_TOP - (podBase[1] - 0.05);
B.kitPiece('stairs', [podC[0] + 3.2 + 0.2, PODIUM_TOP, podC[1] + 0.6], [2.8, stH, stH * 1.05, Math.ceil(stH / 0.4)], -90);
B.mark('main', [podC[0] + 3.4 + stH * 0.95, podBase[1] + 0.4, podC[1] + 0.6], 'podium stairs');
B.mark('main', [podC[0] + 3.4, PODIUM_TOP, podC[1] + 0.6], 'podium');
// the gate stands on the podium's north edge: walk through it onto the sky bridge to Rooftop City
B.prefab('wooden_village_gate', podC[0], PODIUM_TOP - 0.05, podC[1] - 2.4, 0, 6.4, { name: 'Gate to Map 002', tag: 'exit-gate' });
B.prefab('crystal_blue_shrine', -4.0, T(I8, -4.0, -40.2)[1] - 0.1, -40.2, 0, 4.2, { name: 'Exit Shrine', tag: 'exit' });
B.banner(podC[0] + 2.2, PODIUM_TOP, podC[1] - 2.6); B.banner(podC[0] + 2.2, PODIUM_TOP, podC[1] + 2.6);
B.sprite('direction_sign', podC[0] + 3.9, podBase[1], podC[1] - 1.8, 2.2);
B.sprite('skyward_banner_stand', -13.5, T(I8, -13.5, -33)[1], -33, 3.0);
B.lantern(podC[0] + 2.6, PODIUM_TOP, podC[1] + 2.0); B.lantern(podC[0] + 2.6, PODIUM_TOP, podC[1] - 2.0);
deco(FLOWERS, -6, podBase[1], -32, 4, 14, 0.4, 1.0, 1);
const EXIT = [podC[0], PODIUM_TOP + 0.6, podC[1]];
B.mark('main', EXIT, 'EXIT');

// S3: from I5, hard pillars north then a grab column straight onto the upper spiral tower (skips I7, bridge, WF2 and most of the tower)
{
  const a = T(I5, 5.6, 23.4);
  const mid = [6.8, 109.0, -3.6];
  B.steps('S3', a, mid, { style: 'pillars', diff: 'hard', size: 1.3, via: [10, 12], startHalf: 0.6, endHalf: 0.65, maxPillar: 8 });
  B.kitPiece('pillar', mid, [1.3, 8], 0);
  B.mark('S3', mid);
  B.steps('S3', mid, [ring[10][0], ringY(10), ring[10][2]], { style: 'pillars', diff: 'grab', size: 1.4, startHalf: 0.65, endHalf: 0.8, maxPillar: 7 });
}

// =====================================================================================
// scenery: cliff waterfalls into the cloud sea, distant islands, milestones, fences
// =====================================================================================
for (const a of [200, 250, 320]) {
  const r = 84.2, rad = (a * Math.PI) / 180;
  const x = Math.cos(rad) * r, z = Math.sin(rad) * r;
  B.kitPiece('stone', [x, 1.0, z], [4, 2.2, 3], -a + 90, { m: 'grass', nc: true });
  B.fx.push({ t: 'waterfall', p: [r2(x + Math.cos(rad) * 1.6), 0.8, r2(z + Math.sin(rad) * 1.6)], w: 3.2, h: 40, r: r2(90 - a), fall: 30 });
}
for (let i = 0; i < 26; i++) {
  const a = B.rnd() * Math.PI * 2, r = 140 + B.rnd() * 260;
  const id = B.pick(['floating_island', 'floating_rock_island', 'floating_rock_island', 'waterfall_island']);
  B.scenic(id, Math.cos(a) * r, -25 + B.rnd() * 170, Math.sin(a) * r, Math.round(B.rnd() * 360), 12 + B.rnd() * 30);
}
// the rest of the 2D source-art pack: tiny villages on the distant scenery islands + a far billboard layer
{
  const TOPR = { floating_island: 0.95, floating_rock_island: 0.885, waterfall_island: 0.99 };
  const VILLAGE = ['starter_house_with_banner', 'small_house_tower', 'cottage_sidewall', 'windmill', 'market_stall', 'blue_tent_stall', 'wooden_village_gate', 'crystal_blue_shrine', 'stone_arch_door', 'wood_platform_tall', 'roof_wall_module', 'blue_roof_module', 'window_glowing', 'stone_pillar', 'boost_jump_pad', 'small_wood_jump_platform'];
  let vi = 0;
  for (const sc of B.scenery) {
    if (sc.id === 'waterfall_island') continue;
    const top = sc.p[1] + TOPR[sc.id] * sc.s;
    const n = 2 + Math.floor(B.rnd() * 3);
    for (let k = 0; k < n; k++) {
      const name = VILLAGE[vi++ % VILLAGE.length];
      const a = B.rnd() * Math.PI * 2, d = B.rnd() * sc.s * 0.22;
      const h = name.includes('house') || name.includes('windmill') || name.includes('cottage') ? sc.s * 0.32 : sc.s * 0.16;
      B.sprite(name, sc.p[0] + Math.cos(a) * d, top - 0.2, sc.p[2] + Math.sin(a) * d, h);
    }
    B.sprite(B.pick(TREES), sc.p[0] + sc.s * 0.25, top - 0.2, sc.p[2], sc.s * 0.3, 0.2);
  }
  const FAR = ['large_floating_island', 'medium_floating_island', 'tiny_floating_island', 'small_floating_rock_a', 'small_floating_rock_b', 'floating_grass_platform', 'waterfall_island', 'small_waterfall', 'rope_bridge', 'suspended_single_log', 'suspended_double_log', 'white_cloud'];
  for (let i = 0; i < 40; i++) {
    const a = B.rnd() * Math.PI * 2, r = 105 + B.rnd() * 110;
    const name = FAR[i % FAR.length];
    const h = name === 'white_cloud' ? 14 + B.rnd() * 10 : name.includes('large') ? 16 : 6 + B.rnd() * 8;
    B.sprite(name, Math.cos(a) * r, -10 + B.rnd() * 150, Math.sin(a) * r, h, 0, B.rnd() < 0.5);
  }
  // small props near the stalls and the shortcut hint ring
  B.sprite('small_wooden_crate', 11.8, 0, 36.2, 0.8); B.sprite('small_wooden_crate', -10.6, 0, 18.6, 0.8, 0, true);
  B.sprite('stone_brick_tile', 6, 0.01, 48, 0.35); B.sprite('stone_floor_module', -6, 0.01, 49, 0.4);
  B.sprite('red_jump_ring', 7.6, 96.2, 22.2, 2.2);
}

// edge fence (visual)
for (let i = 0; i < 72; i++) {
  const a = (i / 72) * Math.PI * 2;
  if (i % 9 === 4) continue;
  const r = 82.6;
  B.kitPiece('fence', [Math.cos(a) * r, 1.1, Math.sin(a) * r], [6.6, 1.1], (-a * 180) / Math.PI + 90, { nc: true });
}
// milestones near the main route
const MILESTONES = [25, 50, 75, 100, 125, 140];
const mainPts = B.routes.main.map((q) => q.p);
for (const m of MILESTONES) {
  let best = null;
  for (const p of mainPts) if (p[1] >= m - 0.5 && (!best || p[1] < best[1])) best = p;
  if (best) B.fx.push({ t: 'milestone', p: [r2(best[0] + 1.2), r2(m + 1.6), r2(best[2] + 1.2)], h: m });
}

// =====================================================================================
const val = B.validate(SPAWN, EXIT);
B.checkOverlaps();
const zones = [
  { id: 'A', name: 'Village Spawn', y0: -80, y1: 14, color: '#7bd389' },
  { id: 'B', name: 'Village Parkour', y0: 14, y1: 40, color: '#f6c85f' },
  { id: 'C', name: 'Upper Village', y0: 40, y1: 75, color: '#f08a5d' },
  { id: 'D', name: 'Floating Islands', y0: 75, y1: 112, color: '#6aa9f0' },
  { id: 'E', name: 'Upper Exit', y0: 112, y1: 145, color: '#b48ef0' },
];
const data = B.toJSON({
  id: 'map001', name: 'Starter Village', version: 1, height: 140, origin: [0, 0, 0],
  spawn: { p: SPAWN, yaw: Math.PI },
  // gate: the podium's north edge, where Rooftop City's bridge attaches (closed while the city is not on the device)
  exit: { p: EXIT.map(r2), r: 2.6, next: 'map002', label: 'Map 002 – Rooftop City', gate: { p: [-9, 140, -40.45], yaw: 0, w: 4.8, h: 4.2 } },
  finishHint: 'Gợi ý: Map 001 có 3 đường tắt khó – bạn đã tìm thấy đường nào chưa?',
  zones, milestones: MILESTONES,
  region: { c: [0, 0], r: 85 },
  terrain: {
    radius: 85,
    // Rooftop City floats above the village: the invisible ring wall goes all the way up past its top
    wallTop: 340,
    plazas: [{ p: [0, 37], r: 9 }, { p: [0, 7], r: 12 }, { p: [33, -4], r: 6 }],
    paths: [
      { a: [0, 53], b: [0, 37], w: 3.6 }, { a: [0, 37], b: [0, 7], w: 3.6 }, { a: [0, 7], b: [0, -14], w: 3.6 }, { a: [0, -14], b: [0, -42], w: 3 },
      { a: [0, 7], b: [-26, 9], w: 3 }, { a: [0, 7], b: [33, -4], w: 3 }, { a: [0, 37], b: [-12, 30], w: 2.6 }, { a: [0, -30], b: [-16, -24], w: 2.4 },
    ],
  },
  waypoints: makeWaypoints(B.routes, zones, { S1: 'S1 – đường tắt', S2: 'S2 – mái ẩn', S3: 'S3 – bậu cửa tháp kính' }),
});
fs.writeFileSync(new URL('../public/maps/map001.json', import.meta.url), JSON.stringify(data));
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/routes.json', import.meta.url), JSON.stringify(B.routes));
await plotMap(B, val, new URL('./out/map001_plan.png', import.meta.url).pathname);
console.log(`prefabs ${B.prefabs.length}, kit ${B.kit.length}, sprites ${B.sprites.length}, fx ${B.fx.length}, scenery ${B.scenery.length}`);

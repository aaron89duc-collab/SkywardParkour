# Skyward Parkour – mechanics system (a few dozen mechanics → hundreds of maps)

**Rule 1 – the controls never grow.** Run, steer and jump. Ledge grab, hang and mantle are automatic; letting go
of a ledge is holding the stick away from the wall (there is no drop button). Every new challenge comes from an
object in the world that moves or reacts to the player.

**Rule 2 – the engine ships mechanics, maps are data.** A mechanic is code with a stable id
(`mover:swing`, `jump-pad` …), a JSON parameter set, and a *look* (GLB + solid boxes) that any map can replace.
A new map = a JSON file + GLBs on R2. Only a **new mechanic** needs an app release; one release can add several.

**Rule 3 – every map is checked by machine** before it ships: the route validator (reachability, jump classes,
soft-locks), the mover clearance check (nothing moving passes through anything), and the physics bot (plays every
step of the route with the real controller).

## 1. Mechanic catalog

All of these exist in the engine (`MECHANICS` in `src/content/ContentManager.ts`). Movers live in
`src/world/Movers.ts` (`movers` in the map JSON), devices in `src/world/Devices.ts` (`devices` in the map JSON).
Every device is checked by `devtools/devices.cjs` (20/20) with the real player controller.

| # | Id | Player experience | Main parameters |
|---|---|---|---|
| 1 | `ledge` | grab, hang, shimmy, mantle; let go by holding the stick away from the wall; edge slip / reflex save | – |
| 2 | `ladder` | climb up / down, jump off | height |
| 3 | `jump-pad` | launched to a marked spot | `v`, `tg` |
| 4 | `speed-pad` | dash forward | `v` |
| 5 | `speed-ring` | fly through a hoop, get boosted | `s`, `v` |
| 6 | `mover:crane` | ride a load along a path | `pts`, `speed`, `wait` |
| 7 | `mover:hover` | ride a platform (looks: hover, pallet, lift car, trolley); hang from its edge and ride | `pts`, `speed`, `wait`, `phase` |
| 8 | `mover:swing` | ride a pendulum container, leap at the extremes | `len`, `amp`, `period`, `phase` |
| 9 | `mover:rotor` | ride a turning arm (crane jib) | `a0`, `a1`, `speed`, `wait` |
| 10 | `crumble` | platform shakes when you land and drops after `delay` s, comes back after `respawn` s | `delay`, `respawn` |
| 11 | `blink` | platform solid for `on` s, gone for `off` s (flickers 0.5 s before) | `on`, `off`, `phase` |
| 12 | `conveyor` | the floor carries you along its length | `speed` (m/s, local +z) |
| 13 | `turntable` | spinning disc: carries and turns you | `radius`, `speed` (deg/s) |
| 14 | `tilt` | deck leans towards the end you stand on, springs back | `maxAngle` |
| 15 | `piston` | block slides out of a wall on a cycle and shoves you; ride on top | `stroke`, `period`, `wait`, `phase` |
| 16 | `sweeper` | rotating bar at shin height knocks you off: jump it | `radius`, `speed`, `arms` |
| 17 | `fan` | updraft (or `dir: forward` wind) lifts / pushes you | `s` (stream size), `force`, `on`/`off` |
| 18 | `slippery` | ice: almost no grip, long slides | `grip` |
| 19 | `trampoline` | bounces you back up with most of your landing speed | `bounce`, `min`, `max` |
| 20 | `zipline` | jump into the cable → slide down it; jump to let go | `p` → `b`, `speed` |
| 21 | `plate` | stand on it → its `target` piston slides out / elevator comes | `target`, `hold` |
| 22 | `elevator` | waits until you step on, rides to `b`, waits, comes back | `b`, `speed`, `wait` |
| 23 | `cannon` | walk in → fired along a fixed arc | `r`, `pitch`, `v` |
| 24 | `drop` | crates fall on a schedule: dodge them or ride one down | `fall`, `speed`, `interval` |
| 25 | `portal` | step in → come out of the exit gate with your speed, turned | `b`, `rb` |
| 26 | `lowgrav` | zone of light gravity: huge jumps | `s`, `g` |
| 27 | `oneway` | platform you jump up through from below | – |
| 28 | `checkpoint` | flag: falling out of the map brings you back here (Adventure) | – |
| 29 | `collectible` | optional gem on the risky line (saved per map) | `id` |

## 2. How a map uses a mechanic (data only)

A device entry (`devices` in the map JSON): `t` = id, `p` = top centre (platforms) or base (volumes, triggers),
`s` = size [w, h, d], `r` = yaw, plus its parameters, and optionally `model` = GLB look:
```json
{ "t": "crumble", "id": "c1", "p": [-50, 431, -12], "s": [3, 0.5, 3], "delay": 0.8, "respawn": 3,
  "model": { "file": "assets/map004/rusty_grate", "s": 3 } }
```
Movers carry their parameters and, optionally, their own look:
```json
{ "id": "S7", "kind": "swing", "pivot": [-64, 482, -14], "len": 6.5, "amp": 24, "period": 6.4, "phase": 3.2,
  "model": { "file": "assets/map014/ice_gondola", "s": 5.5,
             "boxes": [[0, -0.18, 0, 0.35, 0.18, 0.2]] } }
```
`model.boxes` = solid parts (centre xyz + half size xyz, model units × `s`, relative to the reference point).
The engine's built-in looks (trolley, lift car, hanging container, crane jib …) are just defaults; a map can
override them per instance (`model`) or per map (`moverModels`), and jump pads take `padModel`.
`content.mjs` derives each map's `mechanics` list automatically; a client lacking any of them shows
"needs an app update" instead of failing.

## 3. Combining without repetition

**Challenge modules** (in `devtools/mapgen`): small set pieces of 1–3 mechanics, 10–40 s each, generated from
parameters and verified. Examples:
- *Relay*: lift → trolley → lift, the hand-over windows overlap only briefly.
- *Anti-phase pair*: two swings / rotors half a period apart: ride one, cross when they meet.
- *Chain bounce*: pad → pad in another direction → narrow landing.
- *Balance under pressure*: narrow beam + sweeper or piston rhythm.
- *Moving rest*: crumble chain that ends on a mover (no standing still).
- *Shortcut line*: an optional harder route (rings, ledges) that skips a slow mover.

**Per-map recipe** (the map config): a theme (GLB set), the new mechanic it introduces, 2–3 known mechanics it
mixes in, 5–7 zones with a difficulty curve (teach → combine → test → breather → finale), one signature set
piece. Rotation rules keep maps fresh:
- each map introduces at most one new mechanic and *teaches* it safely in its first zone;
- a mechanic is not the main one in two maps in a row;
- every ~10 maps a "remix" map recombines older mechanics with new parameters (speed, phase, chains);
- layouts vary: spiral tower, zig-zag halves, shaft, bridge network, floating islands;
- the same GLB set is reused across a themed arc of ~5 maps (small downloads: shared files are stored once).

## 4. Safety rules every map keeps
- Inside the tower, falls end in the same zone (each zone sits above its own start deck, decks alternate halves,
  dividers between the halves). **No outer boundary** (from Map 003 on, user's call 23/11/2026): a player may jump
  off the tower and fall freely – onto Map 003's base deck, a roof of Map 002 or the village. Losing the height is
  part of the challenge. Map streaming keeps up: the maps below come into the world as soon as the player falls into
  the next map's height band (`devtools/out/freefall.cjs`: a fall from 650 m lands in the village after ~17 s, Map 001
  in the world ~9 s before).
- Moving objects run in their own height band or lane; the clearance check must report 0 hits.
- Stackable props collide as closed boxes (`devtools/pipeline/boxcol.mjs`; Map 003's containers): a Meshy shell
  has seams to climb and gaps to slip into. Anyone who still ends up inside a model (boxed in by it on every side) is
  put back outside within a second (`Player.insideCollider` / `escapeFrom`, test: `devtools/out/stucktest.cjs`).
- A lip on a wall (stacked containers, sills) is no footing: the player slides off it and cannot jump from it, so
  spamming jump never walks up a wall (`src/player/Player.ts` lipWallNormal, `devtools/out/climbprobe.cjs`).
- The exit gate opens only when the next map is in the world.

## 5. Route design rule (every map from Map 004 on)
A map is not one straight climb. Each map has:
- **About 3 main routes** to the same goal – easy, medium, hard – that **cross each other often**, so a player can
  climb half a zone the easy way and switch to the hard line where a connection is found (and back).
- **Several hidden routes** (2–4 per map) that skip part of a zone or reward exploration.
- **Discovery mechanics** that make players look around: pressure plates that open a way, gem portals (need N gems),
  blinking platforms, fans / jellies that lift you somewhere unexpected, things that look solid but can be walked
  through (a chocolate waterfall, a house door with an updraft inside), secret ledges behind scenery.
- Every route – main, alternatives and secrets – is a route list in the builder (`B.mark(route, …)`) and is
  **played by the physics bot** (`devtools/bot4.cjs`) before the map ships. The validator must still report no
  shortcut that skips the intended sequence.

Map 004 (Candy Kingdom) as the reference: per zone an easy (`zNeasy`) and a hard (`zNhard`) line next to the main
route, plus secrets – `z2secret` (gingerbread house door → fan out of the chimney → hidden floats), `z4secret`
(walk through the chocolate waterfall → updraft → past the rivers), `z7secret` (updraft hidden in a gumdrop bush by the keep →
secret ledge on the wall with a gem → the rampart) and the gem portal (5 gems → courtyard straight up to the spiral).

## 6. Scenery and ambience (data only)
- `atlas` = the map's own sprite atlas (logical path without extension, `.webp` + `.json`), built from the artist's
  PNGs (`devtools/build-atlas004.mjs`). `sprites` = billboards `{ n, p, h }` from that atlas.
- Optional sprite motion `mv` (older apps draw the sprite still):
  `bob` (a m, s rad/s) · `orbit` (around p, r m, s rad/s, bob a) · `rise` (bubbles: span m at s m/s, then pop) ·
  `drift` (clouds / balloons: span m along yaw d at s m/s, dissolving in and out at the ends). `ph` = phase.
- `fx` `{ t: 'birds', p, r, n?, c? }` = a flock circling p (older apps ignore it).
- Secret updrafts pulse (force ≈ 50): they lift about 1.1 × their height and drop you again, so they reach the hidden
  ledge but can never throw a player up to a later part of the map (`devtools/out/fanmax.cjs` measures the top).
- Prefabs with `col: false` are walk-through decoration (bushes, the chocolate waterfall); invisible `wall` kit
  pieces make a model solid only where it should be (the walk-in gingerbread house).

## 7. Languages
The game is English by default with Vietnamese (Settings → Language, kept on the device). UI text lives in
`src/i18n.ts`. Map content keeps its Vietnamese base text and adds English siblings: zone `name_en`,
`finishHint_en`, sign `m_en`, pack `summary_en` (map001's English zone names have `name_vi`). The builders add them
through `devtools/i18n-content.mjs`; `node devtools/i18n-content.mjs` patches existing map files in place.

## 8. Graphics and smoothness
- Low: no shadow map (the player keeps a blob shadow), 1× resolution, short LOD distance. Medium: 1024 shadow map,
  1.25× resolution. High: 2048 shadows, 2× resolution, glow (bloom).
- The glow pass cleans NaN / infinite pixels first (one broken normal used to turn the whole screen black), uses
  multisampling only where the GPU supports it for half floats, and switches itself off for good (remembered on the
  device, with a message) if frames still come out black.
- Map streaming never blocks for long: prefab collision meshes and kit colliders are built in slices
  (`src/core/Budget.ts` breathe()), new shaders compile with `compileAsync`. Dynamic resolution changes at most once
  every 6 s (each change re-allocates the frame buffers). `devtools/out/perfprobe.cjs` prints draw calls, triangles
  and long tasks; `devtools/out/qualityshot.cjs` checks every preset renders (no black frames).

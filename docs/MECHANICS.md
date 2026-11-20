# Skyward Parkour – mechanics system (a few dozen mechanics → hundreds of maps)

**Rule 1 – the controls never grow.** Move + jump (ledge grab, hang and mantle are automatic). Every new
challenge comes from an object in the world.

**Rule 2 – the engine ships mechanics, maps are data.** A mechanic is code with a stable id
(`mover:swing`, `jump-pad` …), a JSON parameter set, and a *look* (GLB + solid boxes) that any map can replace.
A new map = a JSON file + GLBs on R2. Only a **new mechanic** needs an app release; one release can add several.

**Rule 3 – every map is checked by machine** before it ships: the route validator (reachability, jump classes,
soft-locks), the mover clearance check (nothing moving passes through anything), and the physics bot (plays every
step of the route with the real controller).

## 1. Mechanic catalog

Ids marked ✅ exist (listed in `MECHANICS`, `src/content/ContentManager.ts`). The others are the backlog, roughly in
order of value. Each one: what the player meets → the knobs that set the difficulty.

| # | Id | Player experience | Difficulty knobs |
|---|---|---|---|
| 1 | ✅ `ledge` | grab, hang, shimmy, mantle; edge slip / reflex save | ledge height, gap, catch window |
| 2 | ✅ `ladder` | climb up | height, what waits at the top |
| 3 | ✅ `jump-pad` | launched to a marked spot | launch speed, target height / distance, chained pads |
| 4 | ✅ `speed-pad` | dash forward | dash speed, run-out length |
| 5 | ✅ `speed-ring` | fly through a hoop, get boosted | ring size, chain spacing |
| 6 | ✅ `mover:crane` | ride a load along a path | path, speed, wait |
| 7 | ✅ `mover:hover` | ride a platform (looks: hover, pallet, lift car, trolley) | distance, speed, wait at ends, phase |
| 8 | ✅ `mover:swing` | ride a pendulum container, leap at the extremes | cable length, amplitude, period, two in anti-phase |
| 9 | ✅ `mover:rotor` | ride a turning arm (crane jib) | sweep angle, speed, wait |
| 10 | `crumble` | platform drops 0.6–1.5 s after you land, comes back | delay, respawn time, chain length |
| 11 | `blink` | platforms appear / vanish on a beat (groups in sequence) | on/off time, phase per group |
| 12 | `conveyor` | the floor carries you (with or against your run) | belt speed, direction, length |
| 13 | `turntable` | spinning disc (carry + rotation) | radius, angular speed, gaps between discs |
| 14 | `tilt` | seesaw / tilting deck under your weight | max angle, return speed, friction |
| 15 | `piston` | blocks punch out of walls on a cycle (push / stepping stones) | stroke, period, phase |
| 16 | `sweeper` | rotating bar knocks you off narrow paths (jump it) | bar height, speed, number of arms |
| 17 | `fan` | wind zone: lifts or pushes you | force, area, on/off cycle |
| 18 | `slippery` | ice / oil: low grip, long slides | friction, slope |
| 19 | `trampoline` | bouncy surface: height grows with fall height | restitution, max height |
| 20 | `zipline` | run into the cable → slide; jump to let go | slope, speed, drop-off point |
| 21 | `moving-ledge` | hang from a moving object and ride it | path, speed (ledges on movers) |
| 22 | `plate` | stand on a plate → a bridge / lift / door moves | target, delay, hold time |
| 23 | `elevator-call` | lift that starts when you step on (not on a timer) | travel, speed |
| 24 | `cannon` | step in → launched along a fixed arc | arc, landing size |
| 25 | `drop` | crates / loads fall on a schedule (dodge, or ride down) | interval, warning time |
| 26 | `portal` | paired gates teleport you (keeps momentum) | exit direction, speed kept |
| 27 | `low-gravity` | zone with lighter gravity (huge jumps) | gravity scale |
| 28 | `one-way` | platforms you jump up through | — (combine with others) |
| 29 | `checkpoint` | flag that sets the respawn point inside long maps | spacing |
| 30 | `collectible` | optional pickups on the hard line (score, achievements) | placement risk |

## 2. How a map uses a mechanic (data only)

Every instance in the map JSON carries its parameters and, optionally, its own look:
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
- Falls end inside the same map (each zone sits above its own start deck, decks alternate halves, grate
  dividers between the halves, invisible boundary around the footprint).
- Moving objects run in their own height band or lane; the clearance check must report 0 hits.
- The exit gate opens only when the next map is in the world.

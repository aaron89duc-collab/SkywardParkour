# Smoothness / performance (c33)

Everything here is automatic for every map, including maps added later: no per-map setup.

## Frame pacing
- The frame time comes from the requestAnimationFrame timestamp (display vsync), not from when our code runs.
- Physics runs at a fixed 60 Hz. The player and the moving platforms are drawn interpolated between physics steps,
  and the camera follows the interpolated position.
- Frame-rate limit (Settings → Frame rate, saved as `settings.fpsCap`):
  - **Auto** (-1): on screens of 100 Hz or more where the game cannot keep up (below 85 % of the refresh rate),
    it limits itself to half the refresh rate (e.g. 60 on 120 Hz). Even pacing looks smoother than 70–90 uneven.
  - 30 / 60: a fixed limit. **Max** (0): no limit.
- Android (`MainActivity`):
  - the screen is set to 60 Hz;
  - sustained-performance mode is on where the phone has it (steady clocks, no throttling bursts);
  - the WebView renderer keeps a high priority.
- Camera: frame-rate-independent smoothing. Collision snaps in at once but eases back out only after 0.18 s
  without a hit, so it does not pump in and out along railings.

## No hitches
- **Garbage:** no per-frame allocations in hot paths (particles are pooled, sun shafts use scratch vectors).
  Garbage collection pauses were a main cause of "giật cục".
- **Shader program churn:** `tuneMaterials` (world/Detail.ts):
  - transparent + double-sided materials are drawn in one pass (`forceSinglePass`). Otherwise three.js draws
    them twice and looks their shader up again every frame.
  - a material shared by instanced and plain meshes gets an instanced copy;
  - receive-shadow conflicts are unified.
  - It runs on every map load (full) and every 4 s (cheap part) for things added later.
- **New map streaming in:** `Game.prepareObjects` runs before the map is added to the scene:
  - uploads textures one per frame;
  - draws each new model once into a 1×1 target (uploads vertex buffers), 3 per frame;
  - compiles shaders with `compileAsync`.
  - Compressed meshes (meshopt) are decoded in worker threads.
- **Periodic work spread out:**
  - prefab instance buffers are re-sent only when something changed (they used to be re-sent 5×/s);
  - the HUD writes the DOM only where text changed;
  - audio parameters change at about 12 Hz, and only when the value changes;
  - the save is written every 20 s, and on pause, hide, page hide and finish.
- The black-frame watchdog (`readPixels`, a GPU stall) runs only for the first 10 s after the bloom pipeline is
  set up (high quality only).

## Level of detail (world/Detail.ts, world/Prefabs.ts)
Distances grow with an object's size (bounding radius r). The simplification error is relative to the size, so a
crate switches early and a tower late, and the error on screen stays about the same.
- **Prefabs (instanced):**
  - **lod0** (full model) while d < max(lod0Min, r·lod0K).
  - **lod1** while
    d < max(lod1Min, r·lod1K).
    - The lod1 is simplified here from lod0 (25 %, worker, texture seams kept).
    - The lod1 inside the model files is used only when that fails: it often has a broken texture (the asset
      pipeline welded the seams), so it must not be seen up close.
    - Within `shadowDist` the lod1 copy casts shadows (`*_lod1s`).
  - **lod2** (lod1 simplified to 30 %, seams kept) beyond that, when it can be made.
  - **not drawn** when d > max(cullMin, r·cullK).
  - Instance buffers are re-sent only when an instance changes level.
- **Other meshes** (kit, devices, movers, boosters, effects): the `Culler` per map, plus one for the effects group.
  - A mesh with 1500 or more triangles gets an 18 % far copy (worker) beyond max(2·lod0Min, 2·r·lod0K).
  - Small things far away are hidden.
  - Hiding uses `layers.mask = 0`, never `visible`, so the game's own show / hide logic is not touched.
  - Objects with `userData.noCull = true` are skipped.
- Settings per quality (config.ts `QUALITY_PRESETS`):

  Models whose lod1 could be made here ("good", Map 004+ models) switch to it earlier (`lod0KGood` / `lod0MinGood`).
  Models that rely on the file's lod1 (Map 001–003 models: seams everywhere) keep lod0 as long as before c34.

  | quality | lod0K / lod0Min (file lod1) | lod0KGood / lod0MinGood | lod1K / lod1Min | shadowDist | cullK / cullMin |
  |---|---|---|---|---|---|
  | low | 4 / 16 | 3 / 7 | 9 / 30 | 0 | 110 / 70 |
  | medium | 6 / 26 | 4.5 / 10 | 13 / 45 | 28 | 170 / 100 |
  | high | 10 / 45 | 7 / 18 | 22 / 80 | 40 | 280 / 170 |

  Map 004 (medium, 48 views) after c35: 0.72 M triangles on average (1.53 M before c34).

- Sun shafts and the lens flare (`effects`) are drawn only on high.

## PNG props (world/Sprites.ts, c35)
Every 250 ms the props worth drawing are copied to the front of the instance buffers:
- all props within 30 m; beyond that only a share of them (`spriteDensity`: 0.3 / 0.5 / 0.75), chosen by a
  stable hash per prop;
- only while distance < height × `spriteK` (8 / 12 / 18);
- never when more than 60 m below the camera, or seen steeply from above;
- the shader also dissolves a prop seen steeply from above or below (a billboard is a thin card from there).

Example: map001 at the ground draws 126 of 513, at 70 m 13 of 513. Map 004–007 draw about 10–55 of 70–170.

Objects whose positions live in a shader (`frustumCulled = false`) are skipped by the generic `Culler`.

## Physics step
- Moving platforms and devices refresh Rapier's query pipeline once per step for all maps. It used to be once per
  map plus once more.
- The list of device systems is cached.
- No allocations in `Devices.step`, `place` or `fanDistance`.

## Measured (sandbox, medium, average of 48 views)

| map | triangles before | triangles after | change |
|---|---|---|---|
| map004 | 1.53 M | 0.65 M | −57 % |
| map007 | 0.71 M | 0.41 M | −42 % |

- Worst view on map004: 2.19 M → 0.92 M triangles.
- Garbage per frame: map001 354 → about 80 KB; map004 84 KB after the device fixes.
- Shader look-ups per frame: 22 → 0.
- CPU per frame without drawing (map007): 2.32 → 1.48 ms.

## Probes (devtools/out)
- `stutter.cjs <map> <secs> <quality>`: per-frame breakdown of the game loop, worst frames, heap growth.
- `allocprof.cjs <map> <frames>`: which functions allocate per frame.
- `progchurn.cjs <map>`: materials whose shader is looked up again every frame (should be none).
- `viewcost.cjs <map> [nocull]`: average / worst draw calls and triangles over 48 views (nocull = old behaviour).
- `tribreak.cjs <map>`: triangles / draw calls per part of the scene.
- `whotris.cjs <map> <0|1|2>`: which objects carry the triangles in one view (main pass and shadow pass).
- `cpuprof.cjs <map> [frames] [norender]`: CPU profile of the loop (one physics step per frame), hottest functions.
- Note: headless SwiftShader is GPU-bound. Use the probes for counts and CPU work, not for absolute FPS.

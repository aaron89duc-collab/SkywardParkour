# SKYWARD PARKOUR — Map 001

Prototype **Only Up-inspired** 3D cartoon, built with **Three.js + TypeScript + Rapier + Vite**. PC and mobile web work from one shared codebase. Deploy to Vercel as a static Vite site.

## Game rules

- WASD / arrow keys: move; Space: jump; drag mouse on scene: orbit camera.
- Mobile: left virtual joystick, tap **NHẢY**, swipe the scene on the right to orbit camera.
- If you miss a platform, **you fall naturally** until you land on a lower platform or the ground; keep playing from there. **There is no automatic death or respawn**.
- **ĐỘ CAO** = highest altitude reached during this run. It never decreases after a fall.
- **KỶ LỤC** = highest altitude across all sessions, saved in `localStorage`.
- Only the **CHƠI LẠI TỪ ĐẦU** button in the pause menu explicitly returns the player to spawn.
- Map 001 contains 30 ascending fixed platforms, 6 lower recovery decks, and a large ground plane.

## Requirements

- Node.js 20.19+ or 22.12+ (recent Vite requires a compatible version).
- Browser with WebGL2, preferably a current Chrome, Edge or Safari.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`). To test on a phone on the same Wi-Fi, open your computer's LAN IP at port 5173 and allow the firewall if needed.

## Production build

```bash
npm run build
npm run preview
```

The resulting static site is in `dist/`.

## Deploy to Vercel

1. Push these files to GitHub.
2. On Vercel, choose **New Project → Import Git Repository**.
3. Vercel should detect **Vite**; build command is `npm run build`, output is `dist` (also configured in `vercel.json`).
4. Deploy. No API keys, Supabase project or backend are needed for this MVP.

Do **not** upload `node_modules` or `dist` to Git. Vercel will install dependencies and build.

## Append maps later without rewriting game logic

The world definition is data driven:

- `public/maps/manifest.json` lists the map modules in load order.
- `public/maps/map-001.json` defines platform coordinates, dimensions, top surface elevations, safe landing decks, initial spawn and finish marker.
- `src/world/MapLoader.ts` reads the manifest and turns the JSON into THREE meshes and **matching Rapier cuboid colliders**.
- `src/core/Game.ts` does not know or care how many map modules exist.

For Map 002:

1. Create `public/maps/map-002.json` with the same schema as Map 001.
2. Make the last platform of Map 001 connect to the first of Map 002. If authoring coordinates relative to the new module origin, apply a fixed `{x,y,z}` `offset` in `manifest.json`.
3. Append `{ "id": "map-002", "src": "/maps/map-002.json", "offset": {"x": 0, "y": 43, "z": -11} }` to `maps`. Adjust coordinates to connect physically.
4. Increase `finish.y` in the added map. The Game scores the altitude in absolute world Y without a hardcoded cap.
5. Publish to Git/Vercel again.

**MVP note:** This version loads all JSON map modules at startup. As the world grows, add distance-based segment loading/unloading and LOD in `MapLoader` (loading only the current + nearby modules). The manifest schema is already designed for this.

## Replacing primitives with Meshy AI assets

Export stylized models from Meshy as **GLB/GLTF** and save under `public/assets/`.

1. Load visual meshes with Three.js `GLTFLoader` (from `three/addons/loaders/GLTFLoader.js`).
2. Place imported models at the JSON coordinates and scale to the existing primitive dimensions.
3. Keep the original **simple Rapier box collider** unless you require more detailed traversal. Do not automatically use high-poly AI triangle meshes as physics colliders.
4. Prefer instancing, shared materials, 512px/1024px textures and a controlled triangle budget on mid-range phones.

The first playable deliberately uses **zero third-party 3D assets**, so it works before creating Meshy models.

## Technical notes

- `src/player/PlayerController.ts`: Rapier kinematic capsule, coyote time, jump buffering, acceleration/friction, gravity, ceiling response and 60Hz fixed time step.
- `src/player/ThirdPersonCamera.ts`: mouse/touch orbit, spring-arm raycasting against platforms, smoothing.
- `src/input/InputController.ts`: common keyboard and mobile touch actions.
- `src/core/Game.ts`: rendering, fixed update, pause, runs, height-based scoring, local record.
- `src/ui/GameUI.ts`: menu, mobile HUD and milestone notifications.

### Current prototype scope / exclusions

- Basic run/jump only; **ledge grabbing / climbing animation** is not implemented yet.
- No multiplayer, account system, remote leaderboard, daily challenges, AdMob, or map editor yet.
- No GLB models yet; the geometry uses colored boxes, cylinders and spheres.
- Map 001 is hand-authored and repeatable, not procedural.
- Physics/controls need in-device playtesting to tune feel and difficulty for different screen sizes and input devices.

## Game feel constants

In `src/player/PlayerController.ts`:

- `MOVE_SPEED` — horizontal running speed.
- `GROUND_ACCEL` and `AIR_ACCEL` — acceleration on ground vs in air.
- `JUMP_SPEED` and `GRAVITY` — jump height and hang time.
- `COYOTE_TIME` and `JUMP_BUFFER` — forgiving jump timing.

Route platform positions and widths in `public/maps/map-001.json` are the main difficulty knobs.

## Attribution

This is an original starter implementation inspired by a *genre* of 3D vertical parkour games. No original Only Up assets, code or map content are included.

# Skyward Parkour – content protocol v2 (R2 dynamic map loading)

One protocol for every client (web app now, Android app later). The app ships the **engine** (mechanics,
renderer, physics) plus Map 001; every other map is **data** on Cloudflare R2. Adding or updating maps never
needs an app release, as long as the map only uses mechanics the app already has.

## Server layout (R2 bucket, public URL = `CONTENT_URL`)

| Object | Cache | Content |
|---|---|---|
| `catalog.json` | 60 s | Every map, one short entry each (no file lists). The only object that changes. |
| `files/<sha256>` | 1 year, immutable | Every asset (GLB, collision mesh, map JSON, atlas) **and** every pack manifest, named by the SHA-256 of its bytes. |
| `manifest.json` | 60 s | Protocol v1 (all maps with their file lists) for app builds released before v2. Can be dropped once those are gone. |

### `catalog.json`
```json
{ "schema": 2, "generated": "2026-11-20T…",
  "maps": [ { "id": "map003", "name": "Container Port", "order": 3, "yMin": 318, "yMax": 560,
              "entry": "maps/map003.json", "version": 1, "hash": "<pack content hash>",
              "minApp": 2, "mechanics": ["jump-pad", "ladder", "mover:hover", "mover:rotor", "mover:swing"],
              "requires": [], "summary": "…", "size": 21000000, "files": 61,
              "pack": "<sha256 of the pack manifest>" } ] }
```
Optional `summary_en` = the English summary (the base `summary` is Vietnamese; apps without it show `summary`).
About 300 bytes per map: 500 maps ≈ 150 KB (≈ 20 KB gzipped). `mechanics` uses the ids of `docs/MECHANICS.md`
(movers and devices alike: `mover:swing`, `crumble`, `zipline` …).

### Pack manifest (`files/<pack>`)
```json
{ "schema": 2, "id": "map003", "version": 1, "hash": "…", "entry": "maps/map003.json",
  "files": { "maps/map003.json": ["<sha256>", 81234], "assets/map003/trolley_car.glb": ["<sha256>", 402113] } }
```
Keys are **logical paths**: the game asks for `assets/map003/trolley_car.glb`, the client maps it to
`files/<sha256>` stored on the device.

## Client rules
1. Start-up never needs the network: Map 001 is in the app, downloaded maps are on the device.
2. When online, read `catalog.json` (falls back to `manifest.json`). A map is offered when
   `minApp <= APP_CONTENT_VERSION` **and** every entry of `mechanics` is implemented by this build.
   Otherwise it is listed as "needs an app update".
3. Download = read the pack manifest (verify its SHA-256 = its name, `id` and `hash` match), download the
   files not already on the device (verify size + SHA-256), then switch to the new version in one write.
   Files shared by several maps (same hash) are stored once.
4. Packs are **self-contained**: a map's pack lists every downloadable file its map JSON uses, even ones that
   live in another map's folder. Any map can be installed, played and removed on its own.
5. `requires` lists real dependencies only (Map 002 needs Map 001 under it). From Map 003 on, every map
   catches its own falls, so `requires` is empty.
6. Automatic: the next 3 maps above the furthest map played are downloaded in the background. Storage stays
   bounded: beyond 10 downloaded maps, the ones farthest from the player are removed (they come back when needed).
7. Only the map being played, two below and one above are in the world at once (streaming). The others stay on
   the device until the player gets near them.

## Publishing (no npm, only commits)
- Commit a map folder `packs/mapNNN/` (pack.json + maps/ + assets/). The GitHub Action
  `publish-maps.yml` runs `node devtools/content.mjs publish`: new files first, pack manifests, then
  `manifest.json` and `catalog.json` last (a client never sees a list that points at missing files).
- Commits that only touch `packs/` or `docs/` do **not** rebuild the site on Vercel (`vercel.json` →
  `ignoreCommand`). Engine changes (new mechanics) do, and raise `APP_CONTENT_VERSION` / the mechanic list.

## Android (later)
Same server, same catalog, same pack manifests. The Android app implements the same mechanic ids and
stores `files/<sha256>` in app storage. Map 001 can be bundled in the APK exactly like on the web.

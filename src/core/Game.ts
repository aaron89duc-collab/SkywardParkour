import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PHYS, QUALITY_PRESETS, detectDefaultQuality, lowerQuality, minQuality, type Quality } from '../config';
import { Physics } from './Physics';
import { Assets } from './Assets';
import { Input } from '../input/Input';
import { TouchControls, isTouchDevice } from '../input/TouchControls';
import { Player } from '../player/Player';
import { CharacterModel } from '../player/CharacterModel';
import { ThirdPersonCamera, type CamMode } from '../camera/ThirdPersonCamera';
import { Environment } from '../world/Environment';
import { Clouds } from '../world/Clouds';
import { MapManager } from '../world/MapManager';
import type { MapData, ZoneData } from '../world/MapTypes';
import { Effects } from '../fx/Effects';
import { installHeightFog } from '../world/HeightFog';
import { UI } from '../ui/UI';
import { AudioEngine } from '../systems/Audio';
import { Score, loadSave, writeSave, challengeOf, type SaveData, type GameMode } from '../systems/Score';
import { Achievements, type AchDef } from '../systems/Achievements';
import { Admin } from '../systems/Admin';
import { ContentManager } from '../content/ContentManager';
import { AutoSync, type SyncView } from '../content/AutoSync';
import { Leaderboard } from '../online/Leaderboard';
import { OnlineUI } from '../ui/OnlineUI';
import type { MenuInfo } from '../ui/UI';
import { enterFullscreen, fullscreenSupported, isFullscreen, toggleFullscreen } from '../ui/Fullscreen';

type GameState = 'loading' | 'menu' | 'playing' | 'paused' | 'finished';
type CharId = 'male' | 'female';

export class Game {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  physics!: Physics;
  assets = new Assets();
  cam!: ThirdPersonCamera;
  env!: Environment;
  clouds!: Clouds;
  fx!: Effects;
  maps!: MapManager;
  map!: MapData;
  player!: Player;
  input!: Input;
  touch: TouchControls | null = null;
  ui!: UI;
  audio = new AudioEngine();
  save: SaveData;
  score: Score;
  quality: Quality;
  state: GameState = 'loading';
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private characters: Partial<Record<CharId, CharacterModel>> = {};
  private charId: CharId = 'male';
  private clock = new THREE.Clock();
  private acc = 0;
  private time = 0;
  private hudTimer = 0;
  private fpsAvg = 60;
  private reachedMilestones = new Set<number>();
  private reachedZones = new Set<string>();
  private finishedMaps = new Set<string>();
  private simTime = 0;
  private hudMap: MapData | null = null;
  private dropShadow!: THREE.Mesh;
  private startMap = 'map001';
  private isTouch = isTouchDevice();
  private sensitivity = 1;
  private lastZone: ZoneData | null = null;
  /** admin / map-test mode (hidden; see systems/Admin.ts) */
  admin: Admin | null = null;
  /** maps: inside the app + downloaded (offline-first, see content/ContentManager.ts) */
  content = new ContentManager();
  autoSync!: AutoSync;
  private syncKind: SyncView['kind'] = 'idle';
  private slipAt = -99;
  lb!: Leaderboard;
  private lbTimer = 30;
  /** Adventure (continue from conquered maps) or Challenge (always from 0 m, records + achievements only) */
  mode: GameMode = 'adventure';
  ach!: Achievements;
  private achMax = 0;
  private adminPrompt = false;

  constructor(private container: HTMLElement) {
    installHeightFog();
    this.save = loadSave();
    this.score = new Score(this.save);
    this.quality = this.save.settings.quality ?? this.autoQualityStart();
    this.sensitivity = this.save.settings.sensitivity;
    this.charId = this.save.character;
  }

  async init() {
    const preset = QUALITY_PRESETS[this.quality];
    this.ui = new UI(this.container, {
      onStart: (id, mode) => void this.start(id ?? undefined, mode),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onMainMenu: () => this.toMenu(),
      onCharacter: (c) => void this.setCharacter(c),
      onVolume: (v) => { this.save.settings.volume = v; this.audio.setVolume(v); writeSave(this.save); },
      onQuality: (q) => { this.applyQuality(q); this.save.settings.quality = q; writeSave(this.save); },
      onSensitivity: (v) => { this.sensitivity = v; this.save.settings.sensitivity = v; writeSave(this.save); },
      onShowFps: (v) => { this.save.settings.showFps = v; writeSave(this.save); },
      onAutoCam: (v) => { this.save.settings.autoCam = v; this.cam.autoFollow = v; writeSave(this.save); },
      onPause: () => this.pause(),
      onClick: () => { this.audio.init(); this.audio.click(); },
      onFullscreen: () => toggleFullscreen(),
      menuInfo: () => this.menuInfo(),
      onAchievements: () => this.ui.online?.openAchievements(this.ach.list().map((d) => ({ title: d.title, desc: d.desc, at: this.save.challenge?.achievements[d.id] ?? null }))),
    }, this.isTouch);
    this.ui.bindSave(this.save, this.quality);
    this.assets.onProgress = (d, t) => this.ui.setLoading(t ? d / t : 0);

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio, Math.sqrt(preset.maxPixels / Math.max(1, window.innerWidth * window.innerHeight))));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game';
    this.renderer.domElement.tabIndex = 0;
    this.container.prepend(this.renderer.domElement);

    await Physics.init();
    this.physics = new Physics();
    this.cam = new ThirdPersonCamera(this.physics, window.innerWidth / window.innerHeight);
    this.cam.autoFollow = this.save.settings.autoCam ?? this.isTouch;
    this.input = new Input(this.renderer.domElement);
    // losing the mouse pauses the game, except while the admin is typing a password or using the admin panel
    this.input.onPointerLockLost = () => { if (this.state === 'playing' && !this.adminPrompt && !this.admin?.wantsCursor) this.pause(); };
    if (this.isTouch) this.touch = new TouchControls(this.input, this.container);

    this.env = new Environment(this.scene, this.renderer, { shadows: preset.shadows, shadowMap: preset.shadowMap, flare: this.quality !== 'low' });
    this.clouds = new Clouds(this.scene, preset.clouds);
    this.fx = new Effects(this.scene);
    this.fx.addBirds(3);
    this.fx.dust.setViewport(window.innerHeight);
    this.fx.sparkles.setViewport(window.innerHeight);

    this.maps = new MapManager(this.assets, this.physics, this.scene, this.fx);
    this.ui.setLoading(0.05, 'Đang dựng Starter Village…');
    // no network needed here: the app's own maps + whatever was downloaded before
    await this.content.init();
    this.assets.resolver = this.content.resolve;
    this.maps.onLoadStart = (id) => this.content.pin(id);
    this.content.onChange(() => { this.maps.syncGates((id, fb) => this.nextInfo(id, fb)); this.ui.refreshMaps?.(); });
    this.maps.setRegistry(this.content.entries());
    await this.maps.load(this.maps.registry[0]);
    this.map = this.maps.primary!;
    this.maps.setLodDistance(preset.lodDistance);

    this.player = new Player(this.physics, this.scene);
    this.player.hooks = this.maps;
    this.maps.playerFeet = () => ({ y: this.player.feetY, rising: this.player.vel.y > 0.5 });
    this.maps.collected = this.save.collected ?? [];
    this.player.spawnPoint.set(...this.map.spawn.p);
    this.player.spawnYaw = this.map.spawn.yaw;
    this.ui.setLoading(0.9, 'Đang gọi nhân vật…');
    await Promise.all([this.loadCharacter('male'), this.loadCharacter('female')]);
    this.equip(this.charId);
    this.player.teleport(this.player.spawnPoint, this.player.spawnYaw);
    this.physics.step();

    this.setupComposer(preset.bloom);
    this.setHudMap(this.map);
    this.dropShadow = this.makeDropShadow();
    window.addEventListener('resize', () => this.onResize());
    window.visualViewport?.addEventListener('resize', () => this.onResize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.onResize(), 50));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); this.score.flush(); });
    window.addEventListener('beforeunload', () => this.score.flush());

    // warm-up render so shaders compile before the menu appears
    this.cam.yaw = 0.5;
    this.cam.orbit(0, new THREE.Vector3(this.map.spawn.p[0], this.map.spawn.p[1], this.map.spawn.p[2] - 10), 22, 9);
    this.renderer.compile(this.scene, this.cam.camera);
    const portraits = this.makePortraits();
    this.ui.hideLoading();
    this.admin = new Admin({
      player: this.player, cam: this.cam, input: this.input, maps: this.maps, physics: this.physics, touch: this.touch,
      isPlaying: () => this.state === 'playing',
      allowed: () => this.mode !== 'challenge',
      markTestRun: () => {
        if (this.score.test) return;
        this.score.test = true;
        this.ui.setTestBadge(true);
        this.ui.toast('Lượt TEST', 'Đã dùng chế độ admin: lượt này không lưu kỷ lục');
      },
      toast: (a, b) => this.ui.toast(a, b ?? ''),
      where: () => `${this.map.name}${this.lastZone ? ' · Khu ' + this.lastZone.id : ''} · ${this.player.state}`,
      setGameInput: (on) => {
        this.adminPrompt = !on;
        this.input.enabled = on && this.state === 'playing';
        if (!on) this.input.clearEdges();
      },
    }, this.container, this.ui.hudHeightEl);
    this.state = 'menu';
    this.setupOnline();
    this.ui.showMenu(this.save, portraits, this.quality);
    // first launch: the player picks a name (works offline; sent to the leaderboard when online)
    if (!this.lb.hasName) { this.ui.online!.onNameSet = () => { this.ui.refreshMaps(); void this.lb.sync(); }; this.ui.online!.openName(true); }
    else void this.lb.sync();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
    (window as unknown as { __game: Game }).__game = this;
    // the city above the clouds streams in behind the menu (seamless world: it is visible from the village)
    this.startDevPacks();
    void this.loadOtherMaps();
    // online? (background, short timeout, never blocks play) -> the next maps download by themselves
    if (this.devPacks) void this.devPacks.then(() => this.autoSync.kick());
    else this.autoSync.kick();
  }

  private otherMaps: Promise<void> | null = null;
  private devPacks: Promise<void> | null = null;
  /**
   * Map streaming: the world holds only the map being played, the two below it (the way back down, the view)
   * and the next one above (its gate opens once it is in the world). Any number of maps can exist: the rest stay
   * on the device (or on the server) until the player gets near them. Chained: safe to call any time (after
   * startup, after a download, whenever the player enters another map).
   */
  static readonly STREAM_BELOW = 2;
  static readonly STREAM_ABOVE = 1;
  loadOtherMaps(centerId?: string) {
    this.otherMaps = (this.otherMaps ?? Promise.resolve()).then(async () => {
      if (this.devPacks) await this.devPacks;
      this.maps.setRegistry(this.content.entries());
      const reg = this.maps.registry;
      let c = reg.findIndex((e) => e.id === (centerId ?? this.map?.id));
      if (c < 0) c = 0;
      const lo = Math.max(0, c - Game.STREAM_BELOW), hi = Math.min(reg.length - 1, c + Game.STREAM_ABOVE);
      const gone = this.maps.retain(lo, hi);
      let added = false;
      for (const e of reg.slice(lo, hi + 1)) {
        if (this.maps.map(e.id)) continue;
        try { await this.maps.load(e); added = true; } catch (err) { console.warn('map load failed', e.id, err); }
      }
      if (added) {
        this.maps.setLodDistance(QUALITY_PRESETS[this.quality].lodDistance);
        this.renderer.compile(this.scene, this.cam.camera);
      }
      if (added || gone.length) this.admin?.mapsChanged();
      this.syncGates();
    });
    return this.otherMaps;
  }

  /** `npm run dev`: keep every pack from packs/ installed and current (no download menu needed while
   *  building maps). Off with ?autopacks=0 to try the real player flow. */
  private startDevPacks() {
    if (!import.meta.env.DEV || new URLSearchParams(location.search).get('autopacks') === '0') return;
    this.devPacks = (async () => {
      if (!(await this.content.check(15000))) return;
      for (const s of this.content.statuses()) {
        if (s.state === 'download' || s.state === 'update') {
          try { await this.content.install(s.id); } catch (e) { console.warn('dev pack install failed', s.id, e); }
        }
      }
    })();
  }

  /** Blob shadow projected straight down while airborne: shows where you will land, and how far below that is. */
  private makeDropShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grd.addColorStop(0, 'rgba(10,20,40,0.85)');
    grd.addColorStop(0.55, 'rgba(10,20,40,0.45)');
    grd.addColorStop(1, 'rgba(10,20,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true }));
    m.renderOrder = 5;
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  private updateDropShadow() {
    const P = this.player;
    const air = P.state === 'air' || P.state === 'hang' || P.state === 'ladder' || (P.state === 'move' && P.moveKind !== 'climb');
    const ds = this.dropShadow;
    const mat = ds.material as THREE.MeshBasicMaterial;
    if (!air) { mat.opacity = Math.max(0, mat.opacity - 0.12); ds.visible = mat.opacity > 0.01; return; }
    const from = P.renderPos.clone().add(new THREE.Vector3(0, 0.3, 0));
    const hit = this.physics.raycast(from, new THREE.Vector3(0, -1, 0), 160);
    if (!hit) { ds.visible = false; return; }
    const drop = hit.distance - 0.3;
    const want = 0.62 * (1 - THREE.MathUtils.smoothstep(drop, 25, 140)) * THREE.MathUtils.smoothstep(drop, 0.25, 1.2);
    mat.opacity += (want - mat.opacity) * 0.3;
    ds.visible = mat.opacity > 0.01;
    ds.position.copy(hit.point).addScaledVector(hit.normal, 0.04);
    ds.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
    ds.scale.setScalar(0.85 + Math.min(1.6, drop * 0.02));
  }

  private setHudMap(m: MapData) {
    this.hudMap = m;
    const y0 = m.origin[1];
    this.ui.setupHUD(m.zones, y0, y0 + m.height, this.score.best);
  }

  private async loadCharacter(id: CharId) {
    if (this.characters[id]) return this.characters[id]!;
    const gltf = await this.assets.gltf(`assets/characters/hero-${id}.glb`);
    const m = new CharacterModel(gltf, id);
    this.characters[id] = m;
    return m;
  }

  private equip(id: CharId) {
    const m = this.characters[id]!;
    for (const c of Object.values(this.characters)) if (c && c !== m) c.root.removeFromParent();
    this.scene.add(m.root);
    m.root.position.copy(this.player.renderPos);
    this.player.setModel(m);
    this.charId = id;
  }

  async setCharacter(id: CharId) {
    await this.loadCharacter(id);
    this.equip(id);
    this.save.character = id;
    writeSave(this.save);
  }

  private makePortraits(): Record<string, string> {
    const out: Record<string, string> = {};
    const r = this.renderer;
    const size = new THREE.Vector2();
    r.getSize(size);
    const S = Math.min(256, Math.floor(size.y * 0.4));
    const sc = new THREE.Scene();
    sc.background = new THREE.Color('#9fd0ff');
    sc.environment = this.scene.environment;
    sc.add(new THREE.HemisphereLight('#ffffff', '#88a368', 1.6));
    const dl = new THREE.DirectionalLight('#fff3dd', 2.4);
    dl.position.set(1, 2, 3);
    sc.add(dl);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    for (const id of ['male', 'female'] as CharId[]) {
      const m = this.characters[id];
      if (!m) continue;
      const parent = m.root.parent;
      const pos = m.root.position.clone();
      const rot = m.root.rotation.y;
      sc.add(m.root);
      m.root.position.set(0, 0, 0);
      m.root.rotation.y = 0.35;
      m.play('idle', 0);
      m.update(0.4);
      const h = m.height;
      cam.position.set(0.3, h * 0.78, 2.5);
      cam.lookAt(0, h * 0.66, 0);
      r.setScissorTest(true);
      r.setViewport(0, 0, S, S);
      r.setScissor(0, 0, S, S);
      r.render(sc, cam);
      const dpr = r.getPixelRatio();
      ctx.clearRect(0, 0, 192, 192);
      ctx.drawImage(r.domElement, 0, r.domElement.height - S * dpr, S * dpr, S * dpr, 0, 0, 192, 192);
      out[id] = canvas.toDataURL('image/png');
      r.setScissorTest(false);
      r.setViewport(0, 0, size.x, size.y);
      m.root.position.copy(pos);
      m.root.rotation.y = rot;
      if (parent) parent.add(m.root); else m.root.removeFromParent();
    }
    return out;
  }

  private setupComposer(bloom: boolean) {
    if (!bloom) { this.composer = null; this.bloom = null; return; }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.cam.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.9);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  applyQuality(q: Quality) {
    this.quality = q;
    this.dynScale = 1;
    const p = QUALITY_PRESETS[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
    this.env.setShadows(p.shadows, p.shadowMap);
    if (this.env.flare) this.env.flare.visible = q !== 'low';
    this.env.shafts.enabled = q !== 'low';
    this.maps.setLodDistance(p.lodDistance);
    this.setupComposer(p.bloom);
    this.onResize();
  }

  // ---- adaptive performance: lower the render resolution first, then (if the player never picked a
  // quality by hand) step the quality preset down. The lowered level is remembered for the next visit.
  private static AUTOQ_KEY = 'skyward-parkour.autoq';
  private autoQualityStart(): Quality {
    const det = detectDefaultQuality();
    try {
      const v = localStorage.getItem(Game.AUTOQ_KEY) as Quality | null;
      if (v === 'low' || v === 'medium' || v === 'high') return minQuality(det, v);
    } catch { /* storage unavailable */ }
    return det;
  }
  private dynScale = 1;
  private dynTimer = 0;
  private fpsWindow: number[] = [];
  private slowWindows = 0;
  private adaptResolution(dt: number) {
    if (this.state !== 'playing') { this.fpsWindow = []; this.dynTimer = 0; return; }
    this.fpsWindow.push(dt);
    this.dynTimer += dt;
    if (this.dynTimer < 2) return;
    const avg = this.fpsWindow.length / this.fpsWindow.reduce((a, b) => a + b, 0);
    this.fpsWindow = [];
    this.dynTimer = 0;
    const target = this.isTouch ? 30 : 50;
    const minScale = 0.6;
    let next = this.dynScale;
    if (avg < target * 0.85) {
      next = Math.max(minScale, this.dynScale - 0.12);
      if (this.dynScale <= minScale + 1e-3) this.slowWindows++;
    } else {
      this.slowWindows = 0;
      if (avg > target * 1.45) next = Math.min(1, this.dynScale + 0.08);
    }
    if (this.slowWindows >= 2 && this.save.settings.quality == null) {
      const lower = lowerQuality(this.quality);
      if (lower) {
        this.slowWindows = 0;
        this.applyQuality(lower);
        this.dynScale = 0.85;
        this.onResize();
        try { localStorage.setItem(Game.AUTOQ_KEY, lower); } catch { /* ignore */ }
        this.ui.toast('Đã giảm chất lượng đồ hoạ', 'Để game chạy mượt hơn — đổi lại trong Cài đặt');
        this.ui.bindSave(this.save, this.quality);
        return;
      }
    }
    if (Math.abs(next - this.dynScale) > 0.01) {
      this.dynScale = next;
      this.onResize();
    }
  }

  private onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const p = QUALITY_PRESETS[this.quality];
    const budget = Math.sqrt(p.maxPixels / Math.max(1, w * h));
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(window.devicePixelRatio, p.pixelRatio, budget) * this.dynScale));
    this.renderer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.baseFov = w < h ? 72 : 60;
    this.cam.camera.fov = this.cam.baseFov;
    this.cam.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
    this.fx.dust.setViewport(h);
    this.fx.sparkles.setViewport(h);
  }

  // ------------------------------------------------------------------ flow
  /** id of the bottom map (the app's own Starter Village) */
  private get firstMapId() { return this.maps.registry[0]?.id ?? 'map001'; }
  /** position of a map in the column (bottom = 0) */
  private mapIndex(id: string | null) { return id ? this.maps.registry.findIndex((e) => e.id === id) : -1; }

  async start(mapId?: string, mode?: GameMode) {
    this.mode = mode ?? this.save.mode ?? 'adventure';
    this.save.mode = this.mode;
    this.score.mode = this.mode;
    // Challenge: every run starts at 0 m – no continuing from a higher map, no teleports
    mapId = this.mode === 'challenge' ? this.firstMapId : mapId ?? this.firstMapId;
    // phones: go fullscreen + landscape straight from the START tap (needs the user gesture)
    if (this.isTouch && fullscreenSupported() && !isFullscreen()) enterFullscreen();
    this.audio.init();
    this.audio.setVolume(this.save.settings.volume);
    this.ui.hideMenu();
    if (!this.maps.map(mapId)) {
      this.ui.showLoading(`Đang dựng ${this.maps.entry(mapId)?.name ?? 'bản đồ'}…`);
      await this.loadOtherMaps(mapId);
      this.ui.hideLoading();
    }
    const m = this.maps.map(mapId) ?? this.maps.map(this.firstMapId)!;
    this.startMap = m.id;
    this.player.spawnPoint.set(...m.spawn.p);
    this.player.spawnYaw = m.spawn.yaw;
    this.ui.showHUD(true);
    this.touch?.setVisible(true);
    this.restart();
    this.state = 'playing';
    this.input.enabled = true;
    if (!this.isTouch) this.ui.setHint('Nhấp chuột vào màn hình để điều khiển camera');
  }

  restart() {
    this.ui.hidePause();
    this.player.teleport(this.player.spawnPoint, this.player.spawnYaw);
    this.cam.snapTo(this.player.spawnPoint, this.player.spawnYaw + Math.PI);
    this.cam.pitch = 0.3;
    this.score.resetRun();
    this.ui.setTestBadge(false);
    this.ui.setModeBadge(this.mode === 'challenge');
    this.admin?.reset();
    if (this.mode === 'challenge') { challengeOf(this.save).runs++; writeSave(this.save); }
    this.ach.startRun();
    this.achMax = 0;
    this.reachedMilestones.clear();
    this.reachedZones.clear();
    this.fx.milestones.forEach((m) => (m.reached = false));
    this.finishedMaps.clear();
    // a run that starts in the city counts the village as done (and its milestones as passed)
    // a run that starts higher up counts the maps below as done (and their milestones as passed)
    const si = this.mapIndex(this.startMap);
    if (si > 0) {
      for (const e of this.maps.registry.slice(0, si)) {
        this.finishedMaps.add(e.id);
        for (const ms of this.maps.map(e.id)?.milestones ?? []) this.reachedMilestones.add(ms);
      }
      this.score.runMax = Math.max(this.score.runMax, this.player.spawnPoint.y);
    }
    const sm = this.maps.map(this.startMap);
    if (sm && sm !== this.map) { this.map = sm; this.setHudMap(sm); }
    this.lastZone = null;
    this.acc = 0;
    if (this.state === 'paused') { this.state = 'playing'; this.input.enabled = true; }
    this.hangTipShown = false;
    this.input.clearEdges();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.releasePointer();
    this.score.flush();
    this.ui.showPause(this.charId);
  }

  resume() {
    this.ui.hidePause();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.clearEdges();
    this.clock.getDelta();
    if (!this.isTouch && this.renderer.domElement.requestPointerLock) {
      try { const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* ignore */ }
    }
  }

  toMenu() {
    this.ui.hidePause();
    this.ui.showHUD(false);
    this.touch?.setVisible(false);
    this.input.enabled = false;
    this.input.releasePointer();
    this.state = 'menu';
    this.score.flush();
    this.player.teleport(this.player.spawnPoint, this.player.spawnYaw);
    this.ui.showMenu(this.save, this.makePortraits(), this.quality);
  }

  /** Name entry, maps panel (download / update), new-content notice, leaderboard. All of it works offline. */
  private setupOnline() {
    this.lb = new Leaderboard(this.save, () => this.firstMapId);
    this.ach = new Achievements(this.save, () => [...this.maps.loaded.values()].map((m) => m.data).sort((x, y) => x.origin[1] - y.origin[1]));
    const host = {
      statuses: () => this.content.statuses(),
      progress: (id: string) => ({
        conquered: !!this.save.highestMap && this.orderOf(id) <= this.orderOf(this.save.highestMap),
        best: this.save.bestTimes?.[id] ?? (id === this.firstMapId ? this.save.bestTime ?? null : null),
      }),
      lbEnabled: () => this.lb.enabled,
      board: (b: string) => this.lb.board(b),
      boards: () => [{ id: 'height', label: 'Độ cao' }, ...this.content.statuses().map((s) => ({ id: `time:${s.id}`, label: s.name }))],
      profile: () => this.lb.profile,
      setName: (n: string) => this.lb.setName(n),
      click: () => this.audio.click(),
    };
    this.ui.online = new OnlineUI(this.container, host);
    // back online: send waiting results (new maps: AutoSync listens by itself)
    window.addEventListener('online', () => { void this.lb.sync(); });
    // keep the next maps on the device without a tap or a message: up to 3 maps past the furthest one in play.
    // The player only ever sees a warning when maps ahead are missing and there is no internet.
    this.autoSync = new AutoSync(
      this.content,
      () => Math.max(this.orderOf(this.map?.id ?? null) || 1, this.orderOf(this.save.highestMap) || 1),
      async (_id, fresh) => { if (fresh) await this.loadOtherMaps(); this.ui.refreshMaps(); },
      (v) => {
        this.ui.setSync(v);
        // gate signs ask for internet while offline: redraw only when that changes
        if (v.kind !== this.syncKind) { this.syncKind = v.kind; this.syncGates(); this.ui.online?.refresh(); }
      },
    );

  }

  private menuInfo(): MenuInfo {
    const reg = this.maps?.registry ?? [];
    const hi = this.orderOf(this.save.highestMap);
    const st = this.content.statuses();
    const nameOf = (id: string) => st.find((s) => s.id === id)?.name ?? reg.find((e) => e.id === id)?.name ?? id;
    // start from a higher map once the map below it was conquered (and it is on this device)
    const continueFrom = reg.slice(1).filter((e, i) => (e.order ?? i + 2) - 1 <= hi)
      .map((e) => ({ id: e.id, name: e.name, y: this.maps.map(e.id)?.spawn.p[1] ?? e.yMin }));
    const conquered = this.save.highestMap ? nameOf(this.save.highestMap) : null;
    let bestTime: MenuInfo['bestTime'] = null;
    const times = this.save.bestTimes ?? {};
    const top = Object.keys(times).filter((k) => times[k] > 0).sort((a, b) => this.orderOf(b) - this.orderOf(a))[0];
    if (top) bestTime = { label: `Tốt nhất tới đỉnh ${nameOf(top)}`, value: times[top] };
    else if (this.save.bestTime) bestTime = { label: `Tốt nhất tới đỉnh ${nameOf(this.firstMapId)}`, value: this.save.bestTime };
    const p = this.lb?.profile;
    const achList = this.ach?.list() ?? [];
    return {
      name: p?.name ?? null, tag: p?.tag, continueFrom, conquered, bestTime,
      mode: this.save.mode ?? 'adventure', challengeBest: this.save.challenge?.best ?? 0,
      achievements: { got: achList.filter((a) => this.ach.has(a.id)).length, total: achList.length },
    };
  }

  /** show newly unlocked achievements (one toast each, queued) */
  private announce(list: AchDef[]) {
    list.forEach((d, i) => setTimeout(() => { this.ui.toast('Thành tích mới!', d.title, true, 3000); this.audio.chime(); }, 400 + i * 3200));
  }

  /** column position of any known map (on the device or only announced by the server) */
  private orderOf(id: string | null) {
    if (!id) return 0;
    return this.content.statuses().find((s) => s.id === id)?.order ?? this.mapIndex(id) + 1;
  }

  /** What the player is told about the map after `id` when it is not in the world (gate sign, finish panel). */
  nextInfo(id: string, fallback: string): { title: string; sub: string; html: string } {
    const s = this.content.statuses().find((x) => x.id === id);
    const title = s?.name ?? fallback;
    // nothing about downloads: the next map comes by itself; offline the player is asked for internet
    let sub: string;
    if (s?.state === 'needs-app') sub = 'Cần bản game mới để mở đường này';
    else if (s && this.maps.map(id)) sub = 'Đang mở đường…';
    else if (this.content.online === false) sub = s ? 'Bật mạng internet để mở đường này' : 'Bật mạng internet để kiểm tra map mới';
    else if (s) sub = 'Sắp mở…';
    else sub = 'Sắp ra mắt';
    return { title, sub, html: `Cổng sang <b>${title}</b><br><span style="font-weight:400;font-size:13px">${sub}</span>` };
  }

  /** close / open end-of-map gates after maps were added; announce a way that just opened */
  private syncGates() {
    const opened = this.maps.syncGates((id, fb) => this.nextInfo(id, fb));
    if (this.state === 'playing') for (const id of opened) this.ui.toast('Cổng đã mở!', `Lối lên ${this.maps.entry(id)?.name ?? id} đã sẵn sàng`, true, 4000);
  }

  private finish(md: MapData) {
    this.finishedMaps.add(md.id);
    const t = this.score.playTime;
    const test = this.score.test; // admin test run: no unlocks, no times, no completions
    const firstTime = !test && (!this.save.highestMap || this.orderOf(this.save.highestMap) < this.orderOf(md.id));
    if (!test && this.mode === 'challenge') {
      // Challenge: records + achievements only (a challenge run always starts at 0 m, so every time is a full climb)
      if (firstTime) this.save.highestMap = md.id;
      const ch = challengeOf(this.save);
      if (!ch.bestTimes[md.id] || t < ch.bestTimes[md.id]) ch.bestTimes[md.id] = t;
      writeSave(this.save);
      this.announce(this.ach.onFinish(md, t, this.firstMapId));
      void this.lb.sync();
    } else if (!test) {
      if (firstTime) this.save.highestMap = md.id;
      this.save.bestTimes = this.save.bestTimes ?? {};
      const prevBest = this.save.bestTimes[md.id] ?? (md.id === 'map001' ? this.save.bestTime ?? undefined : undefined);
      // times count for full climbs only (a run started higher up does not set a from-the-ground time)
      const valid = md.id === this.firstMapId || this.startMap === this.firstMapId;
      if (valid && (!prevBest || t < prevBest)) this.save.bestTimes[md.id] = t;
      if (md.id === 'map001') { this.save.completions++; if (!this.save.bestTime || t < this.save.bestTime) this.save.bestTime = t; }
      writeSave(this.save);
      void this.lb.sync();
    }
    this.audio.fanfare();
    this.fx.burst(new THREE.Vector3(...md.exit.p), '#9fe8ff');
    const next = this.maps.map(md.exit.next);
    if (next) {
      // seamless: no stopping – the gate leads straight on
      this.ui.toast(`Chinh phục ${md.name}!`, `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} · Đi qua cổng sang ${next.name}`, true, 4200);
      return;
    }
    this.state = 'finished';
    this.input.enabled = false;
    this.input.releasePointer();
    // end of what is on this device: the gate stays closed (safe), the map still counts as conquered
    this.ui.showFinish({
      title: `Chinh phục ${md.name}!`,
      time: t, best: this.score.best, bestTime: (this.mode === 'challenge' ? challengeOf(this.save).bestTimes[md.id] : this.save.bestTimes?.[md.id]) ?? null, firstTime,
      next: this.nextInfo(md.exit.next, md.exit.label).html,
      hint: md.finishHint ?? 'Thử tìm đường tắt để về đích nhanh hơn!',
    }, () => { this.state = 'playing'; this.input.enabled = true; this.clock.getDelta(); }, () => { this.state = 'playing'; this.input.enabled = true; this.restart(); });
  }

  // ------------------------------------------------------------------ loop
  private frame() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    this.time += dt;
    this.adaptResolution(Math.min(rawDt, 0.5));
    this.fpsAvg = this.fpsAvg * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    this.input.update();
    const pausePressed = this.input.consumePause();
    if (pausePressed) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    this.admin?.frame(dt);
    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'menu' || this.state === 'loading') {
      this.simTime += dt;
      this.maps.stepMovers(this.simTime, dt);
      this.maps.syncMovers(1);
      const m = this.player.model;
      if (m) { m.play('idle'); m.update(dt); m.root.position.copy(this.player.spawnPoint); m.root.rotation.y = this.player.spawnYaw; }
      const sp = this.player.spawnPoint;
      this.cam.orbit(dt, new THREE.Vector3(sp.x, sp.y, sp.z - 10), 22, 9);
      this.input.consumeLook();
    } else {
      this.input.consumeLook();
      this.player.model?.update(0);
    }

    const focus = this.state === 'menu' ? this.player.spawnPoint : this.player.renderPos;
    this.env.update(dt, this.time, this.cam.camera, focus);
    this.clouds.update(dt, this.time, this.cam.camera.position, this.env.sunTint);
    this.fx.update(dt, this.time);
    this.maps.update(this.time, this.cam.camera.position, this.env.sunTint, dt);
    this.audio.update(dt, this.state === 'playing' ? this.player.feetY : 0, this.state === 'playing' ? -this.player.vel.y : 0, this.time);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.cam.camera);
  }

  private updatePlaying(dt: number) {
    const look = this.input.consumeLook();
    this.cam.addLook(look.x * this.sensitivity, look.y * this.sensitivity, look.zoom);

    this.acc += dt;
    let steps = 0;
    while (this.acc >= PHYS.fixedDt && steps < PHYS.maxSubSteps) {
      this.simTime += PHYS.fixedDt;
      this.maps.stepMovers(this.simTime, PHYS.fixedDt);
      this.player.fixedUpdate(PHYS.fixedDt, this.input, this.cam.yaw);
      this.admin?.fixedUpdate(PHYS.fixedDt);
      this.physics.step();
      this.acc -= PHYS.fixedDt;
      steps++;
    }
    if (steps >= PHYS.maxSubSteps) this.acc = 0;
    const alpha = this.acc / PHYS.fixedDt;
    this.maps.syncMovers(alpha);
    this.player.syncVisual(alpha, dt);
    this.touch?.setHanging(this.player.isHanging);

    for (const e of this.player.drainEvents()) this.onPlayerEvent(e);

    const feet = this.player.renderPos;
    // which map are we in? (seamless world: village below, city beside it above the clouds)
    const here = this.maps.mapAt(feet.x, feet.y, feet.z, this.map);
    if (here && here !== this.map) {
      const fellBack = here.origin[1] < this.map.origin[1];
      this.map = here;
      this.setHudMap(here);
      this.autoSync.kick(1500); // the window of maps kept ahead moves with the player
      void this.loadOtherMaps(); // ... and so does the window of maps in the world
      if (fellBack) this.ui.toast(`Rơi xuống ${here.name}`, `Kỷ lục lượt này vẫn giữ: ${Math.floor(this.score.runMax)} m — leo lại thôi!`, false, 3600);
      else if (here.id !== this.firstMapId) this.ui.toast(here.name, `Map ${here.id.slice(3)} · ${here.origin[1]}–${here.origin[1] + here.height} m`, true, 3200);
    }
    const height = this.player.feetY;
    if (this.score.update(dt, height)) { this.ui.toast('Kỷ lục mới!', this.mode === 'challenge' ? 'Vượt kỷ lục Thử thách cũ' : 'Vượt kỷ lục cá nhân cũ', true); this.audio.chime(); }
    if (this.mode === 'challenge' && !this.score.test && this.score.runMax > this.achMax + 0.5) {
      this.achMax = this.score.runMax;
      this.announce(this.ach.onHeight(this.score.runMax));
    }

    // milestones (all loaded maps)
    for (const { data: md } of this.maps.loaded.values()) {
      for (const m of md.milestones) {
        if (!this.reachedMilestones.has(m) && this.score.runMax >= m) {
          this.reachedMilestones.add(m);
          const ms = this.fx.milestones.find((x) => Math.abs(x.y - m) < 0.1);
          if (ms) { ms.reached = true; this.fx.burst(ms.sprite.position.clone()); }
          const top = md.origin[1] + md.height;
          this.ui.toast(`Mốc ${m} m!`, m >= top ? `Đỉnh ${md.name}` : 'Tiếp tục leo lên', true);
          this.audio.chime();
        }
      }
    }
    // zones
    const z = this.maps.zoneAt(height, this.map);
    if (z) {
      const key = `${z.map.id}:${z.zone.id}`;
      if (!this.reachedZones.has(key)) {
        this.reachedZones.add(key);
        if (!(z.map.id === this.firstMapId && z.zone === z.map.zones[0])) this.ui.toast(`Khu ${z.zone.id}`, z.zone.name);
      }
      this.lastZone = z.zone;
    }
    // map exits
    for (const { data: md } of this.maps.loaded.values()) {
      if (this.finishedMaps.has(md.id)) continue;
      const ex = md.exit;
      if (Math.hypot(feet.x - ex.p[0], feet.y - ex.p[1], feet.z - ex.p[2]) < ex.r) this.finish(md);
    }

    const P = this.player;
    // camera phase: run / jump (steady horizon) / fall (see below) / hang (see the lip) / pad (launch framing)
    let camMode: CamMode = 'run';
    if (P.state === 'hang') camMode = 'hang';
    else if (P.state === 'air') camMode = P.padFlight && P.vel.y > -10 ? 'pad' : P.padFlight || P.vel.y < -14 || P.feetY < P.airBaseY - 0.4 ? 'fall' : 'jump';
    const iy = this.input.moveY, ix = this.input.moveX;
    const flying = !!this.admin?.flying;
    if (flying) camMode = 'run';
    const alignOK = !flying && P.state === 'ground' && P.speed > 3.5 && iy > 0.6 && Math.abs(ix) < 0.3;
    this.ui.setSpeedLines(P.state === 'air' ? Math.max(0, (-P.vel.y - 18) / 22, P.padFlight && P.vel.y > 6 ? 0.35 : 0) : 0);
    // camera dynamics: pad launch (pull back + wider), apex (steady), descent (tilt toward the landing), long falls
    let cd = 0, cf = 0, cpitch = 0, sharp = 4;
    if (P.padFlight && P.state === 'air') {
      if (P.vel.y > 5) { cd = 1.8; cf = 8; sharp = 6; }
      else if (P.vel.y > -5) { cd = 1.4; cf = 5; sharp = 3; }
      else { cd = 1.0; cf = 4; cpitch = 0.2; sharp = 3; }
      if (Math.random() < 0.5) this.fx.sparkles.emit(P.pos.clone().add(new THREE.Vector3(0, -0.2, 0)), 1, { speed: 0.4, up: -0.2, life: 0.35, size: 0.22 });
    }
    if (P.state === 'air' && P.vel.y < -14) {
      const f = Math.min(1, (-P.vel.y - 14) / 22);
      cf += 10 * f; cpitch += 0.12 * f; cd += 0.8 * f; sharp = Math.max(sharp, 3);
      if (P.vel.y < -30) this.cam.addShake(dt * 0.6);
    }
    if (camMode === 'hang') { cd = 0.9; cpitch = 0.12; sharp = 3; }
    this.cam.setEffects(cd, cf, cpitch, sharp);
    this.updateDropShadow();
    this.cam.update(dt, feet, P.yaw, camMode, { airBaseY: P.airBaseY, alignOK });

    // results improved while playing: send them now and then (no-op offline / without changes)
    this.lbTimer -= dt;
    if (this.lbTimer <= 0) { this.lbTimer = 90; if (this.lb.dirty) void this.lb.sync(); }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.ui.updateHUD({ current: this.score.current, runMax: this.score.runMax, best: this.score.best, time: this.score.playTime, zone: this.lastZone, fps: this.save.settings.showFps ? this.fpsAvg : undefined });
      if (!this.isTouch) this.ui.setHint(this.input.pointerLocked ? null : 'Nhấp chuột vào màn hình để điều khiển camera');
    }
  }

  private haptic(ms: number) {
    if (this.isTouch && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* unsupported */ } }
  }

  private hangTipShown = false;
  private ladderTipShown = false;

  private onPlayerEvent(e: ReturnType<Player['drainEvents']>[number]) {
    const feet = this.player.renderPos.clone();
    switch (e.type) {
      case 'jump':
        this.audio.jump();
        this.fx.dust.emit(feet, 5, { speed: 1.5, up: 0.3, life: 0.5, size: 0.45 });
        break;
      case 'slip': this.slipAt = this.time; this.haptic(8); break;
      case 'land': {
        // first real falls after a misstep: teach the reflex save (and the deliberate way down)
        if (e.drop > 2.5 && this.time - this.slipAt < 2.5 && (this.save.slipTips ?? 0) < 2 && !this.score.test) {
          this.save.slipTips = (this.save.slipTips ?? 0) + 1;
          writeSave(this.save);
          const msg = this.isTouch
            ? 'Vừa hụt chân thì kéo cần ngược lại ngay để bám lại mép'
            : 'Vừa hụt chân thì bấm phím ngược hướng ngay để bám lại mép';
          setTimeout(() => this.ui.toast('Lỡ bước khỏi mép?', msg, false, 4600), 700);
        }
        this.slipAt = -99;
        const k = THREE.MathUtils.clamp(e.drop / 14, 0, 1);
        this.audio.land(0.2 + k);
        this.fx.dust.emit(feet, 4 + Math.round(k * 16), { speed: 2 + k * 4, up: 0.4, life: 0.6 + k * 0.5, size: 0.5 + k * 0.6 });
        if (e.drop > 6 && this.player.state !== 'roll') { this.cam.addShake(Math.min(0.9, e.drop / 25)); this.haptic(Math.min(60, 10 + e.drop * 3)); }
        if (this.mode === 'challenge' && !this.score.test) this.announce(this.ach.onLand(e.drop, this.score.runMax));
        break;
      }
      case 'catch':
        this.audio.grab();
        this.cam.addShake(Math.min(0.35, e.speed / 40));
        this.haptic(25);
        this.showHangTip();
        break;
      case 'grab': this.audio.grab(); this.haptic(12); this.showHangTip(); break;
      case 'climb': this.audio.climb(); break;
      case 'mantle': this.audio.climb(); this.haptic(10); break;
      case 'vault': this.audio.jump(); this.fx.dust.emit(feet, 4, { speed: 1.2, up: 0.3, life: 0.4, size: 0.35 }); break;
      case 'roll':
        this.audio.land(0.35);
        this.fx.dust.emit(feet, 10, { speed: 3, up: 0.3, life: 0.7, size: 0.6 });
        this.haptic(18);
        break;
      case 'shimmy': this.audio.step(false); break;
      case 'push': this.audio.jump(); this.haptic(15); break;
      case 'lower': this.audio.climb(); this.showHangTip(); break;
      case 'drop': break;
      case 'step':
        this.audio.step(e.run);
        if (e.run && Math.random() < 0.35) this.fx.dust.emit(feet, 1, { speed: 0.6, up: 0.2, life: 0.45, size: 0.3 });
        break;
      case 'rescue':
        this.ui.toast('Đã đưa về làng', 'Bạn rơi ra ngoài thế giới');
        break;
      case 'unstuck':
        this.ui.toast('Đã thoát chỗ kẹt', 'Nhân vật được đưa ra ngoài công trình');
        break;
      case 'pad':
        if (e.kind === 'jump') { this.audio.clank(); this.fx.sparkles.emit(feet.clone().add(new THREE.Vector3(0, 0.2, 0)), 22, { speed: 3.2, up: 1.2, life: 0.6, size: 0.3 }); this.haptic(12); }
        else { this.audio.whoosh(); this.fx.dust.emit(feet, 8, { speed: 2.5, up: 0.4, life: 0.5, size: 0.4 }); this.haptic(12); }
        break;
      case 'launch':
        this.audio.boing();
        this.fx.sparkles.emit(feet.clone().add(new THREE.Vector3(0, 0.3, 0)), 18, { speed: 2.5, up: 6, life: 0.9, size: 0.35 });
        this.haptic(25);
        break;
      case 'bounce':
        this.audio.boing();
        this.fx.dust.emit(feet, 8, { speed: 2.2, up: 1.5, life: 0.5, size: 0.4 });
        this.haptic(15);
        break;
      case 'knock':
        this.audio.clank();
        this.haptic(30);
        break;
      case 'portal':
        this.audio.whoosh();
        this.fx.sparkles.emit(this.player.pos.clone(), 24, { speed: 3, up: 1, life: 0.7, size: 0.35 });
        break;
      case 'zip':
        this.audio.whoosh();
        break;
      case 'checkpoint':
        // the respawn point moves here (Adventure); Challenge runs always restart from the bottom
        if (this.mode !== 'challenge') { this.player.spawnPoint.copy(e.p); this.player.spawnYaw = e.yaw; }
        this.audio.chime();
        this.ui.toast('Điểm hồi sinh', 'Rơi khỏi bản đồ sẽ quay lại đây', true, 2400);
        break;
      case 'collect': {
        const key = `${this.map?.id ?? 'map'}:${e.id}`;
        const list = (this.save.collected ??= []);
        if (!list.includes(key)) { list.push(key); writeSave(this.save); }
        this.maps.collected = list;
        this.audio.chime();
        this.fx.sparkles.emit(this.player.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 26, { speed: 3.5, up: 2, life: 0.8, size: 0.35 });
        const n = list.filter((k) => k.startsWith(`${this.map?.id ?? 'map'}:`)).length;
        this.ui.toast('Nhặt được ngọc', `${n} viên ở ${this.map?.name ?? 'map này'}`, true, 2000);
        break;
      }
      case 'ring':
        this.audio.whoosh();
        this.fx.sparkles.emit(this.player.pos.clone(), 18, { speed: 4, up: 1, life: 0.8, size: 0.4 });
        this.haptic(15);
        break;
      case 'ladder':
        this.audio.clank();
        if (!this.ladderTipShown) {
          this.ladderTipShown = true;
          this.ui.toast('Đang bám thang', this.isTouch ? 'Đẩy cần lên/xuống: leo · NHẢY: bật ra' : 'W/S: leo lên/xuống · Space: bật ra', false, 3800);
        }
        break;
    }
  }

  /** One-time tutorial the first few times the player hangs on a ledge. */
  private showHangTip() {
    if (this.hangTipShown) return;
    this.hangTipShown = true;
    const n = (this.save.tips ?? 0);
    if (n >= 3) return;
    this.save.tips = n + 1;
    writeSave(this.save);
    const msg = this.isTouch
      ? 'NHẢY: leo lên · Cần trái/phải: đi dọc mép · Kéo lùi + NHẢY: bật tường · Giữ kéo lùi: buông'
      : 'Space: leo lên · A/D: đi dọc mép · S + Space: bật tường · Giữ S: buông';
    this.ui.toast('Đang bám mép', msg, false, 4200);
  }
}

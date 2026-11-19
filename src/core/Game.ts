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
import { Score, loadSave, writeSave, type SaveData } from '../systems/Score';
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
      onStart: (id) => void this.start(id ?? 'map001'),
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
    this.input.onPointerLockLost = () => { if (this.state === 'playing') this.pause(); };
    if (this.isTouch) this.touch = new TouchControls(this.input, this.container);

    this.env = new Environment(this.scene, this.renderer, { shadows: preset.shadows, shadowMap: preset.shadowMap, flare: this.quality !== 'low' });
    this.clouds = new Clouds(this.scene, preset.clouds);
    this.fx = new Effects(this.scene);
    this.fx.addBirds(3);
    this.fx.dust.setViewport(window.innerHeight);
    this.fx.sparkles.setViewport(window.innerHeight);

    this.maps = new MapManager(this.assets, this.physics, this.scene, this.fx);
    this.ui.setLoading(0.05, 'Đang dựng Starter Village…');
    await this.maps.loadRegistry();
    await this.maps.load(this.maps.entry('map001')!);
    this.map = this.maps.primary!;
    this.maps.setLodDistance(preset.lodDistance);

    this.player = new Player(this.physics, this.scene);
    this.player.hooks = this.maps;
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
    this.state = 'menu';
    this.ui.showMenu(this.save, portraits, this.quality);
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
    (window as unknown as { __game: Game }).__game = this;
    // the city above the clouds streams in behind the menu (seamless world: it is visible from the village)
    void this.loadOtherMaps();
  }

  private otherMaps: Promise<void> | null = null;
  loadOtherMaps() {
    if (!this.otherMaps) {
      this.otherMaps = (async () => {
        for (const e of this.maps.registry) {
          if (this.maps.map(e.id)) continue;
          try { await this.maps.load(e); } catch (err) { console.warn('map load failed', e.id, err); }
        }
        this.maps.setLodDistance(QUALITY_PRESETS[this.quality].lodDistance);
        this.renderer.compile(this.scene, this.cam.camera);
      })();
    }
    return this.otherMaps;
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
    this.ui.setupHUD(m.zones, y0, y0 + m.height, this.save.personalBest);
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
  async start(mapId = 'map001') {
    // phones: go fullscreen + landscape straight from the START tap (needs the user gesture)
    if (this.isTouch && fullscreenSupported() && !isFullscreen()) enterFullscreen();
    this.audio.init();
    this.audio.setVolume(this.save.settings.volume);
    this.ui.hideMenu();
    if (mapId !== 'map001' && !this.maps.map(mapId)) {
      this.ui.showLoading('Đang dựng Rooftop City…');
      await this.loadOtherMaps();
      this.ui.hideLoading();
    }
    const m = this.maps.map(mapId) ?? this.maps.map('map001')!;
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
    this.reachedMilestones.clear();
    this.reachedZones.clear();
    this.fx.milestones.forEach((m) => (m.reached = false));
    this.finishedMaps.clear();
    // a run that starts in the city counts the village as done (and its milestones as passed)
    if (this.startMap !== 'map001') {
      this.finishedMaps.add('map001');
      for (const ms of this.maps.map('map001')?.milestones ?? []) this.reachedMilestones.add(ms);
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

  private finish(md: MapData) {
    this.finishedMaps.add(md.id);
    const t = this.score.playTime;
    const order = ['map001', 'map002'];
    const firstTime = !this.save.highestMap || order.indexOf(this.save.highestMap) < order.indexOf(md.id);
    if (firstTime) this.save.highestMap = md.id;
    this.save.bestTimes = this.save.bestTimes ?? {};
    const prevBest = this.save.bestTimes[md.id] ?? (md.id === 'map001' ? this.save.bestTime ?? undefined : undefined);
    // a run started in the city does not count for village-to-city times
    const valid = md.id === 'map001' || this.startMap === 'map001';
    if (valid && (!prevBest || t < prevBest)) this.save.bestTimes[md.id] = t;
    if (md.id === 'map001') { this.save.completions++; if (!this.save.bestTime || t < this.save.bestTime) this.save.bestTime = t; }
    writeSave(this.save);
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
    const isCity = md.id === 'map002';
    this.ui.showFinish({
      title: isCity ? 'Chinh phục Rooftop City!' : 'Chinh phục Map 001!',
      time: t, best: this.save.personalBest, bestTime: this.save.bestTimes[md.id] ?? null, firstTime,
      next: isCity ? 'Cổng sang <b>Map 003</b><br><span style="font-weight:400;font-size:13px">Sẽ mở trong bản cập nhật tiếp theo. Thử tìm 3 đường tắt của thành phố để về đích nhanh hơn!</span>'
        : 'Cổng sang <b>Map 002 – Rooftop City</b><br><span style="font-weight:400;font-size:13px">Đang tải thành phố… thử lại sau giây lát.</span>',
      hint: isCity ? 'Gợi ý: có một mái nhà ẩn phía sau cần cẩu…' : 'Gợi ý: Map 001 có 3 đường tắt khó – bạn đã tìm thấy đường nào chưa?',
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
      if (fellBack) this.ui.toast(`Rơi xuống ${here.name}`, `Kỷ lục lượt này vẫn giữ: ${Math.floor(this.score.runMax)} m — leo lại thôi!`, false, 3600);
      else if (here.id !== 'map001') this.ui.toast(here.name, `Map ${here.id.slice(3)} · ${here.origin[1]}–${here.origin[1] + here.height} m`, true, 3200);
    }
    const height = this.player.feetY;
    if (this.score.update(dt, height)) { this.ui.toast('Kỷ lục mới!', `Vượt kỷ lục cá nhân cũ`, true); this.audio.chime(); }

    // milestones (all loaded maps)
    for (const md of [this.maps.map('map001'), this.maps.map('map002')]) {
      if (!md) continue;
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
        if (!(z.map.id === 'map001' && z.zone.id === 'A')) this.ui.toast(`Khu ${z.zone.id}`, z.zone.name);
      }
      this.lastZone = z.zone;
    }
    // map exits
    for (const md of [this.maps.map('map001'), this.maps.map('map002')]) {
      if (!md || this.finishedMaps.has(md.id)) continue;
      const ex = md.exit;
      if (Math.hypot(feet.x - ex.p[0], feet.y - ex.p[1], feet.z - ex.p[2]) < ex.r) this.finish(md);
    }

    const P = this.player;
    // camera phase: run / jump (steady horizon) / fall (see below) / hang (see the lip) / pad (launch framing)
    let camMode: CamMode = 'run';
    if (P.state === 'hang') camMode = 'hang';
    else if (P.state === 'air') camMode = P.padFlight && P.vel.y > -10 ? 'pad' : P.padFlight || P.vel.y < -14 || P.feetY < P.airBaseY - 0.4 ? 'fall' : 'jump';
    const iy = this.input.moveY, ix = this.input.moveX;
    const alignOK = P.state === 'ground' && P.speed > 3.5 && iy > 0.6 && Math.abs(ix) < 0.3;
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

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.ui.updateHUD({ current: this.score.current, runMax: this.score.runMax, best: this.save.personalBest, time: this.score.playTime, zone: this.lastZone, fps: this.save.settings.showFps ? this.fpsAvg : undefined });
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
      case 'land': {
        const k = THREE.MathUtils.clamp(e.drop / 14, 0, 1);
        this.audio.land(0.2 + k);
        this.fx.dust.emit(feet, 4 + Math.round(k * 16), { speed: 2 + k * 4, up: 0.4, life: 0.6 + k * 0.5, size: 0.5 + k * 0.6 });
        if (e.drop > 6 && this.player.state !== 'roll') { this.cam.addShake(Math.min(0.9, e.drop / 25)); this.haptic(Math.min(60, 10 + e.drop * 3)); }
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
      case 'ring':
        this.audio.whoosh();
        this.fx.sparkles.emit(this.player.pos.clone(), 18, { speed: 4, up: 1, life: 0.8, size: 0.4 });
        this.haptic(15);
        break;
      case 'ladder':
        this.audio.clank();
        if (!this.ladderTipShown) {
          this.ladderTipShown = true;
          this.ui.toast('Đang bám thang', this.isTouch ? 'Đẩy cần lên/xuống: leo · NHẢY: bật ra · THẢ: buông' : 'W/S: leo lên/xuống · Space: bật ra · E: buông', false, 3800);
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
      ? 'NHẢY: leo lên · Cần trái/phải: đi dọc mép · Kéo lùi + NHẢY: bật tường · THẢ: buông'
      : 'Space: leo lên · A/D: đi dọc mép · S + Space: bật tường · E: buông';
    this.ui.toast('Đang bám mép', msg, false, 4200);
  }
}

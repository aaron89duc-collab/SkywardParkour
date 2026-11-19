import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PHYS, QUALITY_PRESETS, detectDefaultQuality, type Quality } from '../config';
import { Physics } from './Physics';
import { Assets } from './Assets';
import { Input } from '../input/Input';
import { TouchControls, isTouchDevice } from '../input/TouchControls';
import { Player } from '../player/Player';
import { CharacterModel } from '../player/CharacterModel';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { Environment } from '../world/Environment';
import { Clouds } from '../world/Clouds';
import { MapManager } from '../world/MapManager';
import type { MapData, ZoneData } from '../world/MapTypes';
import { Effects } from '../fx/Effects';
import { UI } from '../ui/UI';
import { AudioEngine } from '../systems/Audio';
import { Score, loadSave, writeSave, type SaveData } from '../systems/Score';

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
  private finishedThisRun = false;
  private isTouch = isTouchDevice();
  private sensitivity = 1;
  private lastZone: ZoneData | null = null;

  constructor(private container: HTMLElement) {
    this.save = loadSave();
    this.score = new Score(this.save);
    this.quality = this.save.settings.quality ?? detectDefaultQuality();
    this.sensitivity = this.save.settings.sensitivity;
    this.charId = this.save.character;
  }

  async init() {
    const preset = QUALITY_PRESETS[this.quality];
    this.ui = new UI(this.container, {
      onStart: () => this.start(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onMainMenu: () => this.toMenu(),
      onCharacter: (c) => void this.setCharacter(c),
      onVolume: (v) => { this.save.settings.volume = v; this.audio.setVolume(v); writeSave(this.save); },
      onQuality: (q) => { this.applyQuality(q); this.save.settings.quality = q; writeSave(this.save); },
      onSensitivity: (v) => { this.sensitivity = v; this.save.settings.sensitivity = v; writeSave(this.save); },
      onShowFps: (v) => { this.save.settings.showFps = v; writeSave(this.save); },
      onPause: () => this.pause(),
      onClick: () => { this.audio.init(); this.audio.click(); },
    }, this.isTouch);
    this.ui.bindSave(this.save, this.quality);
    this.assets.onProgress = (d, t) => this.ui.setLoading(t ? d / t : 0);

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
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
    this.cam.autoFollow = this.isTouch;
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
    await this.maps.ensureAround(0, 200);
    this.map = this.maps.primary!;
    this.maps.setLodDistance(preset.lodDistance);

    this.player = new Player(this.physics, this.scene);
    this.player.spawnPoint.set(...this.map.spawn.p);
    this.player.spawnYaw = this.map.spawn.yaw;
    this.ui.setLoading(0.9, 'Đang gọi nhân vật…');
    await Promise.all([this.loadCharacter('male'), this.loadCharacter('female')]);
    this.equip(this.charId);
    this.player.teleport(this.player.spawnPoint, this.player.spawnYaw);
    this.physics.step();

    this.setupComposer(preset.bloom);
    this.ui.setupHUD(this.map.zones, this.map.height, this.save.personalBest);
    window.addEventListener('resize', () => this.onResize());
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
    const p = QUALITY_PRESETS[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
    this.env.setShadows(p.shadows, p.shadowMap);
    if (this.env.flare) this.env.flare.visible = q !== 'low';
    this.env.shafts.enabled = q !== 'low';
    this.maps.setLodDistance(p.lodDistance);
    this.setupComposer(p.bloom);
    this.onResize();
  }

  private onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.fov = w < h ? 72 : 60;
    this.cam.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.fx.dust.setViewport(h);
    this.fx.sparkles.setViewport(h);
  }

  // ------------------------------------------------------------------ flow
  start() {
    this.audio.init();
    this.audio.setVolume(this.save.settings.volume);
    this.ui.hideMenu();
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
    this.finishedThisRun = false;
    this.lastZone = null;
    this.acc = 0;
    if (this.state === 'paused') { this.state = 'playing'; this.input.enabled = true; }
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

  private finish() {
    this.finishedThisRun = true;
    const firstTime = !this.save.highestMap;
    this.save.highestMap = 'map001';
    this.save.completions++;
    const t = this.score.playTime;
    if (!this.save.bestTime || t < this.save.bestTime) this.save.bestTime = t;
    writeSave(this.save);
    this.audio.fanfare();
    this.fx.burst(this.fx.exitPos.clone(), '#9fe8ff');
    this.state = 'finished';
    this.input.enabled = false;
    this.input.releasePointer();
    this.ui.showFinish({ time: t, best: this.save.personalBest, bestTime: this.save.bestTime, firstTime }, () => { this.state = 'playing'; this.input.enabled = true; this.clock.getDelta(); }, () => { this.state = 'playing'; this.input.enabled = true; this.restart(); });
  }

  // ------------------------------------------------------------------ loop
  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this.fpsAvg = this.fpsAvg * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    this.input.update();
    const pausePressed = this.input.consumePause();
    if (pausePressed) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'menu' || this.state === 'loading') {
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
    this.maps.update(this.time, this.cam.camera.position, this.env.sunTint);
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
      this.player.fixedUpdate(PHYS.fixedDt, this.input, this.cam.yaw);
      this.physics.step();
      this.acc -= PHYS.fixedDt;
      steps++;
    }
    if (steps >= PHYS.maxSubSteps) this.acc = 0;
    const alpha = this.acc / PHYS.fixedDt;
    this.player.syncVisual(alpha, dt);
    this.touch?.setHanging(this.player.isHanging);

    for (const e of this.player.drainEvents()) this.onPlayerEvent(e);

    const feet = this.player.renderPos;
    const height = this.player.feetY - this.map.origin[1];
    if (this.score.update(dt, height)) { this.ui.toast('Kỷ lục mới!', `Vượt kỷ lục cá nhân cũ`, true); this.audio.chime(); }

    // milestones
    for (const m of this.map.milestones) {
      if (!this.reachedMilestones.has(m) && this.score.runMax >= m) {
        this.reachedMilestones.add(m);
        const ms = this.fx.milestones.find((x) => Math.abs(x.y - m) < 0.1);
        if (ms) { ms.reached = true; this.fx.burst(ms.sprite.position.clone()); }
        this.ui.toast(`Mốc ${m} m!`, m >= this.map.height ? 'Đỉnh Starter Village' : 'Tiếp tục leo lên', true);
        this.audio.chime();
      }
    }
    // zones
    const z = this.maps.zoneAt(height);
    if (z) {
      if (!this.reachedZones.has(z.zone.id)) {
        this.reachedZones.add(z.zone.id);
        if (z.zone.id !== 'A') this.ui.toast(`Khu ${z.zone.id}`, z.zone.name);
      }
      this.lastZone = z.zone;
    }
    // exit gate to Map 002
    const ex = this.map.exit;
    if (!this.finishedThisRun && Math.hypot(feet.x - ex.p[0], feet.y - ex.p[1], feet.z - ex.p[2]) < ex.r) this.finish();

    const falling = this.player.state === 'air' && this.player.vel.y < -12;
    this.ui.setSpeedLines(this.player.state === 'air' ? Math.max(0, (-this.player.vel.y - 18) / 22) : 0);
    this.cam.update(dt, feet, this.player.yaw, this.player.speed > 0.5, falling);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.ui.updateHUD({ current: this.score.current, runMax: this.score.runMax, best: this.save.personalBest, time: this.score.playTime, zone: this.lastZone, fps: this.save.settings.showFps ? this.fpsAvg : undefined });
      if (!this.isTouch) this.ui.setHint(this.input.pointerLocked ? null : 'Nhấp chuột vào màn hình để điều khiển camera');
    }
  }

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
        if (e.drop > 6) this.cam.addShake(Math.min(0.9, e.drop / 25));
        break;
      }
      case 'grab': this.audio.grab(); break;
      case 'climb': this.audio.climb(); break;
      case 'drop': break;
      case 'step':
        this.audio.step(e.run);
        if (e.run && Math.random() < 0.35) this.fx.dust.emit(feet, 1, { speed: 0.6, up: 0.2, life: 0.45, size: 0.3 });
        break;
      case 'rescue':
        this.ui.toast('Đã đưa về làng', 'Bạn rơi ra ngoài thế giới');
        break;
    }
  }
}

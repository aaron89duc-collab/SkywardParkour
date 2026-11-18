import * as THREE from 'three';
import { PhysicsWorld } from './PhysicsWorld';
import { InputController } from '../input/InputController';
import { MapLoader } from '../world/MapLoader';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { GameUI } from '../ui/GameUI';

const STORAGE_KEY = 'skyward-parkour-best-height-v1';

export class Game {
  private readonly ui: GameUI;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: InputController;
  private physics!: PhysicsWorld;
  private map!: MapLoader;
  private player!: PlayerController;
  private chaseCamera!: ThirdPersonCamera;
  private running = false;
  private hasStarted = false;
  private accumulator = 0;
  private lastTime = 0;
  private lastHud = 0;
  private maxHeight = 0;
  private bestHeight = 0;
  private lastSavedInteger = 0;
  private nextMilestone = 10;
  private reachedSummit = false;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#88caea');
    this.scene.fog = new THREE.Fog('#acd7ef', 65, 185);
    this.camera = new THREE.PerspectiveCamera(68, 1, .09, 330);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new InputController(canvas);
    this.ui = new GameUI(() => this.resume(), () => this.restart(), () => this.togglePause());

    const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
    sun.position.set(-20, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -44;
    sun.shadow.camera.right = 44;
    sun.shadow.camera.top = 65;
    sun.shadow.camera.bottom = -25;
    sun.shadow.camera.near = .1;
    sun.shadow.camera.far = 125;
    sun.shadow.bias = -.0002;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight('#d6f2ff', '#718e70', 2.15));

    this.readRecord();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && this.hasStarted && !event.repeat) this.togglePause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running) this.pause();
    });
    this.resize();
  }

  async init(): Promise<void> {
    this.physics = await PhysicsWorld.create();
    this.map = new MapLoader(this.scene, this.physics);
    await this.map.loadManifest();
    this.player = new PlayerController(this.physics, this.scene, this.map.spawn);
    this.chaseCamera = new ThirdPersonCamera(this.camera, this.input, this.map);
    // Physics must run at least once to register all fixed colliders in queries.
    this.physics.step();
    this.player.syncVisual(0);
    this.chaseCamera.update(this.player, 1);
    this.ui.setHeights(0, this.bestHeight, 0, true);
    this.ui.ready();
    requestAnimationFrame((time) => this.loop(time));
  }

  private loop(time: number): void {
    const delta = this.lastTime ? Math.min((time - this.lastTime) / 1000, .05) : 0;
    this.lastTime = time;
    if (this.running) {
      this.accumulator += delta;
      let physicsTicks = 0;
      while (this.accumulator >= PhysicsWorld.STEP && physicsTicks < 5) {
        this.tick(PhysicsWorld.STEP);
        this.accumulator -= PhysicsWorld.STEP;
        physicsTicks++;
      }
      if (physicsTicks === 5) this.accumulator = 0;
      if (time - this.lastHud > 95) {
        const current = Math.max(0, this.player.footY);
        this.ui.setHeights(this.maxHeight, this.bestHeight, current, this.player.grounded);
        this.lastHud = time;
      }
    }
    this.chaseCamera.update(this.player, Math.max(delta, .0001));
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((nextTime) => this.loop(nextTime));
  }

  private tick(dt: number): void {
    this.player.fixedUpdate(this.input, dt);
    this.physics.step();
    this.player.syncVisual(dt);
    const nowHeight = Math.max(0, this.player.footY);
    this.maxHeight = Math.max(this.maxHeight, nowHeight);
    if (this.maxHeight > this.bestHeight) {
      this.bestHeight = this.maxHeight;
      this.saveRecordIfNeeded();
    }
    if (this.maxHeight >= this.nextMilestone) {
      this.ui.showToast(`▲ ĐẠT ĐỘ CAO ${this.nextMilestone} m!`);
      this.nextMilestone += 10;
    }
    if (!this.reachedSummit && this.maxHeight >= this.map.finish.y - 1) {
      this.reachedSummit = true;
      this.ui.showToast('🏁 ĐÃ LÊN ĐỈNH MAP 001!');
    }
  }

  private resume(): void {
    if (!this.player) return;
    this.hasStarted = true;
    this.running = true;
    this.accumulator = 0;
    this.input.reset();
    this.ui.hideScreen();
  }

  private pause(): void {
    this.running = false;
    this.input.reset();
    this.saveRecord(true);
    this.ui.showPause();
  }

  private togglePause(): void {
    if (!this.hasStarted) return;
    if (this.running) this.pause(); else this.resume();
  }

  private restart(): void {
    // The ONLY way to go back to spawn is the user's explicit restart click.
    this.player.reset(this.map.spawn);
    this.maxHeight = 0;
    this.nextMilestone = 10;
    this.reachedSummit = false;
    this.input.yaw = 0;
    this.input.pitch = .38;
    this.chaseCamera.reset();
    this.ui.showToast('BẮT ĐẦU LƯỢT LEO MỚI!');
    this.resume();
  }

  private readRecord(): void {
    try {
      const value = Number(window.localStorage.getItem(STORAGE_KEY) ?? 0);
      this.bestHeight = Number.isFinite(value) && value >= 0 ? value : 0;
      this.lastSavedInteger = Math.floor(this.bestHeight);
    } catch {
      this.bestHeight = 0;
    }
  }

  private saveRecordIfNeeded(): void {
    const rounded = Math.floor(this.bestHeight);
    if (rounded > this.lastSavedInteger) {
      this.lastSavedInteger = rounded;
      this.saveRecord(false);
    }
  }

  private saveRecord(force: boolean): void {
    try {
      if (force || this.bestHeight > 0) window.localStorage.setItem(STORAGE_KEY, this.bestHeight.toFixed(3));
    } catch {
      // Private/incognito mode can disable storage. Gameplay should still work.
    }
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const mobile = window.matchMedia('(pointer: coarse)').matches || width <= 720;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.8));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

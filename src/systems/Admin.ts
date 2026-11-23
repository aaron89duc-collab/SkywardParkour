import * as THREE from 'three';
import { t } from '../i18n';
import { sha256Hex } from './sha256';
import type { Player } from '../player/Player';
import type { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import type { Input } from '../input/Input';
import type { MapManager } from '../world/MapManager';
import type { Physics } from '../core/Physics';
import type { TouchControls } from '../input/TouchControls';

/**
 * Admin / map-test mode. Hidden from players: no button anywhere until unlocked.
 *  - open: press M five times in a row while playing. PC only (keyboard + mouse); never on phones/tablets
 *  - `npm run dev`: opens directly; deployed build: asks for the admin password (only its salted SHA-256 is in
 *    the code; set your own with VITE_ADMIN_HASH, see devtools/admin-hash.mjs)
 *  - fly anywhere without collisions, then drop the character to keep playing from there; teleport to map
 *    waypoints / saved points; "drop again" from the last drop point to repeat a jump.
 *  A run in which admin moves were used is a TEST run: nothing is recorded (best height, unlocks, times).
 */
const SALT = 'skyward-parkour/admin:';
const DEFAULT_HASH = '3afef5b1cf2e18b0775784870f4ec64542907e16fc007aa56f8a09408c002008';
const ENV_HASH = (import.meta.env.VITE_ADMIN_HASH as string | undefined)?.trim().toLowerCase();
const HASH = ENV_HASH && /^[0-9a-f]{64}$/.test(ENV_HASH) ? ENV_HASH : DEFAULT_HASH;
const UNLOCK_KEY = 'skyward-parkour.admin';
const MARKS_KEY = 'skyward-parkour.admin.marks';
const FEET = 0.8;

export interface AdminHost {
  player: Player;
  cam: ThirdPersonCamera;
  input: Input;
  maps: MapManager;
  physics: Physics;
  touch: TouchControls | null;
  isPlaying(): boolean;
  /** admin moves are not available in Challenge mode (no teleports there) */
  allowed(): boolean;
  /** flag the current run as a test run (no records) */
  markTestRun(): void;
  toast(t1: string, t2?: string): void;
  where(): string;
  setGameInput(on: boolean): void;
}

type Mark = { label: string; p: [number, number, number] };

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export class Admin {
  unlocked: boolean;
  flying = false;
  private open = false;
  private minimized = false;
  private fast = false;
  private flyVel = new THREE.Vector3();
  private lastDrop: { p: THREE.Vector3; yaw: number } | null = null;
  private marks: Mark[] = [];
  private panel: HTMLDivElement;
  private prompt: HTMLDivElement;
  private posEl: HTMLSpanElement;
  private flyBtn: HTMLButtonElement;
  private speedBtn: HTMLButtonElement;
  private select: HTMLSelectElement;
  private posTimer = 0;
  private mPresses: number[] = [];
  /** admin exists only on a real PC: no phones / tablets (also not with a Bluetooth keyboard) */
  readonly pcOnly = !/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent) &&
    !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) && // iPadOS reports a Mac UA
    // touch-only screens without any mouse/trackpad are not PCs
    !(navigator.maxTouchPoints > 0 && typeof matchMedia === 'function' && !matchMedia('(any-pointer: fine)').matches);

  constructor(private h: AdminHost, parent: HTMLElement, hudHeight: HTMLElement) {
    this.unlocked = this.pcOnly && (import.meta.env.DEV || store.get(UNLOCK_KEY) === HASH);
    try { this.marks = JSON.parse(store.get(MARKS_KEY) ?? '[]'); } catch { this.marks = []; }

    this.panel = document.createElement('div');
    this.panel.className = 'admin-panel hidden';
    this.panel.innerHTML = `
      <div class="ap-head"><b>ADMIN</b><span class="ap-pos"></span><button data-a="min" title="${t('adm.min')}">–</button><button data-a="close" title="${t('adm.close')}">×</button></div>
      <div class="ap-body">
        <div class="ap-row"><button data-a="fly" class="ap-main">${t('adm.fly')}</button><button data-a="ground">${t('adm.ground')}</button><button data-a="redo">${t('adm.redo')}</button></div>
        <div class="ap-row"><select data-a="wp"></select><button data-a="go">${t('adm.go')}</button></div>
        <div class="ap-row"><button data-a="mark">${t('adm.mark')}</button><button data-a="copy">${t('adm.copy')}</button><button data-a="speed">${t('adm.speed', { k: 1 })}</button></div>
        <div class="ap-row ap-small"><button data-a="clear">${t('adm.clear')}</button><button data-a="lock">${t('adm.lock')}</button></div>
        <div class="ap-help">${t('adm.help')}</div>
      </div>`;
    parent.appendChild(this.panel);
    this.posEl = this.panel.querySelector('.ap-pos') as HTMLSpanElement;
    this.flyBtn = this.panel.querySelector('[data-a=fly]') as HTMLButtonElement;
    this.speedBtn = this.panel.querySelector('[data-a=speed]') as HTMLButtonElement;
    this.select = this.panel.querySelector('[data-a=wp]') as HTMLSelectElement;
    const on = (a: string, f: () => void) => (this.panel.querySelector(`[data-a=${a}]`) as HTMLElement).addEventListener('click', (e) => { e.stopPropagation(); f(); });
    on('min', () => { this.minimized = !this.minimized; this.refresh(); });
    on('close', () => { this.open = false; this.refresh(); });
    on('fly', () => this.toggleFly());
    on('ground', () => this.placeOnGround());
    on('redo', () => this.dropAgain());
    on('go', () => this.gotoSelected());
    on('mark', () => this.saveMark());
    on('copy', () => this.copyPos());
    on('speed', () => { this.fast = !this.fast; this.refresh(); });
    on('clear', () => { this.marks = []; store.set(MARKS_KEY, '[]'); this.fillWaypoints(); this.h.toast(t('adm.cleared')); });
    on('lock', () => this.lock());
    // a tap on the minimised header expands it again
    (this.panel.querySelector('.ap-head') as HTMLElement).addEventListener('click', () => { if (this.minimized) { this.minimized = false; this.refresh(); } });
    // keep panel clicks/touches away from the game (camera swipe, pointer lock)
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) this.panel.addEventListener(ev, (e) => e.stopPropagation());

    this.prompt = document.createElement('div');
    this.prompt.className = 'overlay admin-prompt hidden';
    this.prompt.innerHTML = `<div class="panel"><h2>Admin</h2>
      <input type="password" autocomplete="current-password" placeholder="${t('adm.password')}" class="ap-input">
      <label class="ap-remember"><input type="checkbox" checked> ${t('adm.remember')}</label>
      <div class="ap-err"></div>
      <div class="row"><button class="btn secondary" data-a="cancel">${t('common.cancel')}</button><button class="btn" data-a="ok">${t('adm.unlock')}</button></div></div>`;
    parent.appendChild(this.prompt);
    const input = this.prompt.querySelector('.ap-input') as HTMLInputElement;
    const submit = () => this.tryPassword(input.value, (this.prompt.querySelector('.ap-remember input') as HTMLInputElement).checked);
    (this.prompt.querySelector('[data-a=ok]') as HTMLButtonElement).addEventListener('click', submit);
    (this.prompt.querySelector('[data-a=cancel]') as HTMLButtonElement).addEventListener('click', () => this.closePrompt());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') this.closePrompt(); e.stopPropagation(); });

    // hidden entry points
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      // M pressed five times in a row (no other key in between, each within 1 s of the previous one)
      if (e.code === 'KeyM' && !e.repeat && this.pcOnly) {
        const now = e.timeStamp || performance.now();
        if (this.mPresses.length && now - this.mPresses[this.mPresses.length - 1] > 1000) this.mPresses = [];
        this.mPresses.push(now);
        if (this.mPresses.length >= 5) { this.mPresses = []; this.summon(); }
        return;
      }
      if (!e.repeat) this.mPresses = [];
      if (!this.unlocked || !this.h.isPlaying() || !this.h.allowed() || e.repeat || e.ctrlKey || e.metaKey) return;
      if (e.code === 'KeyF') this.toggleFly();
      else if (e.code === 'KeyG') this.placeOnGround();
      else if (e.code === 'KeyT') this.dropAgain();
      else if (e.code === 'KeyB') this.saveMark();
    });
    void hudHeight;
    this.fillWaypoints();
    this.refresh();
  }

  /** panel open on PC: keep the mouse cursor free for it instead of pausing when pointer lock is lost */
  get wantsCursor() { return this.unlocked && this.open && !this.minimized; }

  /** Secret shortcut: unlocked -> show/hide the panel; locked -> password prompt. */
  private summon() {
    if (!this.h.isPlaying() || !this.pcOnly) return;
    if (!this.h.allowed()) { this.h.toast(t('adm.noChallenge'), t('adm.noChallengeSub')); return; }
    if (this.unlocked) { this.open = !this.open || this.minimized; this.minimized = false; this.refresh(); return; }
    this.h.setGameInput(false);
    this.h.input.releasePointer();
    this.prompt.classList.remove('hidden');
    (this.prompt.querySelector('.ap-err') as HTMLElement).textContent = '';
    const input = this.prompt.querySelector('.ap-input') as HTMLInputElement;
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }

  private closePrompt() {
    this.prompt.classList.add('hidden');
    (this.prompt.querySelector('.ap-input') as HTMLInputElement).blur();
    this.h.setGameInput(true);
  }

  private tryPassword(pw: string, remember: boolean) {
    if (sha256Hex(SALT + pw) !== HASH) {
      (this.prompt.querySelector('.ap-err') as HTMLElement).textContent = t('adm.wrong');
      return;
    }
    this.unlocked = true;
    if (remember) store.set(UNLOCK_KEY, HASH);
    this.closePrompt();
    this.open = true;
    this.refresh();
    this.h.toast(t('adm.on'), t('adm.onSub'));
  }

  private lock() {
    if (this.flying) this.drop();
    store.set(UNLOCK_KEY, null);
    this.unlocked = this.pcOnly && import.meta.env.DEV;
    this.open = false;
    this.refresh();
    this.h.toast(t('adm.off'));
  }

  // ------------------------------------------------------------------ actions
  toggleFly() { if (this.flying) this.drop(); else this.startFly(); }

  private startFly() {
    if (!this.unlocked) return;
    const P = this.h.player;
    this.flying = true;
    this.flyVel.set(0, 0, 0);
    P.frozen = true;
    P.flyTo(P.pos.clone());
    this.h.markTestRun();
    this.h.touch?.setFly(true);
    if (this.h.touch) this.minimized = true; // phone: free the joystick area while flying (tap the header to expand)
    this.refresh();
  }

  /** Leave fly mode: the character falls from right here and the run continues normally (as a test run). */
  private drop(at?: THREE.Vector3, yaw?: number) {
    const P = this.h.player;
    const feet = at ?? new THREE.Vector3(P.pos.x, P.pos.y - FEET, P.pos.z);
    const y = yaw ?? P.yaw;
    this.flying = false;
    P.frozen = false;
    P.teleport(feet, y);
    this.h.input.clearEdges();
    this.lastDrop = { p: feet.clone(), yaw: y };
    this.h.touch?.setFly(false);
    this.h.markTestRun();
    this.refresh();
  }

  /** Put the character standing on the first surface straight below. */
  private placeOnGround() {
    if (!this.unlocked) return;
    const P = this.h.player;
    const from = new THREE.Vector3(P.pos.x, P.pos.y - FEET + 0.3, P.pos.z);
    const hit = this.h.physics.raycast(from, new THREE.Vector3(0, -1, 0), 600);
    if (!hit) { this.h.toast(t('adm.noGround')); return; }
    this.drop(hit.point.clone().add(new THREE.Vector3(0, 0.05, 0)));
  }

  private dropAgain() {
    if (!this.unlocked) return;
    if (!this.lastDrop) { this.h.toast(t('adm.noDrop'), t('adm.noDropSub')); return; }
    this.drop(this.lastDrop.p.clone(), this.lastDrop.yaw);
  }

  private gotoSelected() {
    if (!this.unlocked) return;
    const v = this.select.value;
    if (!v) return;
    const [x, y, z] = v.split(',').map(Number);
    // waypoints are standable route points: arrive standing there, ready to try the next jump
    this.drop(new THREE.Vector3(x, y + 0.1, z));
    this.h.toast(t('adm.teleport'), this.select.selectedOptions[0]?.textContent ?? '');
  }

  private saveMark() {
    if (!this.unlocked) return;
    const P = this.h.player;
    const p: [number, number, number] = [P.pos.x, P.pos.y - FEET, P.pos.z].map((v) => Math.round(v * 100) / 100) as [number, number, number];
    const label = t('adm.point', { n: this.marks.length + 1, y: Math.round(p[1]) });
    this.marks.push({ label, p });
    store.set(MARKS_KEY, JSON.stringify(this.marks));
    this.fillWaypoints();
    this.select.value = p.join(',');
    this.h.toast(t('adm.saved'), `${label} (${p.join(', ')})`);
  }

  private copyPos() {
    if (!this.unlocked) return;
    const P = this.h.player;
    const s = [P.pos.x, P.pos.y - FEET, P.pos.z].map((v) => v.toFixed(2)).join(', ');
    const done = () => this.h.toast(t('adm.copied'), s);
    try { navigator.clipboard.writeText(s).then(done, () => this.h.toast(t('adm.coords'), s)); } catch { this.h.toast(t('adm.coords'), s); }
  }

  private fillWaypoints() {
    const opt = (label: string, p: number[]) => `<option value="${p.join(',')}">${label}</option>`;
    let html = `<option value="">${t('adm.goto')}</option>`;
    for (const m of this.h.maps.loaded.values()) {
      const wps = m.data.waypoints ?? [];
      if (!wps.length) continue;
      html += `<optgroup label="${m.data.name}">${wps.map((w) => opt(w.label, w.p)).join('')}</optgroup>`;
    }
    if (this.marks.length) html += `<optgroup label="${t('adm.marks')}">${this.marks.map((m) => opt(m.label, m.p)).join('')}</optgroup>`;
    this.select.innerHTML = html;
  }

  /** new maps finished streaming in: refresh the teleport list */
  mapsChanged() { this.fillWaypoints(); }

  /** run restarted from the menu: leave fly mode quietly */
  reset() {
    if (this.flying) { this.flying = false; this.h.player.frozen = false; this.h.touch?.setFly(false); }
    this.lastDrop = null;
    this.refresh();
  }

  // ------------------------------------------------------------------ per tick / frame
  /** Fixed step, right after the (frozen) player update: free flight, no collisions. */
  fixedUpdate(dt: number) {
    if (!this.flying) return;
    const I = this.h.input, P = this.h.player;
    const yaw = this.h.cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let up = 0;
    if (I.isDown('Space') || I.touchJumpHeld) up += 1;
    if (I.isDown('KeyC') || I.isDown('KeyQ') || I.touchDropHeld) up -= 1;
    const boost = I.isDown('ShiftLeft') || I.isDown('ShiftRight') || this.fast;
    const sp = boost ? 40 : 12;
    const want = new THREE.Vector3((rx * I.moveX + fx * I.moveY) * sp, up * sp * 0.75, (rz * I.moveX + fz * I.moveY) * sp);
    this.flyVel.lerp(want, 1 - Math.exp(-10 * dt));
    const p = P.pos.clone().addScaledVector(this.flyVel, dt);
    const h = Math.hypot(this.flyVel.x, this.flyVel.z);
    P.flyTo(p, h > 0.5 ? Math.atan2(this.flyVel.x, this.flyVel.z) : undefined);
  }

  /** Every rendered frame (any game state). */
  frame(dt: number) {
    const show = this.unlocked && this.open && this.h.isPlaying() && this.h.allowed();
    this.panel.classList.toggle('hidden', !show);
    if (!show) return;
    this.posTimer -= dt;
    if (this.posTimer > 0) return;
    this.posTimer = 0.15;
    const P = this.h.player;
    this.posEl.textContent = `${P.pos.x.toFixed(1)}, ${(P.pos.y - FEET).toFixed(1)}, ${P.pos.z.toFixed(1)} · ${this.h.where()}${this.flying ? ' · BAY' : ''}`;
  }

  private refresh() {
    this.panel.classList.toggle('min', this.minimized);
    this.flyBtn.textContent = this.flying ? t('adm.drop') : t('adm.fly');
    this.flyBtn.classList.toggle('on', this.flying);
    this.speedBtn.textContent = t('adm.speed', { k: this.fast ? 3 : 1 });
  }
}

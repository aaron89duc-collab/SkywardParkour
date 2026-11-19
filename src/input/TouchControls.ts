import { Input } from './Input';
import { CAMERA } from '../config';

/** Virtual joystick (left), camera swipe (right), JUMP / DROP buttons. Feeds the shared Input. */
export class TouchControls {
  root: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private jumpBtn: HTMLButtonElement;
  private dropBtn: HTMLButtonElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };
  private readonly radius = 58;
  visible = false;

  constructor(private input: Input, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer hidden';
    this.root.innerHTML = `
      <div class="touch-stick-zone"></div>
      <div class="touch-look-zone"></div>
      <div class="stick-base"><div class="stick-knob"></div></div>
      <button class="tbtn tbtn-drop" aria-label="Thả">THẢ</button>
      <button class="tbtn tbtn-jump" aria-label="Nhảy">NHẢY</button>`;
    parent.appendChild(this.root);
    this.stickBase = this.root.querySelector('.stick-base') as HTMLDivElement;
    this.stickKnob = this.root.querySelector('.stick-knob') as HTMLDivElement;
    this.jumpBtn = this.root.querySelector('.tbtn-jump') as HTMLButtonElement;
    this.dropBtn = this.root.querySelector('.tbtn-drop') as HTMLButtonElement;
    const stickZone = this.root.querySelector('.touch-stick-zone') as HTMLDivElement;
    const lookZone = this.root.querySelector('.touch-look-zone') as HTMLDivElement;

    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.input.usingTouch = true;
      this.stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.placeBase();
      this.stickBase.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    });
    stickZone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY); });
    const endStick = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.releaseStick(); };
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);
    stickZone.addEventListener('lostpointercapture', endStick);

    // camera swipe: captured per finger, so a swipe that slides over JUMP never presses it
    // (buttons only react to a finger that lands on them: pointerdown)
    lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      e.preventDefault();
      this.input.usingTouch = true;
      this.lookId = e.pointerId;
      lookZone.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const k = CAMERA.touchSensitivity / CAMERA.mouseSensitivity;
      const dx = e.clientX - this.lookLast.x, dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      if (Math.abs(dx) + Math.abs(dy) < 0.6) return; // sensor jitter of a resting thumb
      this.input.lookX += dx * k;
      this.input.lookY += dy * k;
      this.input.lastInputTime = performance.now();
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = null; };
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);
    lookZone.addEventListener('lostpointercapture', endLook);

    // buttons: the finger that pressed is captured, so sliding a little off the button while holding
    // does not release it (that would cut the jump short)
    const bindButton = (btn: HTMLButtonElement, down: (t: number) => void, up: (t: number) => void) => {
      let id: number | null = null;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (id !== null) return;
        id = e.pointerId;
        try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        this.input.usingTouch = true;
        btn.classList.add('down');
        down(e.timeStamp);
      });
      const release = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        e.preventDefault();
        id = null;
        btn.classList.remove('down');
        up(e.timeStamp);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      this.resets.push(() => { if (id !== null) { id = null; btn.classList.remove('down'); up(performance.now()); } });
    };
    bindButton(this.jumpBtn, (t) => { this.input.pressJump(t); this.input.touchJumpHeld = true; }, (t) => { this.input.releaseJump(t); this.input.touchJumpHeld = false; });
    bindButton(this.dropBtn, () => this.input.pressDrop(), () => {});

    // app switch / notification shade: never leave a stick or button stuck down
    const resetAll = () => this.reset();
    window.addEventListener('blur', resetAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetAll(); });
  }

  private resets: (() => void)[] = [];

  reset() {
    this.releaseStick();
    this.lookId = null;
    for (const r of this.resets) r();
  }

  private placeBase() {
    this.stickBase.style.left = `${this.stickOrigin.x}px`;
    this.stickBase.style.top = `${this.stickOrigin.y}px`;
  }

  private releaseStick() {
    this.stickId = null;
    this.input.touchMoveX = 0;
    this.input.touchMoveY = 0;
    this.stickKnob.style.transform = 'translate(-50%,-50%)';
    this.stickBase.classList.remove('active');
  }

  /**
   * Floating stick. Circular dead zone, then a two-stage response: the first half of the throw covers walking
   * speeds (fine positioning on narrow beams), the second half ramps to a full run, reached a little before
   * the rim. Direction is exact (vector normalised: diagonals are never faster). When the thumb is dragged past
   * the rim the base follows it, so reversing direction responds immediately.
   */
  private updateStick(x: number, y: number) {
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    let len = Math.hypot(dx, dy);
    const follow = this.radius * 1.25;
    if (len > follow) {
      const k = (len - follow) / len;
      this.stickOrigin.x += dx * k;
      this.stickOrigin.y += dy * k;
      this.placeBase();
      dx = x - this.stickOrigin.x; dy = y - this.stickOrigin.y; len = Math.hypot(dx, dy);
    }
    const shown = Math.min(1, this.radius / Math.max(len, 1e-6));
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx * shown}px), calc(-50% + ${dy * shown}px))`;
    const m = Math.min(1, len / this.radius);
    const DEAD = 0.12, FULL = 0.85;
    if (m < DEAD) { this.input.touchMoveX = 0; this.input.touchMoveY = 0; return; }
    const r = Math.min(1, (m - DEAD) / (FULL - DEAD));
    const walk = 0.43; // PHYS.walkSpeed / PHYS.runSpeed
    const speed = r < 0.5 ? 0.12 + (walk - 0.12) * (r / 0.5) : walk + (1 - walk) * ((r - 0.5) / 0.5);
    this.input.touchMoveX = (dx / len) * speed;
    this.input.touchMoveY = (-dy / len) * speed;
    this.input.lastInputTime = performance.now();
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (!v) this.reset();
    this.root.classList.toggle('hidden', !v);
  }

  setHanging(h: boolean) {
    this.jumpBtn.textContent = h ? 'LEO' : 'NHẢY';
    this.dropBtn.classList.toggle('emph', h);
  }
}

export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

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
      this.input.usingTouch = true;
      this.stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    });
    stickZone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY); });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.touchMoveX = 0;
      this.input.touchMoveY = 0;
      this.stickKnob.style.transform = 'translate(-50%,-50%)';
      this.stickBase.classList.remove('active');
    };
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);

    lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.input.usingTouch = true;
      this.lookId = e.pointerId;
      lookZone.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const k = CAMERA.touchSensitivity / CAMERA.mouseSensitivity;
      this.input.lookX += (e.clientX - this.lookLast.x) * k;
      this.input.lookY += (e.clientY - this.lookLast.y) * k;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.input.lastInputTime = performance.now();
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = null; };
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);

    const bindButton = (btn: HTMLButtonElement, down: () => void, up: () => void) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.input.usingTouch = true; btn.classList.add('down'); down(); });
      const release = (e: Event) => { e.preventDefault(); btn.classList.remove('down'); up(); };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    };
    bindButton(this.jumpBtn, () => { this.input.pressJump(); this.input.touchJumpHeld = true; }, () => { this.input.touchJumpHeld = false; });
    bindButton(this.dropBtn, () => this.input.pressDrop(), () => {});
  }

  private updateStick(x: number, y: number) {
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) { dx *= this.radius / len; dy *= this.radius / len; }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    let mx = dx / this.radius, my = -dy / this.radius;
    const m = Math.hypot(mx, my);
    if (m < 0.12) { mx = 0; my = 0; } else if (m > 0.85) { mx /= m; my /= m; } // full run near the rim
    this.input.touchMoveX = mx;
    this.input.touchMoveY = my;
    this.input.lastInputTime = performance.now();
  }

  setVisible(v: boolean) {
    this.visible = v;
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

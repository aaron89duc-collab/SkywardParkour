/** Shared input model: keyboard + drag-to-orbit + touch joystick and jump. */
export class InputController {
  yaw = 0;
  pitch = 0.38;
  moveRight = 0;
  moveForward = 0;
  private keys = new Set<string>();
  private joystickX = 0;
  private joystickY = 0;
  private jumpQueued = false;
  private cameraPointer: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private joystickPointer: number | null = null;
  private jumpPointer: number | null = null;
  private readonly stick: HTMLElement;
  private readonly joystickZone: HTMLElement;
  private readonly jumpButton: HTMLButtonElement;

  constructor(canvas: HTMLCanvasElement) {
    this.stick = document.getElementById('joystick-stick')!;
    this.joystickZone = document.getElementById('joystick-zone')!;
    this.jumpButton = document.getElementById('jump-button') as HTMLButtonElement;

    window.addEventListener('keydown', (e) => {
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code) && e.code === 'Space') this.queueJump();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });

    canvas.addEventListener('pointerdown', (e) => {
      if (this.cameraPointer !== null) return;
      if (e.pointerType === 'touch' && e.clientX < window.innerWidth * .36) return;
      this.cameraPointer = e.pointerId;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.cameraPointer !== e.pointerId) return;
      this.yaw -= (e.clientX - this.lastPointerX) * .0048;
      this.pitch = Math.min(1.18, Math.max(.15, this.pitch + (e.clientY - this.lastPointerY) * .004));
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });
    const releaseCamera = (e: PointerEvent) => {
      if (this.cameraPointer === e.pointerId) this.cameraPointer = null;
    };
    canvas.addEventListener('pointerup', releaseCamera);
    canvas.addEventListener('pointercancel', releaseCamera);
    canvas.addEventListener('lostpointercapture', releaseCamera);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.joystickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.joystickPointer !== null) return;
      this.joystickPointer = e.pointerId;
      this.joystickZone.setPointerCapture(e.pointerId);
      this.updateJoystick(e);
    });
    this.joystickZone.addEventListener('pointermove', (e) => {
      if (this.joystickPointer === e.pointerId) this.updateJoystick(e);
    });
    const releaseJoystick = (e: PointerEvent) => {
      if (this.joystickPointer !== e.pointerId) return;
      this.joystickPointer = null;
      this.joystickX = 0; this.joystickY = 0;
      this.stick.style.transform = 'translate(0px, 0px)';
    };
    this.joystickZone.addEventListener('pointerup', releaseJoystick);
    this.joystickZone.addEventListener('pointercancel', releaseJoystick);
    this.joystickZone.addEventListener('lostpointercapture', releaseJoystick);

    this.jumpButton.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.jumpPointer !== null) return;
      this.jumpPointer = e.pointerId;
      this.queueJump();
      this.jumpButton.classList.add('pressed');
      this.jumpButton.setPointerCapture(e.pointerId);
    });
    const releaseJump = (e: PointerEvent) => {
      if (this.jumpPointer !== e.pointerId) return;
      this.jumpPointer = null;
      this.jumpButton.classList.remove('pressed');
    };
    this.jumpButton.addEventListener('pointerup', releaseJump);
    this.jumpButton.addEventListener('pointercancel', releaseJump);
    this.jumpButton.addEventListener('lostpointercapture', releaseJump);
  }

  private updateJoystick(e: PointerEvent): void {
    const rect = this.joystickZone.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const maxDistance = 46;
    const magnitude = Math.hypot(dx, dy);
    const scale = magnitude > maxDistance ? maxDistance / magnitude : 1;
    const x = dx * scale;
    const y = dy * scale;
    this.joystickX = x / maxDistance;
    this.joystickY = y / maxDistance;
    this.stick.style.transform = `translate(${x}px, ${y}px)`;
  }

  queueJump(): void { this.jumpQueued = true; }

  consumeJump(): boolean {
    const queued = this.jumpQueued;
    this.jumpQueued = false;
    return queued;
  }

  update(): void {
    const right = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    let x = right + this.joystickX;
    let z = forward - this.joystickY;
    const length = Math.hypot(x, z);
    if (length > 1) { x /= length; z /= length; }
    this.moveRight = x;
    this.moveForward = z;
  }

  reset(): void {
    this.keys.clear();
    this.moveForward = 0; this.moveRight = 0;
    this.joystickX = 0; this.joystickY = 0;
    this.jumpQueued = false;
    this.cameraPointer = null;
    this.joystickPointer = null;
    this.jumpPointer = null;
    this.stick.style.transform = 'translate(0px, 0px)';
    this.jumpButton.classList.remove('pressed');
  }
}

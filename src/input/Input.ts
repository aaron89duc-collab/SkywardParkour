/** characters a Vietnamese input method (Telex) types in place of the key just pressed: w → ư / ơ / ă (uw, ow, aw),
 *  aa → â, dd → đ, s → the acute tone on the vowel before it */
const IME_MOVE: Record<string, string> = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', 'â': 'KeyA', 'đ': 'KeyD' };
for (const c of 'ươă') IME_MOVE[c] = 'KeyW';
for (const c of 'áấắéếíóốớúứý') IME_MOVE[c] = 'KeyS';

/**
 * Unified input: keyboard/mouse and touch both write into the same command set.
 * The player controller only ever reads these commands (no platform-specific gameplay code).
 */
export class Input {
  // continuous
  moveX = 0; // -1..1 (right)
  moveY = 0; // -1..1 (forward)
  jumpHeld = false;
  // latched edges (consumed by the fixed-step simulation)
  private jumpLatch = false;
  private dropLatch = false;
  private pauseLatch = false;
  // camera deltas (accumulated per frame)
  lookX = 0;
  lookY = 0;
  zoom = 0;

  // sources
  private keys = new Set<string>();
  /** movement keys seen only through a Vietnamese input method (code -> expiry, ms): see onKey */
  private imeKeys = new Map<string, number>();
  /** called once when a Vietnamese input method (Unikey / EVKey, Telex or VNI) is seen eating W A S D */
  onImeDetected: (() => void) | null = null;
  private imeNoticed = false;
  touchMoveX = 0;
  touchMoveY = 0;
  touchJumpHeld = false;
  touchDropHeld = false;
  usingTouch = false;
  pointerLocked = false;
  enabled = false;
  private dragging = false;
  private lastMouse = { x: 0, y: 0 };
  onPointerLockLost: (() => void) | null = null;
  lastInputTime = 0;
  /** real (event-timestamped) duration of the last completed jump press, seconds; consumed by the player.
   *  Lets a 30 FPS phone and a 144 Hz PC turn the same tap into the same jump arc. */
  private jumpDownAt = -1;
  private heldFor: number | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.imeKeys.clear(); this.jumpHeld = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.usingTouch) return;
      if (e.button === 0 && !this.pointerLocked && canvas.requestPointerLock) {
        try {
          const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          if (p && typeof p.catch === 'function') p.catch(() => { this.dragging = true; });
        } catch { this.dragging = true; }
      }
      if (!this.pointerLocked) { this.dragging = true; this.lastMouse = { x: e.clientX, y: e.clientY }; }
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      } else if (this.dragging) {
        this.lookX += e.clientX - this.lastMouse.x;
        this.lookY += e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('wheel', (e) => { if (this.enabled) { this.zoom += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const was = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === canvas;
      if (was && !this.pointerLocked && this.onPointerLockLost) this.onPointerLockLost();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    // typing in a text field (admin password) is not game input
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    // A Vietnamese input method (Unikey, EVKey… in Telex: w → ư, aa → â, dd → đ, s = tone mark) swallows the
    // letter key and types its own character instead: the browser then sees a key with no physical code
    // (or 'Process'), so W A S D seem dead now and then while the arrow keys always work. Read those
    // characters as the movement key they came from; they hold for a moment and are refreshed by key repeat.
    if (!k || k === 'Unidentified' || e.key === 'Process') {
      const code = IME_MOVE[e.key] ?? IME_MOVE[e.key?.toLowerCase?.() ?? ''];
      if (code || e.key === 'Process') this.noticeIme();
      if (code && down) { this.imeKeys.set(code, performance.now() + 650); this.lastInputTime = performance.now(); }
      return;
    }
    if (down) {
      if (e.repeat) return;
      this.keys.add(k);
      this.lastInputTime = performance.now();
      if (k === 'Space') this.pressJump(e.timeStamp);
      if (k === 'Escape' || k === 'KeyP') this.pauseLatch = true;
    } else {
      this.keys.delete(k);
      this.imeKeys.delete(k);
      if (k === 'Space') this.releaseJump(e.timeStamp);
    }
  }

  private noticeIme() {
    if (this.imeNoticed || !this.enabled) return;
    this.imeNoticed = true;
    this.onImeDetected?.();
  }
  private has(code: string) {
    if (this.keys.has(code)) return true;
    const t = this.imeKeys.get(code);
    return t !== undefined && t > performance.now();
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Called once per rendered frame before simulation. */
  update() {
    const k = this.keys;
    let x = 0, y = 0;
    if (this.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (this.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (this.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (this.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    const walk = k.has('ControlLeft') || k.has('AltLeft');
    if (x !== 0 || y !== 0) {
      const len = Math.hypot(x, y);
      x /= len; y /= len;
      if (walk) { x *= 0.45; y *= 0.45; }
    } else {
      x = this.touchMoveX;
      y = this.touchMoveY;
    }
    this.moveX = x;
    this.moveY = y;
    this.jumpHeld = k.has('Space') || this.touchJumpHeld;
  }

  pressJump(at = performance.now()) { this.jumpLatch = true; this.lastInputTime = performance.now(); this.jumpDownAt = at; this.heldFor = null; }
  releaseJump(at = performance.now()) { if (this.jumpDownAt >= 0) this.heldFor = Math.max(0, (at - this.jumpDownAt) / 1000); this.jumpDownAt = -1; }
  consumeHeldFor() { const v = this.heldFor; this.heldFor = null; return v; }
  /** admin fly mode only (touch XUỐNG); gameplay has no drop button: run, steer and jump */
  pressDrop() { this.dropLatch = true; }
  /** raw key state (admin fly controls) */
  isDown(code: string) { return this.keys.has(code); }
  pressPause() { this.pauseLatch = true; }

  consumeJump() { const v = this.jumpLatch; this.jumpLatch = false; return v; }
  consumeDrop() { const v = this.dropLatch; this.dropLatch = false; return v; }
  consumePause() { const v = this.pauseLatch; this.pauseLatch = false; return v; }
  peekJump() { return this.jumpLatch; }

  consumeLook() {
    const r = { x: this.lookX, y: this.lookY, zoom: this.zoom };
    this.lookX = 0; this.lookY = 0; this.zoom = 0;
    return r;
  }

  clearEdges() { this.jumpLatch = false; this.dropLatch = false; this.pauseLatch = false; this.lookX = 0; this.lookY = 0; this.zoom = 0; }
}

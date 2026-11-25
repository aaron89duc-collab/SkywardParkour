// Gameplay & engine tuning. One place to adjust the feel of the game.

export const PHYS = {
  fixedDt: 1 / 60,
  maxSubSteps: 5,

  // Gravity: lighter on the way up, heavier on the way down (snappy platforming)
  gravityUp: 30,
  gravityDown: 42,
  terminalVelocity: 48,

  // Jump: v = sqrt(2 * gUp * apex) -> apex ~2.55 m (tap = lower hop, hold = full height)
  jumpVelocity: 12.4,
  // Variable jump, decided only by how long the button was held (frame-rate independent, same tap = same arc):
  // released within jumpHoldWindow -> apex between jumpMinApex and the full apex; held longer -> full jump.
  jumpHoldWindow: 0.18,
  jumpMinApex: 1.5,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,

  runSpeed: 7.0,
  walkSpeed: 3.0,
  groundAccel: 55,
  groundDecel: 50, // release the stick: stop quickly (~0.14 s from a run) without a jolt
  airAccel: 20, // air control ~35% of the ground: steer and brake, never snap direction
  airDecel: 1.5, // stick released mid-air: momentum is kept (a slipping thumb does not kill the jump)
  turnSpeedGround: 14,
  turnSpeedAir: 5,

  // Capsule: total height = 2 * (halfHeight + radius) = 1.6 m
  capsuleRadius: 0.3,
  capsuleHalfHeight: 0.5,
  skin: 0.02,
  stepHeight: 0.42,
  stepMinWidth: 0.15,
  snapDistance: 0.35,
  maxSlopeDeg: 58,
  minSlideDeg: 58,

  ledge: {
    minRel: 0.95, // ledge height above feet that triggers a hang
    maxRel: 2.05,
    reach: 0.75, // probe length beyond the capsule radius
    regrabCooldown: 0.45,
    climbTime: 0.95,
    lowerTime: 0.75, // climbing down from a top into a hang
    letGoTime: 0.45, // hanging: hold the stick away from the wall this long to let go (no drop button)
    maxUpVelocity: 7.0,
    assist: 0.2, // smart grab: ledge up to this much above reach at the apex, or this far to the side, still catches
    // missteps: walking over an edge is a fall, not an automatic hang. A quick pull back toward the edge saves it.
    reflexWindow: 0.4, // seconds after leaving an edge (no jump) during which pulling the stick back grabs it
    reflexMaxDrop: 2.3, // ...as long as the feet are at most this far below the edge (hands still reach it)
    reflexMantleBelow: 0.8, // ...pulled back this early: straight back up onto the edge instead of hanging
    slipTime: 0.22, // walking (not running) over an edge: the body tips over first, gravity x slipGravity
    slipGravity: 0.5,
    slipMaxSpeed: 3.8,
    catchMaxFallSpeed: 15, // falling faster than this (about 2.7 m of free fall) -> hands cannot hold on
    mantleMinRel: 0.3, // ledge just above the feet while airborne -> pull up instead of falling
    mantleMaxRel: 1.25,
    shimmyCycle: 1.25, // seconds per hand-over-hand step
    shimmyStep: 0.95, // metres per step
    pushOff: { out: 6.2, up: 9.0, prep: 0.2 },
  },
  vault: { minSpeed: 3.6, minRel: 0.45, maxRel: 1.3, maxDepth: 1.15 },
  roll: { minDrop: 3.0, maxDrop: 24, minSpeed: 3.4, time: 0.62 },

  hardLandingDrop: 9, // metres fallen before a heavy landing animation
  safetyFloorY: -60, // anti soft-lock only (not a checkpoint)
};

export const CAMERA = {
  fov: 60,
  distance: 7,
  minDistance: 2.5,
  maxDistance: 14,
  pitchMin: -0.45,
  pitchMax: 1.3,
  startPitch: 0.32,
  targetHeight: 1.45,
  followSharpness: 14,
  verticalFollowSharpness: 10,
  collisionRadius: 0.25,
  mouseSensitivity: 0.0026,
  touchSensitivity: 0.0055,
};

export const COLLISION = {
  // membership << 16 | filter
  WORLD: (0x0001 << 16) | 0xffff,
  BOUNDARY: (0x0004 << 16) | 0x0002,
  PLAYER: (0x0002 << 16) | (0x0001 | 0x0004),
  QUERY_SOLID: (0x0008 << 16) | 0x0001, // camera / ledge probes: real geometry only
  QUERY_PLAYER_MOVE: (0x0002 << 16) | (0x0001 | 0x0004),
};

export type Quality = 'low' | 'medium' | 'high';

/** WebGL renderer string (e.g. "ANGLE (Intel, Intel(R) UHD Graphics 620 ...)"). */
export function gpuName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}

const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high'];
export function lowerQuality(q: Quality): Quality | null {
  const i = QUALITY_ORDER.indexOf(q);
  return i > 0 ? QUALITY_ORDER[i - 1] : null;
}
export function minQuality(a: Quality, b: Quality): Quality {
  return QUALITY_ORDER.indexOf(a) < QUALITY_ORDER.indexOf(b) ? a : b;
}

export function detectDefaultQuality(): Quality {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  if (mobile) return 'low';
  const gpu = gpuName().toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(gpu)) return 'low';
  // discrete GPUs (and Apple Pro/Max chips) get the full look; integrated graphics start at medium
  if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc\(tm\) a|arc a\d|apple m\d (pro|max|ultra)/.test(gpu)) return 'high';
  return 'medium';
}

export const QUALITY_PRESETS: Record<Quality, { pixelRatio: number; maxPixels: number; shadows: boolean; shadowMap: number; bloom: boolean; clouds: number; grass: number; lodDistance: number; antialias: boolean }> = {
  // maxPixels caps the drawing buffer (CSS px * pixelRatio^2): a 4K / retina laptop would otherwise draw 8+ MP
  // low: no shadow map at all (the player keeps a blob shadow) – the shadow pass drew about half of the triangles
  low: { pixelRatio: 1, maxPixels: 0.9e6, shadows: false, shadowMap: 1024, bloom: false, clouds: 50, grass: 0.35, lodDistance: 18, antialias: false },
  medium: { pixelRatio: 1.25, maxPixels: 1.6e6, shadows: true, shadowMap: 1024, bloom: false, clouds: 85, grass: 0.65, lodDistance: 28, antialias: true },
  high: { pixelRatio: 2, maxPixels: 3.6e6, shadows: true, shadowMap: 2048, bloom: true, clouds: 140, grass: 1, lodDistance: 52, antialias: true },
};

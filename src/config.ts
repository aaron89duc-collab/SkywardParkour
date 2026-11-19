// Gameplay & engine tuning. One place to adjust the feel of the game.

export const PHYS = {
  fixedDt: 1 / 60,
  maxSubSteps: 5,

  // Gravity: lighter on the way up, heavier on the way down (snappy platforming)
  gravityUp: 30,
  gravityDown: 42,
  terminalVelocity: 48,

  // Jump: v = sqrt(2 * gUp * apex) -> apex ~2.1 m
  jumpVelocity: 11.2,
  jumpCutMultiplier: 0.45, // variable jump height: releasing early cuts upward speed
  coyoteTime: 0.12,
  jumpBuffer: 0.14,

  runSpeed: 7.0,
  walkSpeed: 3.0,
  groundAccel: 55,
  groundDecel: 65,
  airAccel: 17, // air control: can steer, but not snap direction
  airDecel: 3,
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
    minRel: 0.95, // ledge height above feet that triggers a grab
    maxRel: 2.05,
    reach: 0.7, // forward probe length beyond capsule radius
    regrabCooldown: 0.45,
    climbTime: 1.0,
    maxUpVelocity: 7.0,
  },

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

export function detectDefaultQuality(): Quality {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  if (mobile) return 'low';
  return 'high';
}

export const QUALITY_PRESETS: Record<Quality, { pixelRatio: number; shadows: boolean; shadowMap: number; bloom: boolean; clouds: number; grass: number; lodDistance: number; antialias: boolean }> = {
  low: { pixelRatio: 1, shadows: true, shadowMap: 1024, bloom: false, clouds: 70, grass: 0.45, lodDistance: 28, antialias: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 2048, bloom: false, clouds: 110, grass: 0.75, lodDistance: 45, antialias: true },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, bloom: true, clouds: 150, grass: 1, lodDistance: 65, antialias: true },
};

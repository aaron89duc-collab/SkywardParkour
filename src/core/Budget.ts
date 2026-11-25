// Cooperative loading: long synchronous work (collision meshes, geometry) gives the browser a frame now and then, so
// a map streaming in while the player climbs never freezes the game for a few hundred milliseconds.
let last = performance.now();

/** yield to the browser when the current task has been running for more than `ms` */
export async function breathe(ms = 8) {
  const now = performance.now();
  if (now - last < ms) return;
  await new Promise<void>((r) => setTimeout(r, 0));
  last = performance.now();
}

import * as THREE from 'three';

/** Procedural stylized textures (generated at runtime, zero download). */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  return { c, g };
}

function toTex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function noiseSpeckle(g: CanvasRenderingContext2D, size: number, r: () => number, n: number, colorFn: () => string, maxR: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colorFn();
    const x = r() * size, y = r() * size, rr = r() * maxR + 0.5;
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.fill();
  }
}

export function woodPlanks(seed = 1, hue = 27) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  const rows = 4, ph = S / rows;
  for (let i = 0; i < rows; i++) {
    const l = 38 + r() * 10;
    g.fillStyle = hsl(hue + r() * 6 - 3, 52, l);
    g.fillRect(0, i * ph, S, ph);
    // grain
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = hsl(hue, 45, l - 8 - r() * 8, 0.35);
      g.lineWidth = 1 + r() * 2;
      const y = i * ph + r() * ph;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 3 * r());
      g.stroke();
    }
    // highlight & gap
    g.fillStyle = hsl(hue, 60, l + 12, 0.35);
    g.fillRect(0, i * ph + 3, S, 5);
    g.fillStyle = hsl(hue, 50, 16, 0.95);
    g.fillRect(0, i * ph, S, 4);
    // plank joints + nails
    const off = r() * S;
    for (const jx of [off % S, (off + S / 2) % S]) {
      g.fillStyle = hsl(hue, 50, 18, 0.9);
      g.fillRect(jx, i * ph, 4, ph);
      g.fillStyle = hsl(30, 10, 22);
      for (const ny of [0.3, 0.7]) { g.beginPath(); g.arc(jx + 12, i * ph + ph * ny, 4, 0, 7); g.arc(jx - 8, i * ph + ph * ny, 4, 0, 7); g.fill(); }
    }
  }
  return toTex(c);
}

export function crateTex(seed = 2) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(28, 55, 42);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = hsl(27 + r() * 6, 52, 40 + r() * 8);
    g.fillRect(0, (i * S) / 4, S, S / 4 - 3);
  }
  // grain
  for (let k = 0; k < 80; k++) {
    g.strokeStyle = hsl(25, 45, 28, 0.25);
    g.lineWidth = 1.5;
    const y = r() * S;
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 8); g.stroke();
  }
  // diagonal braces
  g.lineCap = 'butt';
  g.strokeStyle = hsl(26, 50, 30);
  g.lineWidth = 64;
  g.beginPath(); g.moveTo(40, 40); g.lineTo(S - 40, S - 40); g.moveTo(S - 40, 40); g.lineTo(40, S - 40); g.stroke();
  g.strokeStyle = hsl(28, 58, 47);
  g.lineWidth = 50;
  g.beginPath(); g.moveTo(40, 40); g.lineTo(S - 40, S - 40); g.moveTo(S - 40, 40); g.lineTo(40, S - 40); g.stroke();
  // frame
  g.lineWidth = 70;
  g.strokeStyle = hsl(26, 50, 30);
  g.strokeRect(35, 35, S - 70, S - 70);
  g.lineWidth = 56;
  g.strokeStyle = hsl(29, 60, 50);
  g.strokeRect(35, 35, S - 70, S - 70);
  // nails
  g.fillStyle = hsl(30, 8, 25);
  for (const [x, y] of [[35, 35], [S - 35, 35], [35, S - 35], [S - 35, S - 35], [S / 2, 35], [S / 2, S - 35], [35, S / 2], [S - 35, S / 2]]) {
    g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
  }
  return toTex(c, false);
}

export function barrelTex(seed = 3) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  const staves = 12, w = S / staves;
  for (let i = 0; i < staves; i++) {
    g.fillStyle = hsl(26 + r() * 6, 55, 36 + r() * 10);
    g.fillRect(i * w, 0, w, S);
    g.fillStyle = hsl(25, 50, 18, 0.9);
    g.fillRect(i * w, 0, 3, S);
    g.fillStyle = hsl(30, 60, 60, 0.25);
    g.fillRect(i * w + 6, 0, 6, S);
  }
  for (const y of [0.12, 0.3, 0.7, 0.88]) {
    g.fillStyle = hsl(210, 8, 30);
    g.fillRect(0, y * S - 14, S, 28);
    g.fillStyle = hsl(210, 10, 52, 0.7);
    g.fillRect(0, y * S - 14, S, 6);
  }
  return toTex(c);
}

export function barkTex(seed = 4) {
  const S = 256, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(28, 45, 34);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = hsl(25, 40, 20 + r() * 14, 0.6);
    g.lineWidth = 2 + r() * 4;
    const x = r() * S;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= S; y += 16) g.lineTo(x + Math.sin(y * 0.05 + i) * 4, y);
    g.stroke();
  }
  g.fillStyle = hsl(32, 50, 55, 0.18);
  for (let i = 0; i < 30; i++) g.fillRect(r() * S, r() * S, 3, 20 + r() * 30);
  return toTex(c);
}

export function logEndTex() {
  const S = 256, { c, g } = canvas(S);
  g.fillStyle = hsl(30, 40, 30);
  g.fillRect(0, 0, S, S);
  for (let i = 10; i > 0; i--) {
    g.fillStyle = i % 2 ? hsl(36, 60, 62) : hsl(33, 55, 54);
    g.beginPath(); g.arc(S / 2, S / 2, (i / 10) * (S / 2 - 14), 0, 7); g.fill();
  }
  g.strokeStyle = hsl(28, 45, 30); g.lineWidth = 16;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 10, 0, 7); g.stroke();
  return toTex(c, false);
}

export function stoneBrick(seed = 5, mossy = true) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(220, 8, 40);
  g.fillRect(0, 0, S, S);
  const rows = 6, bh = S / rows;
  for (let i = 0; i < rows; i++) {
    const off = i % 2 ? 0 : 64;
    for (let x = -128 + off; x < S; x += 128) {
      const l = 58 + r() * 12;
      g.fillStyle = hsl(215 + r() * 15, 9 + r() * 6, l);
      const rr = 14;
      const bx = x + 5, by = i * bh + 5, bw = 118, bhh = bh - 10;
      g.beginPath();
      g.moveTo(bx + rr, by); g.lineTo(bx + bw - rr, by); g.quadraticCurveTo(bx + bw, by, bx + bw, by + rr);
      g.lineTo(bx + bw, by + bhh - rr); g.quadraticCurveTo(bx + bw, by + bhh, bx + bw - rr, by + bhh);
      g.lineTo(bx + rr, by + bhh); g.quadraticCurveTo(bx, by + bhh, bx, by + bhh - rr);
      g.lineTo(bx, by + rr); g.quadraticCurveTo(bx, by, bx + rr, by); g.fill();
      g.fillStyle = hsl(210, 20, l + 14, 0.5);
      g.fillRect(bx + 8, by + 6, bw - 16, 6);
      g.fillStyle = hsl(220, 10, l - 16, 0.45);
      g.fillRect(bx + 6, by + bhh - 9, bw - 12, 6);
    }
  }
  noiseSpeckle(g, S, r, 900, () => hsl(220, 6, 30 + r() * 40, 0.15), 2.5);
  if (mossy) noiseSpeckle(g, S, r, 260, () => hsl(95 + r() * 20, 55, 38 + r() * 12, 0.55), 7);
  return toTex(c);
}

export function grassTex(seed = 6, scale = 1) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(98, 52, 45);
  g.fillRect(0, 0, S, S);
  noiseSpeckle(g, S, r, 260 * scale, () => hsl(90 + r() * 25, 50 + r() * 15, 38 + r() * 18, 0.35), 26);
  for (let i = 0; i < 3500; i++) {
    const x = r() * S, y = r() * S, l = 6 + r() * 8;
    g.strokeStyle = hsl(85 + r() * 25, 60, 40 + r() * 25, 0.7);
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 5, y - l); g.stroke();
  }
  noiseSpeckle(g, S, r, 40, () => (r() > 0.5 ? hsl(50, 90, 75, 0.9) : hsl(0, 0, 98, 0.9)), 2.5);
  return toTex(c);
}

export function cobbleTex(seed = 7) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(35, 12, 38);
  g.fillRect(0, 0, S, S);
  const cells = 9;
  for (let iy = 0; iy < cells; iy++) for (let ix = 0; ix < cells; ix++) {
    const cx = ((ix + 0.5 + (r() - 0.5) * 0.4) * S) / cells, cy = ((iy + 0.5 + (r() - 0.5) * 0.4) * S) / cells;
    const rad = (S / cells) * (0.42 + r() * 0.08);
    const l = 62 + r() * 14;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.fillStyle = hsl(30 + r() * 15, 14, l);
      g.beginPath();
      g.ellipse(cx + ox, cy + oy, rad, rad * (0.8 + r() * 0.2), r() * 3, 0, 7);
      g.fill();
      g.fillStyle = hsl(40, 25, l + 10, 0.4);
      g.beginPath(); g.ellipse(cx + ox - rad * 0.15, cy + oy - rad * 0.2, rad * 0.6, rad * 0.4, 0, 0, 7); g.fill();
    }
  }
  noiseSpeckle(g, S, r, 120, () => hsl(95, 50, 40, 0.5), 5);
  return toTex(c);
}

export function rockTex(seed = 8) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(225, 9, 52);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, w = 40 + r() * 120, h = 30 + r() * 60;
    g.fillStyle = hsl(220 + r() * 15, 8 + r() * 6, 45 + r() * 22, 0.8);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + r() * 10); g.lineTo(x + w - r() * 20, y + h); g.lineTo(x - r() * 10, y + h - r() * 10); g.closePath(); g.fill();
    g.strokeStyle = hsl(225, 10, 30, 0.4); g.lineWidth = 3; g.stroke();
  }
  noiseSpeckle(g, S, r, 160, () => hsl(95 + r() * 20, 55, 40, 0.5), 9);
  return toTex(c);
}

export function ropeTex() {
  const S = 128, { c, g } = canvas(S);
  g.fillStyle = hsl(40, 45, 62);
  g.fillRect(0, 0, S, S);
  g.strokeStyle = hsl(35, 40, 42);
  g.lineWidth = 8;
  for (let i = -S; i < S * 2; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S * 0.6, S); g.stroke(); }
  return toTex(c);
}

/** Soft round puff used by clouds, mist and dust particles. */
export function softPuff(size = 128) {
  const { c, g } = canvas(size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cartoon cumulus cloud sprite made of overlapping shaded puffs. */
export function cloudTex(seed = 9) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  const puffs: [number, number, number][] = [];
  const n = 9 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = W * (0.16 + t * 0.68) + (r() - 0.5) * 30;
    const rad = H * (0.16 + Math.sin(t * Math.PI) * 0.2 + r() * 0.08);
    const y = H * 0.68 - rad * 0.55 + (r() - 0.5) * 16;
    puffs.push([x, y, rad]);
  }
  // shadow pass
  for (const [x, y, rad] of puffs) {
    const grd = g.createRadialGradient(x, y + rad * 0.25, rad * 0.2, x, y + rad * 0.2, rad);
    grd.addColorStop(0, 'rgba(205,220,240,0.95)');
    grd.addColorStop(0.8, 'rgba(200,215,238,0.85)');
    grd.addColorStop(1, 'rgba(200,215,238,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y + rad * 0.12, rad, 0, 7); g.fill();
  }
  // light pass
  for (const [x, y, rad] of puffs) {
    const grd = g.createRadialGradient(x - rad * 0.25, y - rad * 0.35, rad * 0.1, x, y, rad * 0.95);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.7, 'rgba(250,252,255,0.9)');
    grd.addColorStop(1, 'rgba(245,250,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y - rad * 0.05, rad * 0.9, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTex(color = '255,230,170') {
  const S = 128, { c, g } = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `rgba(${color},1)`);
  grd.addColorStop(0.25, `rgba(${color},0.55)`);
  grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function flareRing() {
  const S = 128, { c, g } = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.75, 'rgba(255,240,210,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

import * as THREE from 'three';
import { lang, type Lang } from '../i18n';

/** Procedural textures for Map 002 – Rooftop City (generated at runtime, zero download). */

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

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function toTex(c: HTMLCanvasElement, repeat = true, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function speckle(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number, col: () => string, maxR = 1.5) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = col();
    g.fillRect(r() * w, r() * h, 1 + r() * maxR, 1 + r() * maxR);
  }
}

/** Facade styles. One texture = 4 bays x 4 floors = 12 m x 13.2 m (see FACADE_TILE). */
export type FacadeStyle = 'brick' | 'tan' | 'stucco' | 'mint' | 'peach' | 'concrete' | 'glass' | 'blue';
export const FACADE_TILE = { u: 12, v: 13.2 };

const FACADE: Record<FacadeStyle, { wall: [number, number, number]; brick: boolean; frame: string; trim: string; glass: 'sky' | 'dark' | 'curtain' }> = {
  brick: { wall: [10, 52, 40], brick: true, frame: '#f1ebe0', trim: '#d9cdb8', glass: 'sky' },
  tan: { wall: [30, 45, 58], brick: true, frame: '#fbf6ec', trim: '#e4d5bb', glass: 'sky' },
  stucco: { wall: [42, 70, 80], brick: false, frame: '#5d8fb5', trim: '#f4ecd9', glass: 'sky' },
  mint: { wall: [160, 32, 72], brick: false, frame: '#f7f2e8', trim: '#e8efe9', glass: 'sky' },
  peach: { wall: [18, 72, 76], brick: false, frame: '#ffffff', trim: '#f9e4d6', glass: 'sky' },
  concrete: { wall: [210, 8, 70], brick: false, frame: '#3b4652', trim: '#c9ced3', glass: 'dark' },
  blue: { wall: [212, 38, 54], brick: false, frame: '#e9eef3', trim: '#c0cfdc', glass: 'sky' },
  glass: { wall: [205, 30, 36], brick: false, frame: '#9fb3c4', trim: '#9fb3c4', glass: 'curtain' },
};

const facadeCache = new Map<string, THREE.Texture>();
export function facadeTex(style: FacadeStyle, seed = 1, blank = false) {
  const key = `${style}:${seed}:${blank}`;
  const hit = facadeCache.get(key);
  if (hit) return hit;
  const S = 1024, { c, g } = canvas(S), r = rng(seed * 7919 + style.length * 31);
  const st = FACADE[style];
  const [h0, s0, l0] = st.wall;
  g.fillStyle = hsl(h0, s0, l0);
  g.fillRect(0, 0, S, S);
  if (st.brick) {
    // running-bond brick courses
    const bh = 14, bw = 40;
    for (let y = 0; y < S; y += bh) {
      const off = ((y / bh) % 2) * (bw / 2);
      for (let x = -bw; x < S + bw; x += bw) {
        g.fillStyle = hsl(h0 + r() * 8 - 4, s0 + r() * 10 - 5, l0 + r() * 10 - 5);
        g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
    g.fillStyle = 'rgba(40,20,10,0.08)';
    for (let y = 0; y < S; y += bh) g.fillRect(0, y, S, 2);
  } else if (style === 'glass') {
    // curtain wall: panels with mullions
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 8; bx++) {
      const x = bx * 128, y = by * 256;
      const grd = g.createLinearGradient(x, y, x + 60, y + 256);
      grd.addColorStop(0, '#9fd3f0');
      grd.addColorStop(0.5, '#5e9ccc');
      grd.addColorStop(1, '#3d6f9d');
      g.fillStyle = grd;
      g.fillRect(x + 4, y + 4, 120, 248);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.moveTo(x + 20, y + 250); g.lineTo(x + 60, y + 4); g.lineTo(x + 80, y + 4); g.lineTo(x + 40, y + 250); g.fill();
      if (r() < 0.25) { g.fillStyle = 'rgba(255,214,140,0.25)'; g.fillRect(x + 4, y + 120, 120, 132); }
    }
    g.fillStyle = '#c6d4df';
    for (let by = 0; by <= 4; by++) g.fillRect(0, by * 256 - 5, S, 10);
    for (let bx = 0; bx <= 8; bx++) g.fillRect(bx * 128 - 3, 0, 6, S);
    return cache(key, toTex(c));
  } else {
    // plaster with soft noise
    speckle(g, S, S, r, 9000, () => hsl(h0, s0, l0 + (r() < 0.5 ? -6 : 5), 0.35), 2);
  }
  // 4 x 4 bays
  if (!blank) for (let fy = 0; fy < 4; fy++) for (let bx = 0; bx < 4; bx++) {
    const x0 = bx * 256, y0 = fy * 256;
    // floor band
    g.fillStyle = st.trim;
    g.globalAlpha = st.brick ? 0.85 : 0.6;
    g.fillRect(x0, y0 + 246, 256, 10);
    g.globalAlpha = 1;
    const wx = x0 + 62, wy = y0 + 48, ww = 132, wh = 150;
    // frame + glass
    g.fillStyle = st.frame;
    g.fillRect(wx - 9, wy - 9, ww + 18, wh + 18);
    if (st.glass === 'dark') {
      const grd = g.createLinearGradient(wx, wy, wx, wy + wh);
      grd.addColorStop(0, '#5f7487'); grd.addColorStop(1, '#2c3a48');
      g.fillStyle = grd;
    } else {
      const grd = g.createLinearGradient(wx, wy, wx + 40, wy + wh);
      grd.addColorStop(0, '#cfeaff'); grd.addColorStop(0.55, '#7fb6dd'); grd.addColorStop(1, '#4a7ca8');
      g.fillStyle = grd;
    }
    g.fillRect(wx, wy, ww, wh);
    // interior variety: curtains / lit room / blinds
    const k = r();
    if (k < 0.22) { g.fillStyle = hsl(r() * 360, 45, 62, 0.85); g.fillRect(wx, wy, ww * 0.32, wh); g.fillRect(wx + ww * 0.68, wy, ww * 0.32, wh); }
    else if (k < 0.34) { g.fillStyle = 'rgba(255,214,140,0.55)'; g.fillRect(wx, wy, ww, wh); }
    else if (k < 0.46) { g.fillStyle = 'rgba(235,235,225,0.75)'; for (let yy = wy; yy < wy + wh * 0.55; yy += 9) g.fillRect(wx, yy, ww, 5); }
    // reflection streak
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.moveTo(wx + 14, wy + wh); g.lineTo(wx + 64, wy); g.lineTo(wx + 86, wy); g.lineTo(wx + 36, wy + wh); g.fill();
    // mullions
    g.fillStyle = st.frame;
    g.fillRect(wx + ww / 2 - 4, wy, 8, wh);
    g.fillRect(wx, wy + wh * 0.38, ww, 7);
    // sill
    g.fillStyle = st.trim;
    g.fillRect(wx - 16, wy + wh + 8, ww + 32, 12);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(wx - 16, wy + wh + 20, ww + 32, 5);
    // flower boxes / shutters
    if (style !== 'concrete' && r() < 0.18) {
      g.fillStyle = '#8a5a35'; g.fillRect(wx - 6, wy + wh + 2, ww + 12, 16);
      for (let i = 0; i < 9; i++) { g.fillStyle = r() < 0.5 ? hsl(110 + r() * 30, 50, 38) : hsl(r() < 0.5 ? 350 : 45, 75, 60); g.beginPath(); g.arc(wx + 4 + i * 15, wy + wh, 9, 0, Math.PI * 2); g.fill(); }
    } else if ((style === 'stucco' || style === 'mint' || style === 'peach') && r() < 0.5) {
      g.fillStyle = hsl(r() < 0.5 ? 200 : 140, 30, 42);
      g.fillRect(wx - 44, wy - 4, 30, wh + 8); g.fillRect(wx + ww + 14, wy - 4, 30, wh + 8);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let yy = wy; yy < wy + wh; yy += 10) { g.fillRect(wx - 44, yy, 30, 3); g.fillRect(wx + ww + 14, yy, 30, 3); }
    }
  }
  // grime streaks
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(30,25,20,${0.03 + r() * 0.04})`;
    g.fillRect(r() * S, r() * S, 3 + r() * 6, 40 + r() * 140);
  }
  return cache(key, toTex(c));
}

function cache(key: string, t: THREE.Texture) { facadeCache.set(key, t); return t; }

/** Flat roof: tar membrane with gravel and seams (repeat every 4 m). */
export function roofTex(seed = 3) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = '#7d7f84';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, r, 26000, () => (r() < 0.5 ? 'rgba(60,62,66,0.5)' : 'rgba(170,170,165,0.45)'), 2);
  g.strokeStyle = 'rgba(40,40,45,0.35)';
  g.lineWidth = 4;
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(0, i * 256); g.lineTo(S, i * 256); g.stroke(); }
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(30,30,30,0.08)'; g.beginPath(); g.ellipse(r() * S, r() * S, 30 + r() * 60, 20 + r() * 40, r() * 3, 0, Math.PI * 2); g.fill(); }
  return toTex(c);
}

/** Light concrete for parapet caps, ledges and landings. */
export function concreteTex(seed = 5, light = 76) {
  const S = 256, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(36, 8, light);
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, r, 5000, () => hsl(30, 6, light + (r() < 0.5 ? -10 : 8), 0.4), 1.5);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);
  return toTex(c);
}

/** Dark painted steel with rivets and scratches. */
export function metalTex(seed = 11, hue = 215, sat = 10, light = 32) {
  const S = 256, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = hsl(hue, sat, light);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 120; i++) { g.strokeStyle = `rgba(255,255,255,${0.03 + r() * 0.06})`; g.lineWidth = 1; const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 30 - 15, y + r() * 6 - 3); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = 16; x < S; x += 64) for (let y = 16; y < S; y += 64) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  return toTex(c);
}

/** Yellow / black hazard stripes. */
export function hazardTex() {
  const S = 256, { c, g } = canvas(S);
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#25272b';
  for (let i = -S; i < S * 2; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 - S, S); g.lineTo(i - S, S); g.fill(); }
  return toTex(c);
}

/** Orange construction steel (girders / scaffolding). */
export function girderTex(seed = 13) {
  const S = 256, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = '#e8862a';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, r, 3000, () => (r() < 0.5 ? 'rgba(120,60,20,0.25)' : 'rgba(255,200,140,0.25)'), 2);
  g.fillStyle = 'rgba(70,40,20,0.45)';
  for (let x = 12; x < S; x += 40) { g.beginPath(); g.arc(x, 14, 4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x, S - 14, 4, 0, Math.PI * 2); g.fill(); }
  return toTex(c);
}

/** Metal floor grating. */
export function grateTex() {
  const S = 128, { c, g } = canvas(S);
  g.fillStyle = '#3a3f46';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#6d747d';
  for (let i = 0; i < S; i += 16) { g.fillRect(i, 0, 4, S); g.fillRect(0, i, S, 3); }
  return toTex(c);
}

/** Sidewalk / plaza paving. */
export function paverTex(seed = 17) {
  const S = 512, { c, g } = canvas(S), r = rng(seed);
  g.fillStyle = '#b9b4aa';
  g.fillRect(0, 0, S, S);
  const n = 8, w = S / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = hsl(36, 8, 66 + r() * 10);
    g.fillRect(x * w + 2, y * w + 2, w - 4, w - 4);
  }
  speckle(g, S, S, r, 6000, () => 'rgba(80,75,70,0.2)', 1.5);
  return toTex(c);
}

/** Striped awning canvas. */
export function awningTex(hue = 355) {
  const S = 256, { c, g } = canvas(S);
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fbf6ee' : hsl(hue, 68, 52); g.fillRect(i * 32, 0, 32, S); }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, S - 30, S, 30);
  return toTex(c);
}

const ADS: { bg: string[]; title: Record<Lang, string>; sub: Record<Lang, string>; fg: string; shape: 'circle' | 'bolt' | 'cup' | 'slice' | 'wing' }[] = [
  { bg: ['#ff6b6b', '#ffb36b'], title: { en: 'SKY COLA', vi: 'SKY COLA' }, sub: { en: 'Ice cold above the clouds', vi: 'Mát lạnh trên mây' }, fg: '#ffffff', shape: 'cup' },
  { bg: ['#3a7bd5', '#00d2ff'], title: { en: 'CLIMB HIGHER', vi: 'BAY CAO HƠN' }, sub: { en: 'Skyward Parkour', vi: 'Skyward Parkour' }, fg: '#ffffff', shape: 'wing' },
  { bg: ['#f7b733', '#fc4a1a'], title: { en: 'ROOFTOP PIZZA', vi: 'PIZZA MÁI NHÀ' }, sub: { en: 'Delivered to your rooftop', vi: 'Giao tận sân thượng' }, fg: '#fffbe8', shape: 'slice' },
  { bg: ['#11998e', '#38ef7d'], title: { en: 'PEAK COFFEE', vi: 'CÀ PHÊ ĐỈNH' }, sub: { en: 'Open 24/7', vi: 'Mở cửa 24/7' }, fg: '#ffffff', shape: 'circle' },
  { bg: ['#8e2de2', '#4a00e0'], title: { en: 'NEON NIGHT', vi: 'NEON NIGHT' }, sub: { en: 'Festival of lights', vi: 'Lễ hội ánh sáng' }, fg: '#ffe6ff', shape: 'bolt' },
  { bg: ['#ee9ca7', '#ffdde1'], title: { en: 'CLOUD BREAD', vi: 'BÁNH MÌ MÂY' }, sub: { en: 'Crispy from floor 1 to 99', vi: 'Giòn từ tầng 1 tới tầng 99' }, fg: '#6b2737', shape: 'circle' },
];
export const AD_COUNT = ADS.length;

/** Billboard poster (2:1). Brands are fictional. */
export function adTex(i: number) {
  const a = ADS[((i % ADS.length) + ADS.length) % ADS.length];
  const W = 512, H = 256, { c, g } = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, a.bg[0]); grd.addColorStop(1, a.bg[1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.14)';
  for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(380 + k * 14, 130, 150 - k * 22, 0, Math.PI * 2); g.fill(); }
  // pictogram
  g.fillStyle = a.fg;
  g.save();
  g.translate(410, 128);
  if (a.shape === 'circle') { g.beginPath(); g.arc(0, 0, 62, 0, Math.PI * 2); g.fill(); g.fillStyle = a.bg[0]; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill(); }
  else if (a.shape === 'cup') { g.beginPath(); g.moveTo(-40, -60); g.lineTo(40, -60); g.lineTo(28, 66); g.lineTo(-28, 66); g.closePath(); g.fill(); g.fillRect(-4, -96, 8, 40); }
  else if (a.shape === 'slice') { g.beginPath(); g.moveTo(-60, -50); g.lineTo(60, -50); g.lineTo(0, 76); g.closePath(); g.fill(); g.fillStyle = '#d63031'; for (const [x, y] of [[-20, -20], [18, -12], [0, 20]]) { g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill(); } }
  else if (a.shape === 'bolt') { g.beginPath(); g.moveTo(10, -80); g.lineTo(-40, 10); g.lineTo(0, 10); g.lineTo(-14, 80); g.lineTo(42, -14); g.lineTo(4, -14); g.closePath(); g.fill(); }
  else { g.beginPath(); g.ellipse(0, 0, 70, 22, -0.4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(-10, 0); g.lineTo(40, -70); g.lineTo(52, -62); g.lineTo(20, 8); g.fill(); }
  g.restore();
  g.fillStyle = a.fg;
  g.font = 'bold 58px "Trebuchet MS", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(a.title[lang()], 26, 104, 330);
  g.font = '600 26px "Trebuchet MS", Arial, sans-serif';
  g.globalAlpha = 0.9;
  g.fillText(a.sub[lang()], 28, 166, 330);
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  return toTex(c, false, 8);
}

/** Big painted street sign ("ROOFTOP CITY") */
export function signTex(text: string, sub: string, bg = '#1f3b57', fg = '#ffd166') {
  const W = 512, H = 128, { c, g } = canvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(8, 8, W - 16, H - 16);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 54px "Trebuchet MS", Arial, sans-serif';
  g.fillText(text, W / 2, 54, W - 40);
  g.font = '600 22px "Trebuchet MS", Arial, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText(sub, W / 2, 98, W - 40);
  return toTex(c, false, 8);
}

/**
 * Street map painted onto the city deck: asphalt, lane markings, sidewalks around every building footprint
 * and a paved station plaza. Footprints are axis-aligned/rotated rectangles in world XZ.
 */
export function deckTex(center: [number, number], radius: number, footprints: { x: number; z: number; w: number; d: number; r: number }[], plazas: { p: [number, number]; r: number }[], streets: { a: [number, number]; b: [number, number]; w: number }[]) {
  const S = 2048, { c, g } = canvas(S), r = rng(99);
  const k = S / (radius * 2);
  const tx = (x: number) => (x - center[0] + radius) * k;
  const tz = (z: number) => (z - center[1] + radius) * k;
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, r, 90000, () => (r() < 0.5 ? 'rgba(30,32,36,0.5)' : 'rgba(110,112,116,0.35)'), 2);
  // streets: centre dashes + edge lines
  for (const s of streets) {
    const ax = tx(s.a[0]), az = tz(s.a[1]), bx = tx(s.b[0]), bz = tz(s.b[1]);
    const len = Math.hypot(bx - ax, bz - az);
    g.save();
    g.translate(ax, az);
    g.rotate(Math.atan2(bz - az, bx - ax));
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (let d = 0; d < len; d += 6 * k) g.fillRect(d, -0.08 * k, 3 * k, 0.16 * k);
    g.fillStyle = 'rgba(255,208,80,0.7)';
    g.fillRect(0, (s.w / 2 - 0.4) * k, len, 0.14 * k);
    g.fillRect(0, -(s.w / 2 - 0.4) * k, len, 0.14 * k);
    g.restore();
  }
  const pav = (fill: string, x: number, z: number, w: number, d: number, rot: number) => {
    g.save();
    g.translate(tx(x), tz(z));
    g.rotate(-rot);
    g.fillStyle = fill;
    g.fillRect((-w / 2) * k, (-d / 2) * k, w * k, d * k);
    g.restore();
  };
  // sidewalks (curb shadow first)
  for (const f of footprints) pav('rgba(0,0,0,0.25)', f.x, f.z, f.w + 5.2, f.d + 5.2, f.r);
  for (const f of footprints) pav('#a9a59c', f.x, f.z, f.w + 4.8, f.d + 4.8, f.r);
  // paver joints on sidewalks
  for (const f of footprints) {
    g.save();
    g.translate(tx(f.x), tz(f.z));
    g.rotate(-f.r);
    const w = (f.w + 4.8) * k, d = (f.d + 4.8) * k;
    g.beginPath(); g.rect(-w / 2, -d / 2, w, d); g.clip();
    g.strokeStyle = 'rgba(92,88,80,0.25)';
    g.lineWidth = 1;
    for (let x = -w / 2; x < w / 2; x += k * 1.2) { g.beginPath(); g.moveTo(x, -d / 2); g.lineTo(x, d / 2); g.stroke(); }
    for (let z = -d / 2; z < d / 2; z += k * 1.2) { g.beginPath(); g.moveTo(-w / 2, z); g.lineTo(w / 2, z); g.stroke(); }
    g.restore();
  }
  for (const p of plazas) {
    g.fillStyle = '#c9c1b2';
    g.beginPath(); g.arc(tx(p.p[0]), tz(p.p[1]), p.r * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,100,80,0.45)';
    g.lineWidth = 3;
    for (let rr = 2; rr < p.r; rr += 2) { g.beginPath(); g.arc(tx(p.p[0]), tz(p.p[1]), rr * k, 0, Math.PI * 2); g.stroke(); }
  }
  // building footprints darker (never visible, avoids light seams)
  for (const f of footprints) pav('#55524c', f.x, f.z, f.w, f.d, f.r);
  const t = toTex(c, false, 8);
  return t;
}

import sharp from 'sharp';

/** Render a top-down and two side views (x-y, z-y) of the map + validated path for design review. */
export async function plotMap(B, val, out) {
  const W = 900, S = 4.6; // px per metre (top view covers ~ +-95 m)
  const cx = W / 2, cy = W / 2;
  const col = (y) => {
    const t = Math.max(0, Math.min(1, y / 140));
    const h = 220 - t * 220;
    return `hsl(${h},75%,${45 + t * 10}%)`;
  };
  const items = [];
  const side = [];
  const SW = 900, SH = 760, SS = 4.6, base = SH - 40;
  const sx = (x) => SW / 2 + x * SS;
  const sy = (y) => base - y * 4.6;
  // plateau
  items.push(`<circle cx="${cx}" cy="${cy}" r="${B.meta.radius * S}" fill="#d9efc9" stroke="#8bb07a"/>`);
  for (const o of B.objects) {
    if (o.type === 'prefab') {
      const r = o.radius * S * 0.75;
      items.push(`<circle cx="${cx + o.x * S}" cy="${cy + o.z * S}" r="${r}" fill="${col(o.y + o.s * 0.9)}" fill-opacity="0.35" stroke="${col(o.y + o.s * 0.9)}"/>`);
      if (o.name && !['rock', 'bridge'].includes(o.name)) items.push(`<text x="${cx + o.x * S}" y="${cy + o.z * S}" font-size="10" text-anchor="middle" fill="#222">${o.name} ${(o.y + o.s * 0.9).toFixed(0)}</text>`);
      side.push(`<rect x="${sx(o.x) - o.radius * SS * 0.6}" y="${sy(o.y + o.s)}" width="${o.radius * SS * 1.2}" height="${o.s * 4.6}" fill="${col(o.y + o.s)}" fill-opacity="0.3"/>`);
    } else for (const b of o.boxes) {
      items.push(`<rect x="${cx + (b.c[0] - b.h[0]) * S}" y="${cy + (b.c[2] - b.h[2]) * S}" width="${b.h[0] * 2 * S}" height="${b.h[2] * 2 * S}" fill="${col(b.c[1] + b.h[1])}" transform="rotate(${-o.r} ${cx + b.c[0] * S} ${cy + b.c[2] * S})"/>`);
      side.push(`<rect x="${sx(b.c[0]) - b.h[0] * SS}" y="${sy(b.c[1] + b.h[1])}" width="${b.h[0] * 2 * SS}" height="${Math.max(1, b.h[1] * 2 * 4.6)}" fill="${col(b.c[1] + b.h[1])}"/>`);
    }
  }
  const colors = { main: '#d6336c', S1: '#1c7ed6', S2: '#0ca678', S3: '#f59f00', dead: '#868e96' };
  for (const [name, pts] of Object.entries(B.routes)) {
    const c = colors[name] ?? '#000';
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${cx + q.p[0] * S},${cy + q.p[2] * S}`).join(' ');
    items.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="${name === 'main' ? '' : '5,3'}"/>`);
    const d2 = pts.map((q, i) => `${i ? 'L' : 'M'}${sx(q.p[0])},${sy(q.p[1])}`).join(' ');
    side.push(`<path d="${d2}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="${name === 'main' ? '' : '5,3'}"/>`);
  }
  if (val?.hard?.path) {
    const d = val.hard.path.map((i, k) => `${k ? 'L' : 'M'}${cx + val.nodes[i].x * S},${cy + val.nodes[i].z * S}`).join(' ');
    items.push(`<path d="${d}" fill="none" stroke="#000" stroke-width="1" stroke-opacity="0.5"/>`);
  }
  if (val?.stuck?.length) for (const i of val.stuck.slice(0, 400)) items.push(`<circle cx="${cx + val.nodes[i].x * S}" cy="${cy + val.nodes[i].z * S}" r="2" fill="red"/>`);
  for (let y = 0; y <= 140; y += 20) side.push(`<line x1="0" x2="${SW}" y1="${sy(y)}" y2="${sy(y)}" stroke="#ccc"/><text x="4" y="${sy(y) - 2}" font-size="11">${y}m</text>`);
  const svgTop = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#fff"/>${items.join('')}<text x="10" y="20" font-size="14">TOP (x right, z down = south)</text></svg>`;
  const svgSide = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}"><rect width="100%" height="100%" fill="#fff"/>${side.join('')}<text x="10" y="20" font-size="14">SIDE (x right, y up)</text></svg>`;
  const a = await sharp(Buffer.from(svgTop)).png().toBuffer();
  const b = await sharp(Buffer.from(svgSide)).png().toBuffer();
  await sharp({ create: { width: W + SW, height: Math.max(W, SH), channels: 3, background: '#fff' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: W, top: 0 }]).png().toFile(out);
}

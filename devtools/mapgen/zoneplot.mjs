// Top view of one height band (a zone) with every object's top height: for laying out extra routes by hand.
import sharp from 'sharp';
export async function zonePlot(B, out, { x0, x1, z0, z1, y0, y1, routes = {}, title = '' }) {
  const S = 28, W = (x1 - x0) * S, H = (z1 - z0) * S;
  const px = (x) => (x - x0) * S, pz = (z) => (z - z0) * S;
  const items = [];
  for (let x = Math.ceil(x0); x <= x1; x++) items.push(`<line x1="${px(x)}" x2="${px(x)}" y1="0" y2="${H}" stroke="${x % 5 ? '#eee' : '#ccc'}"/><text x="${px(x) + 1}" y="10" font-size="8" fill="#999">${x % 2 ? '' : x}</text>`);
  for (let z = Math.ceil(z0); z <= z1; z++) items.push(`<line y1="${pz(z)}" y2="${pz(z)}" x1="0" x2="${W}" stroke="${z % 5 ? '#eee' : '#ccc'}"/><text y="${pz(z) - 1}" x="1" font-size="8" fill="#999">${z % 2 ? '' : z}</text>`);
  const col = (t) => `hsl(${220 - Math.max(0, Math.min(1, (t - y0) / (y1 - y0))) * 220},70%,55%)`;
  for (const o of B.objects) {
    if (o.type === 'prefab') {
      if (o.name?.startsWith('deck')) continue;
      const top = o.y + o.s * 0.95;
      if (top < y0 - 1 || o.y > y1 + 1) continue;
      const g = o.g, c = Math.cos((o.r * Math.PI) / 180), sn = Math.sin((o.r * Math.PI) / 180);
      const pts = [[g.minx, g.minz], [g.maxx, g.minz], [g.maxx, g.maxz], [g.minx, g.maxz]].map(([lx, lz]) => [o.x + (lx * c + lz * sn) * o.s, o.z + (-lx * sn + lz * c) * o.s]);
      items.push(`<polygon points="${pts.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="${col(top)}" fill-opacity="0.45" stroke="#333" stroke-width="0.6"/>`);
      items.push(`<text x="${px(o.x)}" y="${pz(o.z) + 4}" font-size="11" text-anchor="middle" font-weight="bold">${(top - y0).toFixed(1)}</text>`);
    } else for (const b of o.boxes ?? []) {
      const top = b.c[1] + b.h[1];
      if (top < y0 - 1 || top > y1 + 1 || o.k === 'wall') continue;
      const r = ((o.r ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [b.c[0] + sx * b.h[0] * c + sz * b.h[2] * sn, b.c[2] - sx * b.h[0] * sn + sz * b.h[2] * c]);
      items.push(`<polygon points="${pts.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="${col(top)}" fill-opacity="0.6" stroke="#000" stroke-width="0.6" stroke-dasharray="3,2"/>`);
      items.push(`<text x="${px(b.c[0])}" y="${pz(b.c[2]) + 4}" font-size="10" text-anchor="middle">${(top - y0).toFixed(1)}${o.name ? ' ' + o.name.slice(0, 8) : ''}</text>`);
    }
  }
  const colors = ['#d6336c', '#1c7ed6', '#0ca678', '#f59f00', '#7048e8'];
  Object.entries(routes).forEach(([name, pts], i) => {
    const sel = pts.filter((q) => q.p[1] >= y0 - 0.5 && q.p[1] <= y1 + 0.5);
    if (sel.length < 1) return;
    items.push(`<path d="${sel.map((q, k) => `${k ? 'L' : 'M'}${px(q.p[0])},${pz(q.p[2])}`).join(' ')}" fill="none" stroke="${colors[i % 5]}" stroke-width="2"/>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 20}"><rect width="100%" height="100%" fill="#fff"/>${items.join('')}<text x="4" y="${H + 15}" font-size="12">${title}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
}

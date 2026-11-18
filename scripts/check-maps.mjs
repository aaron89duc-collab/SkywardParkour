import fs from 'node:fs';
import path from 'node:path';

const mapsDir = path.resolve('public/maps');
const manifest = JSON.parse(fs.readFileSync(path.join(mapsDir, 'manifest.json'), 'utf8'));
let count = 0;
const errors = [];
for (const entry of manifest.maps) {
  const mapPath = path.resolve('public', entry.src.replace(/^\//, ''));
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const surfaces = [...map.platforms, ...map.recoveryDecks];
  const ids = new Set();
  for (const p of surfaces) {
    if (ids.has(p.id)) errors.push(`${map.id}: duplicate ${p.id}`);
    ids.add(p.id);
    for (const key of ['x', 'z', 'topY', 'width', 'depth', 'thickness']) {
      if (!Number.isFinite(p[key])) errors.push(`${map.id}/${p.id}: bad ${key}`);
    }
    if (p.width <= 0 || p.depth <= 0 || p.thickness <= 0) errors.push(`${map.id}/${p.id}: nonpositive size`);
  }
  for (let i=1;i<map.platforms.length;i++) {
    const a=map.platforms[i-1], b=map.platforms[i];
    const edgeGap = Math.max(0, Math.hypot(b.x-a.x,b.z-a.z) - (Math.min(a.width,a.depth)+Math.min(b.width,b.depth))/2);
    const elevation = b.topY - a.topY;
    if (elevation > 2.3 || edgeGap > 4.0) errors.push(`${map.id}: difficult/impossible jump ${a.id} -> ${b.id}: +${elevation.toFixed(1)}m / edge gap ${edgeGap.toFixed(1)}m`);
  }
  console.log(`${map.id}: ${map.platforms.length} primary platforms, ${map.recoveryDecks.length} recovery decks, maximum surface ${Math.max(...surfaces.map(s=>s.topY))}m`);
  count += surfaces.length;
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode=1; }
else console.log(`Map checks passed (${count} static surfaces).`);

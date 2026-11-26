// English texts of the map content (zone names, finish hints, signs, pack summaries). The game's base texts are
// Vietnamese; the app shows `<field>_en` when the player picked English (src/i18n.ts → loc()). Older apps ignore them.
//
//   node devtools/i18n-content.mjs        patch every map JSON / pack.json / public/maps/index.json in place
//   import { applyI18n } from './i18n-content.mjs'   builders call it on the map data before writing
import fs from 'node:fs';

export const I18N = {
  map001: {
    // zone names were English from the start
    zones: { A: ['Làng Xuất Phát', null], B: ['Parkour Trong Làng', null], C: ['Làng Trên Cao', null], D: ['Đảo Bay', null], E: ['Lối Ra Phía Trên', null] },
    finishHint: 'Hint: Map 001 has 3 tricky shortcuts – have you found any of them yet?',
    summary: 'The starting village · 0 → 140 m · 5 zones',
  },
  map002: {
    zones: { A: 'Sky Station', B: 'Rooftop Row', C: 'Crane Yard', D: 'Billboard Alley', E: 'Glass Tower', F: 'Antenna Crown' },
    finishHint: 'Hint: there is a hidden rooftop behind the crane…',
    signs: { 'ROOFTOP CITY|Thành phố trên mái nhà · 140 → 320 m': 'ROOFTOP CITY|A city on the rooftops · 140 → 320 m' },
    summary: 'A rooftop city floating above Starter Village · 140 → 320 m · 6 zones · cranes, Sky Jump Pads',
  },
  map003: {
    zones: { A: 'Cargo Gate', B: 'Balance Beams', C: 'Moving Cargo', D: 'Crane Crossing', E: 'Vertical Climb', F: 'Daring Parkour', G: 'Final Container Tower' },
    finishHint: 'Hint: the two hanging containers always meet on the same beat – count the beat, then jump.',
    signs: { 'CONTAINER PORT|Cảng container trên mây · 320 → 520 m': 'CONTAINER PORT|A container port in the clouds · 320 → 520 m' },
    summary: 'A container port in the clouds · 320 → 520 m · 7 zones · lifts, cable cars, swinging containers, rotating cranes, launch pads',
  },
  map004: {
    zones: { A: 'Sugar Gate', B: 'Donut Valley', C: 'Bouncy Jelly Garden', D: 'Chocolate River', E: 'Lollipop Spin', F: 'Gummy Trial', G: 'Candy Castle' },
    finishHint: "Hint: Candy Kingdom hides secret ways – candy gems open a shortcut gate in the castle, and don't be afraid to walk into things that look solid…",
    signs: { 'CANDY KINGDOM|Vương quốc kẹo · 520 → 720 m': 'CANDY KINGDOM|The kingdom of sweets · 520 → 720 m' },
    summary: 'A candy kingdom in the sky · 520 → 720 m · 7 zones · spinning donuts, bouncy jellies, chocolate rivers, swinging lollipops, a candy castle, secret ways',
  },
  map005: {
    zones: { A: 'Toy Gate', B: 'Robot Workshop', C: 'Sky Railway', D: 'Sky Speedway', E: 'Seesaw Playground', F: 'Block Canyon', G: 'Toy Summit' },
    finishHint: 'Hint: Toy Universe hides 7 gems behind the teddy, the robot, the toy house, the speedway, the rocking horse and the block towers – collect 5 and the shortcut portal at Toy Summit opens…',
    signs: {
      'TOY UNIVERSE|Thế giới đồ chơi · 720 → 935 m': 'TOY UNIVERSE|A giant world of toys · 720 → 935 m',
      'XE ĐUA|Cưỡi xe đua qua khe hở': 'RACE CAR|Ride the race car over the gap',
      'ĐẠI BÁC|Bước vào để bay lên tháp 3': 'TOY CANNON|Walk in to fly up to tower 3',
      'CỔNG ĐÁ QUÝ|Cần 5 viên đá quý · bay thẳng lên gần đỉnh': 'GEM PORTAL|Needs 5 gems · flies you up near the summit',
    },
    summary: 'A giant world of toys · 720 → 935 m · 7 zones · teddy, robots, toy trains, race cars, spinning tops, seesaws, a rocking horse, a toy cannon and secret ways',
  },
  map006: {
    zones: { A: 'Forest Entrance', B: 'Mushroom Valley', C: 'Giant Leaf Garden', D: 'Hanging Log Canyon', E: 'Hollow Ancient Tree', F: 'Glowing Spore Sanctuary', G: 'Ancient Tree Crown' },
    finishHint: 'Hint: the Mushroom Forest has its own rules – red caps bounce you straight up, orange caps throw you the way they lean, violet caps throw you high; glowing mushrooms mark where to land, and look behind the trunk…',
    signs: {
      'MUSHROOM FOREST|Rừng nấm khổng lồ · 935 → 1150 m': 'MUSHROOM FOREST|A giant mushroom forest · 935 → 1150 m',
      'CỔNG ĐÁ QUÝ|Cần 5 viên đá quý · bay lên gần vương miện': 'GEM PORTAL|Needs 5 gems · flies you up near the crown',
    },
    summary: 'A giant mushroom forest round one ancient tree · 935 → 1150 m · 7 zones · bouncing and leaning caps, folding leaves, swinging log bridges, vines, spore streams and secret ways inside the tree',
  },
};

/** adds the `_en` (and for map001's English zone names, `_vi`) fields to a map's data; returns it */
export function applyI18n(data) {
  const tr = I18N[data.id];
  if (!tr) return data;
  for (const z of data.zones ?? []) {
    const v = tr.zones?.[z.id];
    if (Array.isArray(v)) { if (v[0]) z.name_vi = v[0]; if (v[1]) z.name_en = v[1]; } else if (v) z.name_en = v;
  }
  if (tr.finishHint && data.finishHint) data.finishHint_en = tr.finishHint;
  for (const k of data.kit ?? []) if (k.k === 'sign' && k.m && tr.signs?.[k.m]) k.m_en = tr.signs[k.m];
  return data;
}

/** pack.json meta (and the app's index entry): the English summary */
export function applyPackI18n(id, meta) {
  const tr = I18N[id];
  if (tr?.summary) meta.summary_en = tr.summary;
  return meta;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ROOT = new URL('../', import.meta.url).pathname;
  const files = { map001: 'public/maps/map001.json', map002: 'packs/map002/maps/map002.json', map003: 'packs/map003/maps/map003.json', map004: 'packs/map004/maps/map004.json', map005: 'packs/map005/maps/map005.json', map006: 'packs/map006/maps/map006.json' };
  for (const [id, f] of Object.entries(files)) {
    const p = ROOT + f;
    if (!fs.existsSync(p)) continue;
    const d = applyI18n(JSON.parse(fs.readFileSync(p, 'utf8')));
    fs.writeFileSync(p, JSON.stringify(d));
    const pf = `${ROOT}packs/${id}/pack.json`;
    if (fs.existsSync(pf)) { const m = applyPackI18n(id, JSON.parse(fs.readFileSync(pf, 'utf8'))); fs.writeFileSync(pf, JSON.stringify(m, null, 1) + '\n'); }
    console.log(`${id}: ${d.zones.filter((z) => z.name_en || z.name_vi).length} zones, hint ${!!d.finishHint_en}, signs ${(d.kit ?? []).filter((k) => k.m_en).length}`);
  }
  const idxFile = ROOT + 'public/maps/index.json';
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const e of idx) applyPackI18n(e.id, e);
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1) + '\n');
}

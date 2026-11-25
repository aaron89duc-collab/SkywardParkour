// Replace a prefab's collision mesh with a closed box (normalised model units): stackable props (shipping containers)
// collide as clean boxes – no seams, lips or holes to climb on or slip into.
//   node devtools/pipeline/boxcol.mjs <file.col.bin> x0 x1 y0 y1 z0 z1
import fs from 'fs';
const file = process.argv[2];
const [x0, x1, y0, y1, z0, z1] = process.argv.slice(3, 9).map(Number);
const P = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
const T = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
const buf = Buffer.alloc(8 + P.length * 12 + T.length * 12);
buf.writeUInt32LE(P.length, 0); buf.writeUInt32LE(T.length * 3, 4);
P.flat().forEach((v, i) => buf.writeFloatLE(v, 8 + i * 4));
T.flat().forEach((v, i) => buf.writeUInt32LE(v, 8 + P.length * 12 + i * 4));
fs.writeFileSync(file, buf);
console.log(file, 'box collision');

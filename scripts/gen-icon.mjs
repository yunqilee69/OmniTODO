// Generates the OmniTODO app icon source PNG (1024x1024, RGBA).
//
//   node scripts/gen-icon.mjs [out.png]
//
// The mark is drawn analytically (rounded square + gradient + checkmark) with
// 4x supersampling, so we do not need ImageMagick / Pillow on the build host.
// `npx tauri icon <out.png>` then derives every platform-specific size from it.

import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const SIZE = 1024;
const SS = 4; // supersampling factor per axis
const W = SIZE * SS;

// Brand gradient: indigo -> violet (matches the UI's primary palette).
const TOP = [79, 70, 229];
const BOTTOM = [124, 58, 237];
const MARK = [255, 255, 255];

/** Signed distance to a rounded rectangle centered at (cx, cy). */
function roundedRectSdf(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - r;
}

/** Distance from a point to the segment ab. */
function segmentDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy);
}

const margin = W * 0.055;
const half = W / 2 - margin;
const radius = W * 0.22;

// Checkmark polyline, in normalized coordinates.
const check = [
  [0.285, 0.525],
  [0.435, 0.675],
  [0.725, 0.335],
];
const stroke = W * 0.082;

const px = (x, y) => {
  // Background coverage.
  const bgAlpha = roundedRectSdf(x, y, W / 2, W / 2, half, half, radius) <= 0 ? 1 : 0;
  if (!bgAlpha) return [0, 0, 0, 0];

  const t = Math.min(1, Math.max(0, (y - margin) / (W - 2 * margin)));
  let r = TOP[0] + (BOTTOM[0] - TOP[0]) * t;
  let g = TOP[1] + (BOTTOM[1] - TOP[1]) * t;
  let b = TOP[2] + (BOTTOM[2] - TOP[2]) * t;

  // Checkmark coverage with round caps/joins.
  let mark = 0;
  for (let i = 0; i < check.length - 1; i++) {
    const [ax, ay] = check[i].map((v) => v * W);
    const [bx, by] = check[i + 1].map((v) => v * W);
    if (segmentDist(x, y, ax, ay, bx, by) <= stroke / 2) mark = 1;
  }
  if (mark) {
    r = MARK[0];
    g = MARK[1];
    b = MARK[2];
  }
  return [r, g, b, 255];
};

// Render supersampled, then box-filter down to SIZE.
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = px(x * SS + sx + 0.5, y * SS + sy + 0.5);
        r += pr * pa;
        g += pg * pa;
        b += pb * pa;
        a += pa;
      }
    }
    const n = SS * SS;
    const i = (y * SIZE + x) * 4;
    if (a === 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    } else {
      out[i] = Math.round(r / a);
      out[i + 1] = Math.round(g / a);
      out[i + 2] = Math.round(b / a);
      out[i + 3] = Math.round(a / n);
    }
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Raw scanlines: filter byte 0 + RGBA row.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const src = y * SIZE * 4;
  const dst = y * (SIZE * 4 + 1);
  raw[dst] = 0;
  out.copy(raw, dst + 1, src, src + SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const dest = process.argv[2] ?? "omnitodo-desktop/icons/source.png";
writeFileSync(dest, png);
console.log(`wrote ${dest} (${SIZE}x${SIZE}, ${png.length} bytes)`);

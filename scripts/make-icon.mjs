/**
 * Renders the Discord application icon as a 1024x1024 PNG.
 *
 * Written with a hand-rolled PNG encoder rather than a dependency: the project
 * needs exactly one static image, and adding an image toolchain for it would
 * cost more than the 80 lines below.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SIZE = 1024;
const OUT = path.join("assets", "icon.png");

// Sampled from styles.css so the icon matches the in-game header badge.
const GOLD_LIGHT = [255, 231, 158];
const GOLD_DARK = [201, 138, 47];
const BROWN_DEEP = [58, 28, 18];
const BROWN_MID = [125, 66, 36];
const PARCHMENT = [255, 243, 197];

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const centre = (SIZE - 1) / 2;

function mix(a, b, t) {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * clamped),
    Math.round(a[1] + (b[1] - a[1]) * clamped),
    Math.round(a[2] + (b[2] - a[2]) * clamped)
  ];
}

function set(x, y, [r, g, b], alpha = 255) {
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = alpha;
}

/** Coverage of a disc at this pixel, antialiased over a one-pixel band. */
function discCoverage(distance, radius) {
  return Math.max(0, Math.min(1, radius - distance + 0.5));
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - centre;
    const dy = y - centre;
    const distance = Math.hypot(dx, dy);

    // Outer rim -> inner medallion, lit from the top left.
    const light = (dx + dy) / (SIZE * 1.4);
    const rim = mix(GOLD_LIGHT, GOLD_DARK, 0.5 + light * 1.6);
    const face = mix(mix(BROWN_MID, BROWN_DEEP, 0.35 + light * 1.2), BROWN_DEEP, 0.15);

    const outer = discCoverage(distance, SIZE * 0.485);
    if (outer <= 0) {
      set(x, y, BROWN_DEEP, 0);
      continue;
    }

    const inner = discCoverage(distance, SIZE * 0.395);
    const colour = inner > 0 ? mix(rim, face, inner) : rim;
    set(x, y, colour, Math.round(outer * 255));
  }
}

/**
 * Draws a filled triangle, which is enough to build the angular "A" strokes.
 */
function triangle(ax, ay, bx, by, cx, cy, colour) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area;
      const w1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) / area;
      const w2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) set(x, y, colour);
    }
  }
}

/** One chevron of the monogram: an angular A without its crossbar. */
function chevron(cx, topY, bottomY, halfWidth, thickness, colour) {
  const outerL = cx - halfWidth;
  const outerR = cx + halfWidth;
  // Left stroke.
  triangle(cx, topY, outerL, bottomY, outerL + thickness, bottomY, colour);
  triangle(cx, topY, outerL + thickness, bottomY, cx + thickness * 0.5, topY, colour);
  // Right stroke.
  triangle(cx, topY, outerR - thickness, bottomY, outerR, bottomY, colour);
  triangle(cx, topY, cx - thickness * 0.5, topY, outerR - thickness, bottomY, colour);
}

// Two stacked chevrons read as "AA" at large sizes and as a clean mark when
// Discord shrinks this into the activity shelf.
chevron(SIZE * 0.5, SIZE * 0.30, SIZE * 0.545, SIZE * 0.20, SIZE * 0.072, PARCHMENT);
chevron(SIZE * 0.5, SIZE * 0.475, SIZE * 0.72, SIZE * 0.20, SIZE * 0.072, GOLD_LIGHT);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;  // bit depth
header[9] = 6;  // truecolour with alpha

// PNG stores each row prefixed with a filter byte; 0 means "no filtering".
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]));

console.log(`Wrote ${OUT} (${SIZE}x${SIZE}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);

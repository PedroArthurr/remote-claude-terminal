// Renders the PWA icons (no deps): node scripts/gen-icons.mjs → web/public/icons/*.png
// Neon prompt glyph "›_" drawn with signed distance fields, 4×4 supersampled.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const OUT = new URL('../web/public/icons/', import.meta.url);
const BG_TOP = [22, 19, 49];
const BG_BOTTOM = [7, 6, 15];
const CYAN = [0, 240, 255];
const MAGENTA = [255, 43, 214];
const STROKE = 0.075;
const SS = 4;

// Glyph in unit space (y down).
const CHEVRON = [
  [0.3, 0.31],
  [0.49, 0.5],
  [0.3, 0.69],
];
const CURSOR = [
  [0.57, 0.69],
  [0.72, 0.69],
];

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function polyDist(px, py, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, pts[i], pts[i + 1]));
  return d - STROKE / 2;
}

// Rounded square, centered, half-size h, corner radius r.
function roundRectDist(px, py, h, r) {
  const qx = Math.abs(px - 0.5) - h + r;
  const qy = Math.abs(py - 0.5) - h + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** RGBA in 0..1 for one sample. `maskable`: full bleed, glyph scaled into the safe zone. */
function sample(u, v, maskable) {
  const shape = maskable ? -1 : roundRectDist(u, v, 0.5, 0.22);
  if (shape > 0) return [0, 0, 0, 0];

  // Glyph space: maskable icons keep content inside the central 80 % circle.
  const k = maskable ? 0.82 : 1;
  const gx = (u - 0.5) / k + 0.5;
  const gy = (v - 0.5) / k + 0.5;

  let c = mix(BG_TOP, BG_BOTTOM, Math.min(1, v * 1.15)).map((x) => x / 255);
  // Faint horizon glow behind the glyph.
  const halo = Math.exp(-(((u - 0.5) ** 2) / 0.09 + ((v - 0.62) ** 2) / 0.02)) * 0.22;
  c = c.map((x, i) => x + (MAGENTA[i] / 255) * halo);

  // Thin inner border, cyan → magenta.
  if (!maskable) {
    const edge = Math.abs(roundRectDist(u, v, 0.47, 0.19)) - 0.004;
    const a = Math.max(0, Math.min(1, -edge / 0.004 + 0.5)) * 0.35;
    const bc = mix(CYAN, MAGENTA, (u + v) / 2).map((x) => x / 255);
    c = c.map((x, i) => x * (1 - a) + bc[i] * a);
  }

  for (const [pts, col] of [
    [CHEVRON, CYAN],
    [CURSOR, MAGENTA],
  ]) {
    const d = polyDist(gx, gy, pts) * k;
    const rgb = col.map((x) => x / 255);
    const glow = Math.exp(-Math.max(0, d) / 0.035) * 0.55;
    c = c.map((x, i) => x + rgb[i] * glow);
    if (d < 0) {
      // Hot core: white-ish center fading to the neon color at the stroke edge.
      const core = Math.min(1, -d / (STROKE / 2));
      const hot = mix(rgb, [1, 1, 1], core * 0.55);
      c = hot;
    }
  }
  return [...c.map((x) => Math.min(1, x)), 1];
}

function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, maskable);
          // Premultiplied accumulation so edges don't darken.
          acc[0] += s[0] * s[3];
          acc[1] += s[1] * s[3];
          acc[2] += s[2] * s[3];
          acc[3] += s[3];
        }
      }
      const o = (y * size + x) * 4;
      const a = acc[3] / (SS * SS);
      for (let i = 0; i < 3; i++) px[o + i] = a ? Math.round((acc[i] / acc[3]) * 255) : 0;
      px[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, px);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-192.png', 192, true],
  ['maskable-512.png', 512, true],
  ['favicon-48.png', 48, false],
]) {
  writeFileSync(new URL(name, OUT), render(size, maskable));
  console.log(`icons/${name}`);
}

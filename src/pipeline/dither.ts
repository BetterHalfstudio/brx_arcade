import type { DitherType } from "../state/types";
import { luma } from "../util/color";

// Stage 3 — DITHER, at native 800x600.
//   Color ON  -> dither targets the palette (snap each pixel to nearest entry).
//   Color OFF -> 1-bit black/white; `threshold` is the cutoff.
// FS = serial error diffusion. Bayer = ordered, keyed to ABSOLUTE canvas x,y
// (so the pattern is locked to the grid and "re-dithers" as the sprite moves).
// Fully transparent pixels (alpha 0) are skipped and left transparent.

// --- Ordered (Bayer) threshold matrices, normalized to [0,1) -----------------
const BAYER2 = [0, 2, 3, 1];
const BAYER4 = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
];
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
  14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
];

function bayerFor(type: DitherType): { m: number[]; n: number; max: number } {
  switch (type) {
    case "bayer2":
      return { m: BAYER2, n: 2, max: 4 };
    case "bayer4":
      return { m: BAYER4, n: 4, max: 16 };
    default:
      return { m: BAYER8, n: 8, max: 64 };
  }
}

export interface DitherOpts {
  type: DitherType;
  colorOn: boolean;
  threshold: number; // 0..255 (Color OFF only)
  palette: Uint8Array; // flat rgb bytes (Color ON)
  paletteCount: number;
}

/** Nearest palette entry by squared RGB distance. Writes result into `out`. */
function nearestPalette(
  pal: Uint8Array,
  count: number,
  r: number,
  g: number,
  b: number,
  out: { r: number; g: number; b: number }
): void {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const dr = r - pal[i * 3];
    const dg = g - pal[i * 3 + 1];
    const db = b - pal[i * 3 + 2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  out.r = pal[best * 3];
  out.g = pal[best * 3 + 1];
  out.b = pal[best * 3 + 2];
}

export function dither(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  opts: DitherOpts
): void {
  if (opts.type === "fs") {
    ditherFS(data, w, h, opts);
  } else {
    ditherOrdered(data, w, h, opts);
  }
}

// --- Floyd–Steinberg ---------------------------------------------------------
function ditherFS(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  opts: DitherOpts
): void {
  const { colorOn, threshold, palette, paletteCount } = opts;
  const n = w * h;
  // Float working buffers so diffused error accumulates without clamping.
  const fr = new Float32Array(n);
  const fg = new Float32Array(n);
  const fb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fr[i] = data[i * 4];
    fg[i] = data[i * 4 + 1];
    fb[i] = data[i * 4 + 2];
  }
  const out = { r: 0, g: 0, b: 0 };
  const canPalette = colorOn && paletteCount > 0;

  const push = (i: number, er: number, eg: number, eb: number, f: number) => {
    if (data[i * 4 + 3] === 0) return; // never diffuse into transparent
    fr[i] += er * f;
    fg[i] += eg * f;
    fb[i] += eb * f;
  };

  for (let y = 0; y < h; y++) {
    const ltr = (y & 1) === 0; // serpentine scan reduces directional artifacts
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x;
      if (data[i * 4 + 3] === 0) continue;

      const or = fr[i];
      const og = fg[i];
      const ob = fb[i];
      let nr: number, ng: number, nb: number;
      if (canPalette) {
        nearestPalette(palette, paletteCount, or, og, ob, out);
        nr = out.r;
        ng = out.g;
        nb = out.b;
      } else if (colorOn) {
        // No palette set: keep the image's own colors (passthrough quantize).
        nr = or;
        ng = og;
        nb = ob;
      } else {
        // 1-bit: collapse to luma, cut at threshold.
        const v = luma(or, og, ob) >= threshold ? 255 : 0;
        nr = ng = nb = v;
      }
      data[i * 4] = nr;
      data[i * 4 + 1] = ng;
      data[i * 4 + 2] = nb;

      const er = or - nr;
      const eg = og - ng;
      const eb = ob - nb;
      const right = ltr ? i + 1 : i - 1;
      const rightEdge = ltr ? x < w - 1 : x > 0;
      if (rightEdge) push(right, er, eg, eb, 7 / 16);
      if (y < h - 1) {
        const down = i + w;
        const dl = ltr ? down - 1 : down + 1;
        const dr = ltr ? down + 1 : down - 1;
        const dlEdge = ltr ? x > 0 : x < w - 1;
        const drEdge = ltr ? x < w - 1 : x > 0;
        if (dlEdge) push(dl, er, eg, eb, 3 / 16);
        push(down, er, eg, eb, 5 / 16);
        if (drEdge) push(dr, er, eg, eb, 1 / 16);
      }
    }
  }
}

// --- Ordered (Bayer) ---------------------------------------------------------
function ditherOrdered(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  opts: DitherOpts
): void {
  const { type, colorOn, threshold, palette, paletteCount } = opts;
  const { m, n, max } = bayerFor(type);
  const out = { r: 0, g: 0, b: 0 };
  const canPalette = colorOn && paletteCount > 0;
  // Dithering spread: larger for small palettes so the pattern stays visible.
  const spread = canPalette ? (255 * 0.55) / Math.cbrt(paletteCount) : 255;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] === 0) continue;
      // Threshold from the matrix at the ABSOLUTE canvas position, in (-0.5,0.5].
      const t = (m[(y % n) * n + (x % n)] + 0.5) / max - 0.5;

      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      if (canPalette) {
        const off = t * spread;
        nearestPalette(palette, paletteCount, r + off, g + off, b + off, out);
        data[i * 4] = out.r;
        data[i * 4 + 1] = out.g;
        data[i * 4 + 2] = out.b;
      } else if (colorOn) {
        // passthrough (no palette set)
      } else {
        const v = luma(r, g, b) + t * spread >= threshold ? 255 : 0;
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
      }
    }
  }
}

import type { DitherType } from "../state/types";
import { luma } from "../util/color";

// Stage 3 — DITHER.
//   mode "original" -> snap to a palette auto-extracted from the image (median
//                      cut over its own colors), so dithering uses real colors.
//   mode "palette"  -> snap to the user palette.
//   mode "bw"       -> 1-bit black/white; `threshold` is the cutoff.
// FS = serial error diffusion. Bayer = ordered, keyed to ABSOLUTE canvas x,y.
// Fully transparent pixels (alpha 0) are skipped.

export type DitherMode = "original" | "palette" | "bw";

// --- Ordered (Bayer) threshold matrices --------------------------------------
const BAYER2 = [0, 2, 3, 1];
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
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
  mode: DitherMode;
  threshold: number; // 0..255 (bw)
  palette: Uint8Array; // flat rgb bytes (palette mode)
  paletteCount: number;
}

/** Set every opaque pixel to its luma in all channels (black & white base). */
export function toGrayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const v = luma(data[i], data[i + 1], data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/** Median-cut a representative palette from the image's own opaque colors. */
function extractPalette(
  data: Uint8ClampedArray,
  count: number
): { pal: Uint8Array; n: number } {
  // subsample to ~4096 opaque pixels
  const px = data.length / 4;
  const stride = Math.max(1, Math.floor(px / 4096));
  const samples: number[] = []; // flat r,g,b
  for (let i = 0; i < px; i += stride) {
    if (data[i * 4 + 3] === 0) continue;
    samples.push(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  if (samples.length === 0) return { pal: new Uint8Array(3), n: 1 };

  // buckets are [start,end) index ranges over a working copy split in place
  type Bucket = { lo: number; hi: number };
  const pts: number[][] = [];
  for (let i = 0; i < samples.length; i += 3)
    pts.push([samples[i], samples[i + 1], samples[i + 2]]);
  let buckets: Bucket[] = [{ lo: 0, hi: pts.length }];

  while (buckets.length < count) {
    // pick the bucket with the largest single-channel spread
    let target = -1;
    let bestRange = 0;
    let bestCh = 0;
    for (let b = 0; b < buckets.length; b++) {
      const { lo, hi } = buckets[b];
      if (hi - lo < 2) continue;
      const min = [255, 255, 255];
      const max = [0, 0, 0];
      for (let i = lo; i < hi; i++)
        for (let c = 0; c < 3; c++) {
          const v = pts[i][c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      for (let c = 0; c < 3; c++) {
        const r = max[c] - min[c];
        if (r > bestRange) {
          bestRange = r;
          target = b;
          bestCh = c;
        }
      }
    }
    if (target < 0 || bestRange === 0) break;
    const { lo, hi } = buckets[target];
    const slice = pts.slice(lo, hi).sort((a, b) => a[bestCh] - b[bestCh]);
    for (let i = lo; i < hi; i++) pts[i] = slice[i - lo];
    const mid = (lo + hi) >> 1;
    buckets.splice(target, 1, { lo, hi: mid }, { lo: mid, hi });
  }

  const pal = new Uint8Array(buckets.length * 3);
  buckets.forEach((bk, b) => {
    let r = 0,
      g = 0,
      bl = 0;
    const cnt = bk.hi - bk.lo || 1;
    for (let i = bk.lo; i < bk.hi; i++) {
      r += pts[i][0];
      g += pts[i][1];
      bl += pts[i][2];
    }
    pal[b * 3] = r / cnt;
    pal[b * 3 + 1] = g / cnt;
    pal[b * 3 + 2] = bl / cnt;
  });
  return { pal, n: buckets.length };
}

/** Nearest palette entry by squared RGB distance. */
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
  // Resolve the working palette: user palette, or auto-extracted in "original".
  let palette = opts.palette;
  let count = opts.paletteCount;
  if (opts.mode === "original") {
    const ex = extractPalette(data, 16);
    palette = ex.pal;
    count = ex.n;
  }
  const bw = opts.mode === "bw" || count === 0;

  if (opts.type === "fs") {
    ditherFS(data, w, h, bw, opts.threshold, palette, count);
  } else {
    ditherOrdered(data, w, h, opts.type, bw, opts.threshold, palette, count);
  }
}

// --- Floyd–Steinberg ---------------------------------------------------------
function ditherFS(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bw: boolean,
  threshold: number,
  palette: Uint8Array,
  count: number
): void {
  const n = w * h;
  const fr = new Float32Array(n);
  const fg = new Float32Array(n);
  const fb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fr[i] = data[i * 4];
    fg[i] = data[i * 4 + 1];
    fb[i] = data[i * 4 + 2];
  }
  const out = { r: 0, g: 0, b: 0 };

  const push = (i: number, er: number, eg: number, eb: number, f: number) => {
    if (data[i * 4 + 3] === 0) return;
    fr[i] += er * f;
    fg[i] += eg * f;
    fb[i] += eb * f;
  };

  for (let y = 0; y < h; y++) {
    const ltr = (y & 1) === 0; // serpentine
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x;
      if (data[i * 4 + 3] === 0) continue;

      const or = fr[i];
      const og = fg[i];
      const ob = fb[i];
      let nr: number, ng: number, nb: number;
      if (bw) {
        const v = luma(or, og, ob) >= threshold ? 255 : 0;
        nr = ng = nb = v;
      } else {
        nearestPalette(palette, count, or, og, ob, out);
        nr = out.r;
        ng = out.g;
        nb = out.b;
      }
      data[i * 4] = nr;
      data[i * 4 + 1] = ng;
      data[i * 4 + 2] = nb;

      const er = or - nr;
      const eg = og - ng;
      const eb = ob - nb;
      const rightEdge = ltr ? x < w - 1 : x > 0;
      if (rightEdge) push(ltr ? i + 1 : i - 1, er, eg, eb, 7 / 16);
      if (y < h - 1) {
        const down = i + w;
        const dlEdge = ltr ? x > 0 : x < w - 1;
        const drEdge = ltr ? x < w - 1 : x > 0;
        if (dlEdge) push(ltr ? down - 1 : down + 1, er, eg, eb, 3 / 16);
        push(down, er, eg, eb, 5 / 16);
        if (drEdge) push(ltr ? down + 1 : down - 1, er, eg, eb, 1 / 16);
      }
    }
  }
}

// --- Ordered (Bayer) ---------------------------------------------------------
function ditherOrdered(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  type: DitherType,
  bw: boolean,
  threshold: number,
  palette: Uint8Array,
  count: number
): void {
  const { m, n, max } = bayerFor(type);
  const out = { r: 0, g: 0, b: 0 };
  const spread = bw ? 255 : (255 * 0.55) / Math.cbrt(Math.max(1, count));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] === 0) continue;
      const t = (m[(y % n) * n + (x % n)] + 0.5) / max - 0.5;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      if (bw) {
        const v = luma(r, g, b) + t * spread >= threshold ? 255 : 0;
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
      } else {
        const off = t * spread;
        nearestPalette(palette, count, r + off, g + off, b + off, out);
        data[i * 4] = out.r;
        data[i * 4 + 1] = out.g;
        data[i * 4 + 2] = out.b;
      }
    }
  }
}

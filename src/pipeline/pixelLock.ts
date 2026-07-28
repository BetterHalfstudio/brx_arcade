// PIXEL-LOCK — snap already-pixel-art input to its native grid.
//
// AI-generated "pixel art" is usually close but not perfect: the logical pixels
// sit on a slightly irregular grid and each one is a soft cluster of colours
// (anti-aliasing, JPEG-ish noise) rather than one flat swatch. Dithering makes
// this WORSE — it invents sub-pixel patterns on top of pixels that already
// exist. Pixel-Lock does the opposite: it recovers the native grid and collapses
// each cell to a single solid colour (the most-used colour in that cell).
//
// Two steps, both here:
//   detectPixelGrid()  — estimate the native cell size (edge period detection)
//   collapseToGrid()   — mode-per-cell downsample to solid colours
//
// Everything works in the SOURCE image's own pixels, so quality is independent
// of how the image is scaled onto the 600x450 canvas.

import type { ColorState } from "../state/types";
import { hexToRgb, luma } from "../util/color";

export type PixelSource = HTMLImageElement | HTMLCanvasElement;

/** Hard bounds on the detectable / selectable cell size (native px per cell). */
export const CELL_MIN = 1;
export const CELL_MAX = 64;

function sourceSize(img: PixelSource): [number, number] {
  if (img instanceof HTMLImageElement) return [img.naturalWidth, img.naturalHeight];
  return [img.width, img.height];
}

function readPixels(
  img: PixelSource,
  targetLongEdge: number
): { data: Uint8ClampedArray; w: number; h: number; ds: number } {
  const [nw, nh] = sourceSize(img);
  const ds = Math.max(1, Math.max(nw, nh) / targetLongEdge); // downscale factor
  const w = Math.max(1, Math.round(nw / ds));
  const h = Math.max(1, Math.round(nh / ds));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false; // keep pixel edges crisp
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, ds };
}

// --- grid detection ----------------------------------------------------------

/** Per-column horizontal-edge energy: mean colour change vs the column to the
 *  left. Cell boundaries in pixel art produce regular spikes in this signal. */
function edgeColumns(data: Uint8ClampedArray, w: number, h: number): Float64Array {
  const E = new Float64Array(w);
  for (let x = 1; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const j = (y * w + x - 1) * 4;
      const a0 = data[i + 3];
      const a1 = data[j + 3];
      if (a0 < 128 || a1 < 128) {
        if (a0 !== a1) s += 255; // opaque↔transparent is a real pixel edge
        continue;
      }
      s += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
    }
    E[x] = s / h;
  }
  return E;
}

/** Per-row vertical-edge energy (symmetric to edgeColumns). */
function edgeRows(data: Uint8ClampedArray, w: number, h: number): Float64Array {
  const E = new Float64Array(h);
  for (let y = 1; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = ((y - 1) * w + x) * 4;
      const a0 = data[i + 3];
      const a1 = data[j + 3];
      if (a0 < 128 || a1 < 128) {
        if (a0 !== a1) s += 255;
        continue;
      }
      s += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
    }
    E[y] = s / w;
  }
  return E;
}

/**
 * Comb-difference score for every candidate period.
 *
 * For period p and phase φ, split columns into "on-grid" (x ≡ φ mod p) and
 * "off-grid", scoring mean(on) − mean(off) at the best phase. Cell boundaries
 * land on the grid, so real periods score high — BUT so do their harmonics
 * (2p, 3p): a sparser comb cherry-picks the strongest boundaries and mean(off)
 * barely moves, so the raw score often RISES with multiples. We therefore keep
 * the whole score curve and recover the fundamental separately.
 */
function combScores(E: Float64Array, minP: number, maxP: number): Float64Array {
  const N = E.length;
  let total = 0;
  for (let x = 0; x < N; x++) total += E[x];

  const scores = new Float64Array(maxP + 1).fill(-Infinity);
  for (let p = minP; p <= maxP; p++) {
    const res = new Float64Array(p);
    const cnt = new Int32Array(p);
    for (let x = 0; x < N; x++) {
      const r = x % p;
      res[r] += E[x];
      cnt[r]++;
    }
    let bestScore = -Infinity;
    for (let phase = 0; phase < p; phase++) {
      const onN = cnt[phase];
      const offN = N - onN;
      if (onN === 0 || offN === 0) continue;
      const score = res[phase] / onN - (total - res[phase]) / offN;
      if (score > bestScore) bestScore = score;
    }
    scores[p] = bestScore;
  }
  return scores;
}

/**
 * Recover the fundamental period from a comb-score curve.
 *
 * The true period and its harmonics all score high and are all multiples of the
 * fundamental (e.g. 16 → 32, 48, 64). Non-multiples score much lower. So take
 * the high-scoring set and return the SMALLEST period that explains the most of
 * it (every member is a near-multiple of it) — that is the fundamental, and it
 * is robust to a stray high scorer that a plain min or GCD would trip on.
 */
function fundamental(scores: Float64Array, minP: number, maxP: number): number {
  let maxS = -Infinity;
  for (let p = minP; p <= maxP; p++) if (scores[p] > maxS) maxS = scores[p];
  if (!(maxS > 0)) return minP;

  const hi: number[] = [];
  for (let p = minP; p <= maxP; p++) if (scores[p] >= 0.7 * maxS) hi.push(p);
  if (hi.length === 0) return minP;

  let best = hi[0];
  let bestExplained = -1;
  for (const c of hi) {
    // c iterates ascending, so the first period with the max explained-count
    // wins — the smallest, i.e. the fundamental.
    let explained = 0;
    for (const q of hi) {
      const k = Math.round(q / c);
      if (k >= 1 && Math.abs(q - k * c) <= 1) explained++;
    }
    if (explained > bestExplained) {
      bestExplained = explained;
      best = c;
    }
  }
  return best;
}

/** Estimate the native cell size (square, in SOURCE px) of pixel-art input. */
export function detectPixelGrid(img: PixelSource): number {
  const { data, w, h, ds } = readPixels(img, 1024);
  const maxP = Math.max(2, Math.min(CELL_MAX, Math.floor(Math.min(w, h) / 3)));
  const sx = combScores(edgeColumns(data, w, h), 2, maxP);
  const sy = combScores(edgeRows(data, w, h), 2, maxP);
  const fx = fundamental(sx, 2, maxP);
  const fy = fundamental(sy, 2, maxP);

  // Pixel-art cells are square: average the two axes when they agree, else
  // trust the axis with the stronger (more confident) periodicity.
  let maxSx = -Infinity;
  let maxSy = -Infinity;
  for (let p = 2; p <= maxP; p++) {
    if (sx[p] > maxSx) maxSx = sx[p];
    if (sy[p] > maxSy) maxSy = sy[p];
  }
  let cellWork: number;
  if (Math.abs(fx - fy) <= 1) cellWork = (fx + fy) / 2;
  else cellWork = maxSx >= maxSy ? fx : fy;

  return Math.max(CELL_MIN, Math.min(CELL_MAX, Math.round(cellWork * ds)));
}

// --- collapse ----------------------------------------------------------------

interface PaletteColor {
  r: number;
  g: number;
  b: number;
  w: number; // weight (pixels represented) — steers merges toward big regions
}

/** Squared RGB distance. */
function dist2(a: PaletteColor, r: number, g: number, b: number): number {
  const dr = a.r - r;
  const dg = a.g - g;
  const db = a.b - b;
  return dr * dr + dg * dg + db * db;
}

// Everything below runs SYNCHRONOUSLY on every slider tick, so it must stay
// LINEAR in pixels. Colour statistics live in fixed 5-bit/channel buckets
// (32768 typed-array slots — no Maps, no pairwise merging).

const QSLOTS = 1 << 15;
const NEAR_DUP2 = 14 * 14; // squared distance treated as "the same colour"

/** 15-bit bucket key for an RGB colour. */
function qkey(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

/** Weighted colour accumulator over the fixed bucket grid. */
class Buckets {
  readonly w = new Float64Array(QSLOTS);
  readonly r = new Float64Array(QSLOTS);
  readonly g = new Float64Array(QSLOTS);
  readonly b = new Float64Array(QSLOTS);
  add(r: number, g: number, b: number, weight: number): void {
    const k = qkey(r, g, b);
    this.w[k] += weight;
    this.r[k] += r * weight;
    this.g[k] += g * weight;
    this.b[k] += b * weight;
  }
}

/**
 * Build the palette from the buckets — linear, no pairwise merging. Buckets are
 * visited heaviest-first: within near-duplicate range of an existing entry they
 * merge in (weighted, so big flat regions dominate); otherwise they open a new
 * entry while under `maxColors`; once the budget is full everything else merges
 * into its nearest entry. Cost is O(buckets × maxColors), hard-bounded.
 */
function buildPalette(buckets: Buckets, maxColors: number): PaletteColor[] {
  const arr: PaletteColor[] = [];
  for (let k = 0; k < QSLOTS; k++) {
    const w = buckets.w[k];
    if (w > 0) {
      arr.push({ r: buckets.r[k] / w, g: buckets.g[k] / w, b: buckets.b[k] / w, w });
    }
  }
  arr.sort((a, b) => b.w - a.w);

  const pal: PaletteColor[] = [];
  for (const c of arr) {
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const d = dist2(pal[i], c.r, c.g, c.b);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0 && (bd <= NEAR_DUP2 || pal.length >= maxColors)) {
      const p = pal[bi];
      const t = p.w + c.w;
      p.r = (p.r * p.w + c.r * c.w) / t;
      p.g = (p.g * p.w + c.g * c.w) / t;
      p.b = (p.b * p.w + c.b * c.w) / t;
      p.w = t;
    } else if (pal.length < maxColors) {
      pal.push({ ...c });
    }
  }
  for (const p of pal) {
    p.r = Math.round(p.r);
    p.g = Math.round(p.g);
    p.b = Math.round(p.b);
  }
  return pal;
}

/**
 * Collapse the source image to a gridW × gridH canvas of solid cells, where
 * gridW ≈ naturalW / cell. Each output pixel is one native art-pixel, snapped
 * to a reduced palette of at most `maxColors`. A cell that is mostly transparent
 * stays transparent (background stays cut out).
 */
export function collapseToGrid(img: PixelSource, cell: number, maxColors: number): HTMLCanvasElement {
  const [nw, nh] = sourceSize(img);
  const c = Math.max(CELL_MIN, Math.round(cell));
  // FIXED c-px cells (not nw/gw-wide ones): a cell width that isn't exactly the
  // native cell drifts against the art's grid, so neighbouring cells straddle
  // pixel boundaries by different amounts and a flat area comes out as a faint
  // checkerboard. Fixed c-px cells straddle by a constant offset instead, so the
  // dominant colour is consistent and flat areas stay flat.
  const gw = Math.max(1, Math.ceil(nw / c));
  const gh = Math.max(1, Math.ceil(nh / c));

  const sc = document.createElement("canvas");
  sc.width = nw;
  sc.height = nh;
  const sctx = sc.getContext("2d", { willReadFrequently: true })!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(img, 0, 0);
  const src = sctx.getImageData(0, 0, nw, nh).data;

  const nCells = gw * gh;
  const opaque = new Int32Array(nCells);
  const total = new Int32Array(nCells);
  // Per-cell colour, resolved without allocating a Map per cell.
  const cellRGB = new Int32Array(nCells).fill(-1);
  const buckets = new Buckets();

  if (c === 1) {
    // 1:1 — every source pixel IS a cell, so its own colour is the answer.
    // Skips the whole per-cell histogram machinery (the expensive path at 1px).
    for (let y = 0; y < nh; y++) {
      const rowBase = Math.min(gh - 1, y) * gw;
      for (let x = 0; x < nw; x++) {
        const ci = rowBase + Math.min(gw - 1, x);
        total[ci]++;
        const i = (y * nw + x) * 4;
        if (src[i + 3] < 128) continue;
        opaque[ci]++;
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];
        cellRGB[ci] = (r << 16) | (g << 8) | b;
        buckets.add(r, g, b, 1);
      }
    }
  } else {
    // Per-cell dominant colour via fixed 5-bit buckets — one shared typed array
    // per cell pass, no Map allocation.
    const cw = new Float64Array(QSLOTS);
    const cr = new Float64Array(QSLOTS);
    const cg = new Float64Array(QSLOTS);
    const cb = new Float64Array(QSLOTS);
    const touched: number[] = [];
    // group source rows by cell row so each cell is finished before moving on
    for (let gj = 0; gj < gh; gj++) {
      const y0 = gj * c;
      const y1 = Math.min(nh, y0 + c);
      for (let gi = 0; gi < gw; gi++) {
        const x0 = gi * c;
        const x1 = Math.min(nw, x0 + c);
        const ci = gj * gw + gi;
        touched.length = 0;
        let opq = 0;
        let tot = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            tot++;
            const i = (y * nw + x) * 4;
            if (src[i + 3] < 128) continue;
            opq++;
            const r = src[i];
            const g = src[i + 1];
            const b = src[i + 2];
            const k = qkey(r, g, b);
            if (cw[k] === 0) touched.push(k);
            cw[k]++;
            cr[k] += r;
            cg[k] += g;
            cb[k] += b;
          }
        }
        total[ci] = tot;
        opaque[ci] = opq;
        if (opq * 2 >= tot && touched.length) {
          // dominant bucket = the cell's colour (averaged → denoises flat areas)
          let bk = touched[0];
          for (const k of touched) if (cw[k] > cw[bk]) bk = k;
          const r = Math.round(cr[bk] / cw[bk]);
          const g = Math.round(cg[bk] / cw[bk]);
          const b = Math.round(cb[bk] / cw[bk]);
          cellRGB[ci] = (r << 16) | (g << 8) | b;
          buckets.add(r, g, b, opq);
        }
        for (const k of touched) {
          cw[k] = 0;
          cr[k] = 0;
          cg[k] = 0;
          cb[k] = 0;
        }
      }
    }
  }

  // Reduce to the target palette, then snap every cell to its nearest entry.
  const palette = buildPalette(buckets, Math.max(1, Math.round(maxColors)));
  // Snap cache keyed by 15-bit bucket — a flat typed array, not a Map.
  const snap = new Int32Array(QSLOTS).fill(-1);
  const nearest = (rgb: number): number => {
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    const k = qkey(r, g, b);
    const cached = snap[k];
    if (cached >= 0) return cached;
    let best = palette[0];
    let bd = Infinity;
    for (const p of palette) {
      const d = dist2(p, r, g, b);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const packed = (best.r << 16) | (best.g << 8) | best.b;
    snap[k] = packed;
    return packed;
  };

  const out = document.createElement("canvas");
  out.width = gw;
  out.height = gh;
  const octx = out.getContext("2d")!;
  const oimg = octx.createImageData(gw, gh);
  const od = oimg.data;
  for (let ci = 0; ci < nCells; ci++) {
    const o = ci * 4;
    if (cellRGB[ci] < 0) {
      od[o + 3] = 0;
      continue;
    }
    const rgb = palette.length ? nearest(cellRGB[ci]) : cellRGB[ci];
    od[o] = (rgb >> 16) & 255;
    od[o + 1] = (rgb >> 8) & 255;
    od[o + 2] = rgb & 255;
    od[o + 3] = 255;
  }
  octx.putImageData(oimg, 0, 0);
  return out;
}

// --- solid recolour ----------------------------------------------------------
// The COLOR section still applies over pixel-locked art, but WITHOUT dithering,
// so every cell stays a single solid colour.

interface StopRGB {
  pos: number;
  r: number;
  g: number;
  b: number;
}

function gradientLut(stops: StopRGB[], hard: boolean): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const n = stops.length;
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let r: number;
    let g: number;
    let b: number;
    if (hard) {
      let idx = 0;
      for (let k = 0; k < n; k++) if (t >= stops[k].pos) idx = k;
      ({ r, g, b } = stops[idx]);
    } else if (t <= stops[0].pos) {
      ({ r, g, b } = stops[0]);
    } else if (t >= stops[n - 1].pos) {
      ({ r, g, b } = stops[n - 1]);
    } else {
      let a = 0;
      for (let k = 0; k < n - 1; k++) if (t >= stops[k].pos) a = k;
      const bb = Math.min(n - 1, a + 1);
      const span = stops[bb].pos - stops[a].pos || 1;
      const f = (t - stops[a].pos) / span;
      r = stops[a].r + (stops[bb].r - stops[a].r) * f;
      g = stops[a].g + (stops[bb].g - stops[a].g) * f;
      b = stops[a].b + (stops[bb].b - stops[a].b) * f;
    }
    lut[v * 3] = r;
    lut[v * 3 + 1] = g;
    lut[v * 3 + 2] = b;
  }
  return lut;
}

/** Apply the COLOR section to solid pixel-locked art, keeping cells flat. */
export function recolorSolid(data: Uint8ClampedArray, color: ColorState): void {
  if (color.gradientMapOn) {
    const stops = color.gradientStops
      .map((s) => ({ pos: s.pos, ...hexToRgb(s.color) }))
      .sort((a, b) => a.pos - b.pos);
    const lut = gradientLut(stops, color.hardStops);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const o = (luma(data[i], data[i + 1], data[i + 2]) | 0) * 3;
      data[i] = lut[o];
      data[i + 1] = lut[o + 1];
      data[i + 2] = lut[o + 2];
    }
  } else if (!color.originalColors) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const v = luma(data[i], data[i + 1], data[i + 2]) | 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  // originalColors: leave the collapsed colours exactly as they are.
}

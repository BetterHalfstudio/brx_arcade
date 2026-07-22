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

/**
 * Representative colour of a cell: cluster near-identical colours (absorbing
 * anti-aliasing halos and noise into their parent), pick the cluster with the
 * most pixels, and return that cluster's weighted-AVERAGE colour.
 *
 * Averaging (rather than the single most-frequent exact colour) is what makes
 * flat areas come out flat: in a noisy region every cell would otherwise pick a
 * slightly different random noise value and the result would be mottled. The
 * cluster is tight (threshold below), so its average lands on the intended
 * palette colour with the noise cancelled out.
 */
function representative(freq: Map<number, number>): number {
  if (freq.size === 0) return 0;
  const entries = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const TH = 40; // sum-of-abs channel distance that counts as "the same colour"

  interface Cluster {
    r: number;
    g: number;
    b: number;
    count: number;
  }
  const clusters: Cluster[] = [];

  for (const [key, cnt] of entries) {
    const r = (key >> 16) & 255;
    const g = (key >> 8) & 255;
    const b = key & 255;
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b);
      if (d <= TH && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      const t = best.count + cnt;
      best.r = (best.r * best.count + r * cnt) / t;
      best.g = (best.g * best.count + g * cnt) / t;
      best.b = (best.b * best.count + b * cnt) / t;
      best.count = t;
    } else {
      clusters.push({ r, g, b, count: cnt });
    }
  }

  let dom = clusters[0];
  for (const c of clusters) if (c.count > dom.count) dom = c;
  return (Math.round(dom.r) << 16) | (Math.round(dom.g) << 8) | Math.round(dom.b);
}

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

/**
 * Reduce a set of cell colours to a clean palette: always merge colours that
 * are extremely close (sampling noise), then keep merging the closest pair
 * until at most `maxColors` remain. Merges are weighted, so a big flat region
 * dominates a stray near-match.
 */
function reducePalette(hist: Map<number, number>, maxColors: number): PaletteColor[] {
  // Pre-bucket to 5-bit/channel so near-identical colours collapse up front and
  // the agglomerative step below runs on a small set.
  const buckets = new Map<number, PaletteColor>();
  for (const [key, w] of hist) {
    const r = (key >> 16) & 255;
    const g = (key >> 8) & 255;
    const b = key & 255;
    const bk = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cur = buckets.get(bk);
    if (cur) {
      const t = cur.w + w;
      cur.r = (cur.r * cur.w + r * w) / t;
      cur.g = (cur.g * cur.w + g * w) / t;
      cur.b = (cur.b * cur.w + b * w) / t;
      cur.w = t;
    } else {
      buckets.set(bk, { r, g, b, w });
    }
  }
  const pal = [...buckets.values()];
  const NEAR_DUP = 14 * 14; // squared distance treated as "the same colour"

  // Agglomerative merge: collapse the closest pair while over budget OR while
  // two colours are still near-duplicates.
  while (pal.length > 1) {
    let bi = 0;
    let bj = 1;
    let bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      for (let j = i + 1; j < pal.length; j++) {
        const d = dist2(pal[i], pal[j].r, pal[j].g, pal[j].b);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (pal.length <= maxColors && bd >= NEAR_DUP) break;
    const a = pal[bi];
    const b = pal[bj];
    const t = a.w + b.w;
    a.r = (a.r * a.w + b.r * b.w) / t;
    a.g = (a.g * a.w + b.g * b.w) / t;
    a.b = (a.b * a.w + b.b * b.w) / t;
    a.w = t;
    pal.splice(bj, 1);
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
  const freq: Map<number, number>[] = Array.from({ length: nCells }, () => new Map());
  const opaque = new Int32Array(nCells);
  const total = new Int32Array(nCells);

  for (let y = 0; y < nh; y++) {
    const gj = Math.min(gh - 1, (y / c) | 0);
    const rowBase = gj * gw;
    for (let x = 0; x < nw; x++) {
      const gi = Math.min(gw - 1, (x / c) | 0);
      const ci = rowBase + gi;
      total[ci]++;
      const i = (y * nw + x) * 4;
      if (src[i + 3] < 128) continue;
      opaque[ci]++;
      const key = (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
      const m = freq[ci];
      m.set(key, (m.get(key) || 0) + 1);
    }
  }

  // Pass 1 — resolve each cell to a single colour (or transparent), and tally a
  // palette histogram weighted by cell size.
  const cellRGB = new Int32Array(nCells).fill(-1);
  const hist = new Map<number, number>();
  for (let ci = 0; ci < nCells; ci++) {
    if (opaque[ci] * 2 < total[ci]) continue; // mostly background → cut out
    const rgb = representative(freq[ci]);
    cellRGB[ci] = rgb;
    hist.set(rgb, (hist.get(rgb) || 0) + opaque[ci]);
  }

  // Reduce to the target palette, then snap every cell to its nearest entry.
  const palette = reducePalette(hist, Math.max(1, Math.round(maxColors)));
  const snap = new Map<number, number>(); // cache: cell colour → packed palette colour
  const nearest = (rgb: number): number => {
    const cached = snap.get(rgb);
    if (cached !== undefined) return cached;
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
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
    snap.set(rgb, packed);
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

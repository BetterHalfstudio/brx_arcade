// AUTO LIGHT — deterministic lighting normalization, applied to the SUBJECT
// only (transparent pixels are ignored) right before the manual levels.
//
// Fixes "every photo / every Gemini render is lit differently" without a model:
//   1. FLATTEN   — divide luminance by a heavy blur of itself (single-scale
//                  retinex), removing side-light gradients across the face.
//   2. STRETCH   — auto-levels: clipLo/clipHi percentiles of the subject's
//                  luminance histogram become black/white.
//   3. AUTO GAMMA — solve the gamma that lands the subject's median luminance
//                  on targetMid, so every image enters the dither with the
//                  same midpoint.
// All stats are alpha-weighted, so the cutout quality directly improves the
// normalization (background pixels never poison the histogram).

export interface AutoLightOpts {
  /** where the subject's median luminance should land (0..1) */
  targetMid: number;
  /** % of darkest subject pixels clipped to black (0..10) */
  clipLo: number;
  /** percentile mapped to white (90..100) */
  clipHi: number;
  /** 0..1 strength of the illumination flatten (0 = off) */
  flatten: number;
}

const luma = (d: Uint8ClampedArray, i: number) =>
  0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** In-place separable box blur on a Float32 field (3 passes ≈ gaussian). */
function blurField(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  let a = src.slice();
  let b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  const norm = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * norm;
        const add = Math.min(w - 1, x + r + 1);
        const sub = Math.max(0, x - r);
        acc += a[row + add] - a[row + sub];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * norm;
        const add = Math.min(h - 1, y + r + 1);
        const sub = Math.max(0, y - r);
        acc += b[add * w + x] - b[sub * w + x];
      }
    }
  }
  return a;
}

export function applyAutoLight(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  o: AutoLightOpts
): void {
  const n = w * h;

  // subject luminance field + mean (transparent pixels take the mean so the
  // blur doesn't drag halos in from outside the cutout)
  const L = new Float32Array(n);
  let sum = 0;
  let count = 0;
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] >= 128) {
      const v = luma(data, p * 4);
      L[p] = v;
      sum += v;
      count++;
    } else {
      L[p] = -1; // fill after the mean is known
    }
  }
  if (count < 16) return; // nothing meaningful to normalize
  const mean = sum / count;
  for (let p = 0; p < n; p++) if (L[p] < 0) L[p] = mean;

  // --- 1. illumination flatten (single-scale retinex) ------------------------
  if (o.flatten > 0.001) {
    const blur = blurField(L, w, h, Math.min(w, h) / 5);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      if (data[i + 3] < 128) continue;
      const local = Math.max(8, blur[p]);
      const gain = 1 + ((mean / local) - 1) * o.flatten;
      data[i] = Math.max(0, Math.min(255, data[i] * gain));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * gain));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * gain));
    }
  }

  // --- 2. percentile stretch (auto-levels) -----------------------------------
  const hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] >= 128) hist[Math.min(255, Math.round(luma(data, p * 4)))]++;
  }
  const pick = (pct: number): number => {
    const target = (pct / 100) * count;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const lo = pick(Math.max(0, o.clipLo));
  const hi = pick(Math.min(100, o.clipHi));
  const span = Math.max(8, hi - lo);

  // --- 3. auto gamma to the target median ------------------------------------
  // median AFTER the stretch, computed from the same histogram
  let acc = 0;
  let median = 128;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= count / 2) {
      median = v;
      break;
    }
  }
  const medStretched = Math.min(0.98, Math.max(0.02, (median - lo) / span));
  const target = Math.min(0.95, Math.max(0.05, o.targetMid));
  const gamma = Math.min(5, Math.max(0.2, Math.log(target) / Math.log(medStretched)));

  // one LUT for stretch + gamma, applied per channel (hue preserved)
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    lut[v] = Math.round(Math.pow(t, gamma) * 255);
  }
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

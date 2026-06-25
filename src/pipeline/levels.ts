// Stage 2 — LEVELS (pre-dither).
// Black point / white point remap + gamma, applied per channel through a
// 256-entry lookup table. Alpha is left untouched.

export interface Levels {
  blackPoint: number;
  whitePoint: number;
  gamma: number;
}

export function buildLevelsLut(d: Levels): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const black = Math.min(d.blackPoint, d.whitePoint - 1);
  const white = Math.max(d.whitePoint, black + 1);
  const span = white - black;
  const invGamma = 1 / Math.max(0.01, d.gamma);
  for (let i = 0; i < 256; i++) {
    let v = (i - black) / span; // remap to 0..1 across [black, white]
    v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, invGamma);
    lut[i] = v * 255;
  }
  return lut;
}

/** Apply the levels LUT in place to the RGB channels of an RGBA buffer. */
export function applyLevels(data: Uint8ClampedArray, lut: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // skip fully transparent
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

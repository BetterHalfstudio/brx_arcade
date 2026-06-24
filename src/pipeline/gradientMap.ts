import type { GradientStop } from "../state/types";
import { hexToRgb, luma } from "../util/color";

// Stage 4 — GRADIENT MAP (optional).
// When ON, recolor the whole buffer by luminance, OVERRIDING the palette
// entirely (full override, no mix). Builds a 256-entry ramp from the stops.

export function buildGradientLut(stops: GradientStop[]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (sorted.length === 0) {
    return lut; // all black
  }
  if (sorted.length === 1) {
    const { r, g, b } = hexToRgb(sorted[0].color);
    for (let i = 0; i < 256; i++) {
      lut[i * 3] = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
    return lut;
  }
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // find bracketing stops
    let a = sorted[0];
    let b = sorted[sorted.length - 1];
    for (let s = 0; s < sorted.length - 1; s++) {
      if (t >= sorted[s].pos && t <= sorted[s + 1].pos) {
        a = sorted[s];
        b = sorted[s + 1];
        break;
      }
    }
    const span = b.pos - a.pos || 1;
    const f = Math.max(0, Math.min(1, (t - a.pos) / span));
    const ca = hexToRgb(a.color);
    const cb = hexToRgb(b.color);
    lut[i * 3] = ca.r + (cb.r - ca.r) * f;
    lut[i * 3 + 1] = ca.g + (cb.g - ca.g) * f;
    lut[i * 3 + 2] = ca.b + (cb.b - ca.b) * f;
  }
  return lut;
}

export function applyGradientMap(
  data: Uint8ClampedArray,
  lut: Uint8Array
): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const l = Math.round(luma(data[i], data[i + 1], data[i + 2]));
    data[i] = lut[l * 3];
    data[i + 1] = lut[l * 3 + 1];
    data[i + 2] = lut[l * 3 + 2];
  }
}

// Small color helpers shared by the pipeline stages.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse "#rgb" / "#rrggbb" (with or without leading #) → RGB 0..255. */
export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

/** Rec. 601 luma, the perceptual weighting used for the grayscale ramp. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function isValidHex(hex: string): boolean {
  const h = hex.trim().replace(/^#/, "");
  return /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h);
}

/** Flatten a hex palette to a Uint8 [r,g,b, r,g,b, ...] table for fast lookup. */
export function paletteToBytes(palette: string[]): Uint8Array {
  const out = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    const { r, g, b } = hexToRgb(palette[i]);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

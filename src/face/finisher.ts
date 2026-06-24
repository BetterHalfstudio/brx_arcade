import { dither } from "../pipeline/dither";
import type { DitherType } from "../state/types";
import { paletteToBytes } from "../util/color";

// The "pixel lock": the deterministic finisher that normalizes any stylized
// output to a fixed sprite resolution + palette + dither, so every caricature
// shares the same BRX look regardless of how the AI drew it. Transparent
// pixels are preserved (background stays knocked out).

export interface LockOpts {
  targetH: number; // sprite resolution (short side stays proportional)
  palette: string[];
  type: DitherType;
  on: boolean; // when off, just downscale to the grid (no palette snap)
}

/** Returns a sprite-resolution canvas (transparent where the source was). */
export function pixelLock(
  source: HTMLImageElement | HTMLCanvasElement,
  opts: LockOpts
): HTMLCanvasElement {
  const sw = (source as HTMLCanvasElement).width || (source as HTMLImageElement).naturalWidth;
  const sh = (source as HTMLCanvasElement).height || (source as HTMLImageElement).naturalHeight;
  const ar = sw / sh || 1;
  const th = Math.max(8, Math.round(opts.targetH));
  const tw = Math.max(8, Math.round(th * ar));

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true; // average down for representative colors
  ctx.drawImage(source, 0, 0, tw, th);

  if (opts.on && opts.palette.length > 0) {
    const img = ctx.getImageData(0, 0, tw, th);
    dither(img.data, tw, th, {
      type: opts.type,
      mode: "palette",
      threshold: 128,
      palette: paletteToBytes(opts.palette),
      paletteCount: opts.palette.length,
    });
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

/** Nearest-neighbor upscale of a sprite canvas by an integer factor. */
export function upscale(sprite: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = sprite.width * factor;
  c.height = sprite.height * factor;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, 0, 0, c.width, c.height);
  return c;
}

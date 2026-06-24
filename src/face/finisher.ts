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

/**
 * Flood-fill the connected background from the image borders to alpha 0, so the
 * head becomes a clean cutout. Background colour is sampled from the corners,
 * which handles a solid background (e.g. black) OR an already-transparent one.
 * Interior pixels of that colour (features inside the head) are preserved.
 */
export function removeBorderBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tol = 42
): void {
  const at = (x: number, y: number) => (y * w + x) * 4;
  let br = 0, bg = 0, bb = 0, ba = 0;
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const i = at(cx, cy);
    br += data[i]; bg += data[i + 1]; bb += data[i + 2]; ba += data[i + 3];
  }
  br /= 4; bg /= 4; bb /= 4; ba /= 4;
  const transparentBg = ba < 24;
  const isBg = (i: number) => {
    if (data[i + 3] < 24) return true; // already transparent
    if (transparentBg) return false;
    const dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb;
    return dr * dr + dg * dg + db * db <= tol * tol;
  };

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (isBg(p * 4)) {
      data[p * 4 + 3] = 0;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
  for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }
}

/**
 * The fixed FACE finisher: downscale to a sprite, knock out the background, and
 * snap the head to the two-colour palette with ordered dithering. Returns a
 * transparent-background sprite canvas.
 */
export function facePixelArt(
  source: HTMLImageElement | HTMLCanvasElement,
  opts: { targetH: number; palette: string[]; type: DitherType }
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
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, tw, th);

  const img = ctx.getImageData(0, 0, tw, th);
  removeBorderBackground(img.data, tw, th);
  dither(img.data, tw, th, {
    type: opts.type,
    mode: "palette",
    threshold: 128,
    palette: paletteToBytes(opts.palette),
    paletteCount: opts.palette.length,
  });
  ctx.putImageData(img, 0, 0);
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

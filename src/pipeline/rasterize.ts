import type { Layer } from "../state/types";
import { CANVAS_W, CANVAS_H } from "../state/types";

// Stage 1 — RASTERIZE.
// Draw the placed sprite at its current center/scale into the 800x600 buffer
// with nearest-neighbor sampling, full color, transparent everywhere else.
// This is the SOURCE OF TRUTH; every later stage recomputes from here, never
// from prior output.

export interface SpriteRect {
  /** integer pixel rect of the sprite inside the 800x600 buffer */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Returns the on-canvas rect (source space) the sprite currently occupies. */
export function spriteRect(layer: Layer): SpriteRect {
  const w = layer.naturalW * layer.scale;
  const h = layer.naturalH * layer.scale;
  return {
    x: layer.x - w / 2,
    y: layer.y - h / 2,
    w,
    h,
  };
}

export function rasterize(ctx: CanvasRenderingContext2D, layer: Layer): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  if (!layer.image || layer.naturalW === 0) return;

  // Crisp upscaling — pixels stay square at any scale.
  ctx.imageSmoothingEnabled = false;
  const r = spriteRect(layer);
  ctx.drawImage(layer.image, r.x, r.y, r.w, r.h);
}

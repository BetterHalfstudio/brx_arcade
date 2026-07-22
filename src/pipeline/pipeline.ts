import { rasterize } from "./rasterize";
import { buildLevelsLut, applyLevels } from "./levels";
import { dither, ditherGradient, toGrayscale, type DitherMode } from "./dither";
import { hexToRgb } from "../util/color";
import { CANVAS_W, CANVAS_H } from "../state/types";
import type { AppState } from "../state/types";

// PIPELINE ORCHESTRATOR.
// Recomputes stages 1..4 from the ORIGINAL source on every run() — never from
// prior output. Pixelation (block size) is handled by processing at a reduced
// resolution and nearest-upscaling back, so each "pixel" becomes an NxN block.

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export class Pipeline {
  private readonly srcCtx: CanvasRenderingContext2D;
  /** reduced-resolution scratch for pixelation (uses a wq x hq sub-region) */
  private readonly small: HTMLCanvasElement;
  private readonly smallCtx: CanvasRenderingContext2D;
  /** flat result of stages 1..4 — transparent where there is no sprite */
  readonly resultCanvas: HTMLCanvasElement;
  private readonly resultCtx: CanvasRenderingContext2D;
  /** scratch to composite a background behind the result (stage 5) */
  private readonly comp: HTMLCanvasElement;
  private readonly compCtx: CanvasRenderingContext2D;

  constructor() {
    const [, srcCtx] = makeCanvas();
    this.srcCtx = srcCtx;
    [this.small, this.smallCtx] = makeCanvas();
    [this.resultCanvas, this.resultCtx] = makeCanvas();
    [this.comp, this.compCtx] = makeCanvas();
  }

  /** Stages 1..4 → resultCanvas. Pure function of state + the original image. */
  run(state: AppState): void {
    const { dither: d, color } = state;

    // 1 — rasterize the placed sprite (source of truth)
    rasterize(this.srcCtx, state.layer);

    // pixelation: process at reduced resolution, upscale blocks back
    const B = Math.max(1, Math.round(d.pixelSize));
    const wq = Math.max(1, Math.ceil(CANVAS_W / B));
    const hq = Math.max(1, Math.ceil(CANVAS_H / B));

    let img: ImageData;
    if (B > 1) {
      this.smallCtx.imageSmoothingEnabled = true; // average blocks down
      this.smallCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      this.smallCtx.drawImage(this.srcCtx.canvas, 0, 0, CANVAS_W, CANVAS_H, 0, 0, wq, hq);
      img = this.smallCtx.getImageData(0, 0, wq, hq);
    } else {
      img = this.srcCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    }
    const data = img.data;

    // 2 — levels (pre-dither)
    applyLevels(data, buildLevelsLut(d));

    const dw = B > 1 ? wq : CANVAS_W;
    const dh = B > 1 ? hq : CANVAS_H;

    // 3 — dither + recolour.
    if (color.gradientMapOn) {
      // Gradient map is the only recolour system: dither happens IN BRIGHTNESS
      // SPACE against the positioned stops, so the stop sliders (and hard stops)
      // shape the output instead of being flattened by an earlier quantisation.
      const stops = color.gradientStops
        .map((s) => ({ pos: s.pos, ...hexToRgb(s.color) }))
        .sort((a, b) => a.pos - b.pos);
      ditherGradient(data, dw, dh, d.type, stops, color.hardStops);
    } else {
      // black & white base when original colors are off
      if (!color.originalColors) toGrayscale(data);
      const mode: DitherMode = color.originalColors ? "original" : "bw";
      dither(data, dw, dh, {
        type: d.type,
        mode,
        threshold: d.threshold,
        palette: new Uint8Array(0),
        paletteCount: 0,
      });
    }

    // write back, upscaling the reduced buffer into NxN blocks if pixelated
    if (B > 1) {
      this.smallCtx.putImageData(img, 0, 0);
      this.resultCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      this.resultCtx.imageSmoothingEnabled = false;
      this.resultCtx.drawImage(this.small, 0, 0, wq, hq, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      this.resultCtx.putImageData(img, 0, 0);
    }
  }

  /**
   * Stage 5 composite. Returns a CANVAS_W x CANVAS_H canvas:
   *   background != null -> opaque fill with the result drawn over it
   *   background == null -> the flat result as-is (transparent where empty)
   */
  composite(background: string | null): HTMLCanvasElement {
    if (background == null) return this.resultCanvas;
    this.compCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.compCtx.fillStyle = background;
    this.compCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    this.compCtx.drawImage(this.resultCanvas, 0, 0);
    return this.comp;
  }
}

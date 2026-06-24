import { rasterize } from "./rasterize";
import { buildLevelsLut, applyLevels } from "./levels";
import { dither } from "./dither";
import { buildGradientLut, applyGradientMap } from "./gradientMap";
import { paletteToBytes } from "../util/color";
import { CANVAS_W, CANVAS_H } from "../state/types";
import type { AppState } from "../state/types";

// PIPELINE ORCHESTRATOR.
// Recomputes stages 1..4 from the ORIGINAL source on every run() — never from
// prior output. Stage 5 (background) is a composite step applied on demand so
// the same flat result can be exported transparent OR shown/baked over a fill.

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export class Pipeline {
  /** rasterize scratch context (stage 1); its canvas stays alive via .canvas */
  private readonly srcCtx: CanvasRenderingContext2D;
  /** flat result of stages 1..4 — transparent where there is no sprite */
  readonly resultCanvas: HTMLCanvasElement;
  private readonly resultCtx: CanvasRenderingContext2D;
  /** scratch used to composite a background behind the result (stage 5) */
  private readonly comp: HTMLCanvasElement;
  private readonly compCtx: CanvasRenderingContext2D;

  constructor() {
    const [, srcCtx] = makeCanvas();
    this.srcCtx = srcCtx;
    [this.resultCanvas, this.resultCtx] = makeCanvas();
    [this.comp, this.compCtx] = makeCanvas();
  }

  /** Stages 1..4 → resultCanvas. Pure function of state + the original image. */
  run(state: AppState): void {
    // 1 — rasterize the placed sprite (source of truth)
    rasterize(this.srcCtx, state.layer);
    const img = this.srcCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const data = img.data;

    // 2 — levels (pre-dither)
    applyLevels(data, buildLevelsLut(state.dither));

    // 3 — dither (targets palette if Color ON, else 1-bit threshold)
    dither(data, CANVAS_W, CANVAS_H, {
      type: state.dither.type,
      colorOn: state.dither.colorOn,
      threshold: state.dither.threshold,
      palette: paletteToBytes(state.color.palette),
      paletteCount: state.color.palette.length,
    });

    // 4 — gradient map (overrides palette entirely when ON)
    if (state.color.gradientMapOn) {
      applyGradientMap(data, buildGradientLut(state.color.gradientStops));
    }

    this.resultCtx.putImageData(img, 0, 0);
  }

  /**
   * Stage 5 composite. Returns an 800x600 canvas:
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

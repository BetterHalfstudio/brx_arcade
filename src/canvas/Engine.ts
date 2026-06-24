import { Pipeline } from "../pipeline/pipeline";
import { spriteRect } from "../pipeline/rasterize";
import { CRTRenderer } from "../crt/crt";
import type { AppState } from "../state/types";
import { CANVAS_W, CANVAS_H } from "../state/types";

// Imperative render engine. Owns the pipeline, the optional CRT renderer, and
// painting of the three stacked canvases (flat display / CRT / selection
// overlay). State pushes in via setState(); pipeline recompute is coalesced to
// one run per animation frame (still always from the original source).

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
  );
}

export class Engine {
  private pipeline = new Pipeline();
  private crt: CRTRenderer | null = null;
  private state: AppState | null = null;

  private dirty = false;
  private raf = 0;

  // display metrics (CSS px) for overlay mapping
  private cssW = CANVAS_W;
  private cssH = CANVAS_H;
  private dpr = 1;

  private flatCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;

  constructor(
    private flat: HTMLCanvasElement,
    private crtCanvas: HTMLCanvasElement,
    private overlay: HTMLCanvasElement
  ) {
    this.flat.width = CANVAS_W;
    this.flat.height = CANVAS_H;
    this.flatCtx = this.flat.getContext("2d")!;
    this.flatCtx.imageSmoothingEnabled = false;
    this.overlayCtx = this.overlay.getContext("2d")!;
  }

  setState(s: AppState) {
    this.state = s;
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  setDisplayMetrics(cssW: number, cssH: number) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    // CRT + overlay render at device resolution; flat stays 800x600 (CSS-scaled)
    const dw = Math.round(this.cssW * this.dpr);
    const dh = Math.round(this.cssH * this.dpr);
    this.crt?.resize(dw, dh);
    if (this.crtCanvas.width !== dw) this.crtCanvas.width = dw;
    if (this.crtCanvas.height !== dh) this.crtCanvas.height = dh;
    this.overlay.width = dw;
    this.overlay.height = dh;
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame() {
    this.raf = 0;
    if (!this.dirty || !this.state) return;
    this.dirty = false;
    this.recompute(this.state);
  }

  private recompute(s: AppState) {
    // Stages 1..4 from the original source.
    this.pipeline.run(s);
    // Stage 5 — display always composites over the background fill.
    const composited = this.pipeline.composite(s.color.background);

    // Always paint the flat 800x600 canvas: it backs the non-CRT view AND is
    // the buffer the in-canvas eyedropper reads (even while hidden under CRT).
    this.flatCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.flatCtx.drawImage(composited, 0, 0);

    if (s.crt.on) {
      if (!this.crt) {
        this.crt = new CRTRenderer(this.crtCanvas);
        const dw = Math.round(this.cssW * this.dpr);
        const dh = Math.round(this.cssH * this.dpr);
        this.crt.resize(dw, dh);
      }
      this.crt.setSource(composited);
      this.crt.setParams(s.crt);
      this.crt.start();
    } else {
      this.crt?.stop();
    }

    this.drawOverlay(s);
  }

  private drawOverlay(s: AppState) {
    const ctx = this.overlayCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (!s.selected || !s.layer.image) return;

    const sx = this.cssW / CANVAS_W; // source→display scale (4:3 preserved)
    const r = spriteRect(s.layer);
    const x = r.x * sx;
    const y = r.y * sx;
    const w = r.w * sx;
    const h = r.h * sx;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(41,167,175,0.9)";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);

    // corner handles
    const hs = 7;
    ctx.fillStyle = "#ef4a20";
    ctx.strokeStyle = "#0a0908";
    for (const [hx, hy] of [
      [x, y], [x + w, y], [x, y + h], [x + w, y + h],
    ]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.strokeRect(hx - hs / 2 + 0.5, hy - hs / 2 + 0.5, hs, hs);
    }
  }

  /** Read the composited color at a source-space pixel (in-canvas eyedropper). */
  pickColor(sx: number, sy: number): string {
    const x = Math.max(0, Math.min(CANVAS_W - 1, Math.round(sx)));
    const y = Math.max(0, Math.min(CANVAS_H - 1, Math.round(sy)));
    const d = this.flatCtx.getImageData(x, y, 1, 1).data;
    const h = (v: number) => v.toString(16).padStart(2, "0");
    return "#" + h(d[0]) + h(d[1]) + h(d[2]);
  }

  /** Source-space sprite rect, in CSS display pixels (for hit-testing). */
  displayRect(s: AppState) {
    const sx = this.cssW / CANVAS_W;
    const r = spriteRect(s.layer);
    return { x: r.x * sx, y: r.y * sx, w: r.w * sx, h: r.h * sx, scale: sx };
  }

  async exportPNG(s: AppState): Promise<Blob> {
    this.pipeline.run(s); // ensure fresh
    if (s.crt.on) {
      if (!this.crt) this.crt = new CRTRenderer(this.crtCanvas);
      // CRT bakes over a forced-opaque background.
      this.crt.setSource(this.pipeline.composite(s.color.background));
      this.crt.setParams(s.crt);
      const out = this.crt.grab(s.exportScale);
      // restore live size
      this.setDisplayMetrics(this.cssW, this.cssH);
      return canvasToBlob(out);
    }
    // Flat export: filled bg OR transparent.
    const bg = s.exportTransparent ? null : s.color.background;
    const src = this.pipeline.composite(bg);
    // Copy to a detached canvas so we never hand out a live buffer.
    const out = document.createElement("canvas");
    out.width = CANVAS_W;
    out.height = CANVAS_H;
    out.getContext("2d")!.drawImage(src, 0, 0);
    return canvasToBlob(out);
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.crt?.dispose();
  }
}

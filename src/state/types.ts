// ============================================================================
// Central state model.
// Forward-compat: the placed image is a `Layer` object even though there is
// exactly one. Multi-sprite (roadmap) becomes `layers: Layer[]` later, not a
// rewrite. `x, y` are the sprite's CENTER in 800x600 source space; `scale` is a
// free multiplier on the image's natural size (1 = native pixels).
// ============================================================================

export const CANVAS_W = 600;
export const CANVAS_H = 450;

export type DitherType = "fs" | "bayer2" | "bayer4" | "bayer8";

export interface Layer {
  image: HTMLImageElement | null;
  /** natural pixel size of the source image */
  naturalW: number;
  naturalH: number;
  /** center position in source space (CANVAS_W x CANVAS_H) */
  x: number;
  y: number;
  /** free scale multiplier on natural size */
  scale: number;
}

export interface DitherState {
  type: DitherType;
  /** pixelation block edge: 1 = native, 2 = 2x2 blocks, etc. */
  pixelSize: number;
  blackPoint: number; // 0..255  (pre-levels)
  whitePoint: number; // 0..255
  gamma: number; // 0.1..3.0
  threshold: number; // 0..255  (B&W 1-bit cutoff)
  /** Pixel-Lock: snap already-pixel-art input to its native grid (one solid
   *  colour per cell) INSTEAD of dithering. Supersedes pixelSize + dither. */
  pixelLock: boolean;
  /** native cell size in source px — seeded by auto-detect, user-adjustable */
  pixelLockSize: number;
  /** last auto-detected cell size (for the AUTO readout / re-detect) */
  pixelLockAuto: number;
  /** target max colours after collapse (2..PIXEL_LOCK_COLORS_MAX); near-dupes
   *  are always merged, then the palette is reduced to this many */
  pixelLockColors: number;
}

/** Colour-count slider bounds for Pixel-Lock. */
export const PIXEL_LOCK_COLORS_MIN = 2;
export const PIXEL_LOCK_COLORS_MAX = 20;

export interface GradientStop {
  pos: number; // 0..1
  color: string; // hex
}

export interface ColorState {
  /** ON = keep the image's original colors; OFF = black & white base.
   *  (No effect while the gradient map is on — that maps by brightness.) */
  originalColors: boolean;
  /** recolor by brightness using positioned stops */
  gradientMapOn: boolean;
  gradientStops: GradientStop[];
  /** no blending between stops — each stop's position is where its color starts */
  hardStops: boolean;
  background: string; // hex
}

/** Max gradient stops. */
export const STOPS_MAX = 12;

export interface CRTState {
  on: boolean; // OFF by default
  barrel: number; // 0..1  curvature (minimal)
  scanline: number; // 0..1  scanline / venetian depth
  glow: number; // 0..1  bloom
  aberration: number; // 0..1  chromatic aberration
  vignette: number; // 0..1
  flicker: number; // 0..1  flicker + noise
  mask: number; // 0..1  aperture/phosphor mask
}

export interface AppState {
  layer: Layer;
  dither: DitherState;
  color: ColorState;
  crt: CRTState;
  /** UI: is the single layer currently selected (shows box + handles) */
  selected: boolean;
  /** UI: in-canvas eyedropper armed (picks background color on next click) */
  eyedropper: boolean;
  /** export options */
  exportTransparent: boolean; // only meaningful when CRT off
  exportScale: 1 | 2 | 3; // only meaningful when CRT on
}

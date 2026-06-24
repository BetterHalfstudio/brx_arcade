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
}

export interface GradientStop {
  pos: number; // 0..1
  color: string; // hex
}

export interface ColorState {
  /** ON = keep the image's original colors; OFF = black & white base */
  originalColors: boolean;
  /** recolor mode A: snap the dither to the active palette (excl. gradient) */
  paletteOn: boolean;
  /** recolor mode B: gradient map by luminance (exclusive with palette) */
  gradientMapOn: boolean;
  /** color-mode palette: a built-in default or the user's custom set */
  paletteSource: "default" | "custom";
  defaultIndex: number; // 0..4 selected built-in palette
  customPalette: string[]; // user palette (color mode)
  bwPalette: string[]; // 2-color duotone used when B&W (Original Colors off)
  gradientStops: GradientStop[];
  background: string; // hex
}

/** Max palette entries: a duotone pair in B&W, otherwise a fuller set. */
export const PALETTE_MAX_BW = 2;
export const PALETTE_MAX = 16;

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

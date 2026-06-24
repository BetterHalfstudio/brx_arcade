// ============================================================================
// Central state model.
// Forward-compat: the placed image is a `Layer` object even though there is
// exactly one. Multi-sprite (roadmap) becomes `layers: Layer[]` later, not a
// rewrite. `x, y` are the sprite's CENTER in 800x600 source space; `scale` is a
// free multiplier on the image's natural size (1 = native pixels).
// ============================================================================

export const CANVAS_W = 800;
export const CANVAS_H = 600;

export type DitherType = "fs" | "bayer2" | "bayer4" | "bayer8";

export interface Layer {
  image: HTMLImageElement | null;
  /** natural pixel size of the source image */
  naturalW: number;
  naturalH: number;
  /** center position in 800x600 source space */
  x: number;
  y: number;
  /** free scale multiplier on natural size */
  scale: number;
}

export interface DitherState {
  type: DitherType;
  blackPoint: number; // 0..255  (pre-levels)
  whitePoint: number; // 0..255
  gamma: number; // 0.1..3.0
  threshold: number; // 0..255  (active only when color is OFF)
  colorOn: boolean;
}

export interface GradientStop {
  pos: number; // 0..1
  color: string; // hex
}

export interface ColorState {
  palette: string[]; // hex list the dither snaps to (feeds stage 3)
  gradientMapOn: boolean;
  gradientStops: GradientStop[];
  background: string; // hex
}

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

import type { AppState, GradientStop } from "./types";
import { CANVAS_W, CANVAS_H } from "./types";

const OFF_BLACK = "#0a0908"; // shared darkest swatch across the defaults

// Default palette is sampled straight from hero reference #1 so a freshly
// dropped image already snaps to the BRX_ARCADE look. Easy to edit in-app.
export const HERO_PALETTE = [
  OFF_BLACK, // near black
  "#2a2823", // warm dark
  "#3b3934", // grey key
  "#ff3d00", // brand orange
  "#29a7af", // teal
  "#a7af2a", // olive
  "#a9a489", // dim cream
  "#e7e2c6", // cream
];

// Built-in palettes, shown as preset buttons. Clicking one loads its colors
// into the gradient map as evenly-spaced stops, which you then reposition/edit.
// Stored darkest→lightest so they map sensibly onto the brightness ramp.
export const DEFAULT_PALETTES: string[][] = [
  HERO_PALETTE, // 01 — current
  [OFF_BLACK, "#ff3d00", "#f1ead0", "#29a7af"], // 02 — black / orange / off-white / teal
  [OFF_BLACK, "#27430f", "#7fae2b", "#dfe98c"], // 03 — greeny-yellow
  [OFF_BLACK, "#16306b", "#f6b6d2", "#f3eee2"], // 04 — deep blue / light pink / white
  [OFF_BLACK, "#241043", "#5b2a8c", "#b98cd9"], // 05 — deep purples
  ["#011b28", "#173544", "#2e5e75", "#78a9c2", "#cbdee7"], // 06 — steel blues
  [OFF_BLACK, "#1b2338", "#8a6d51", "#e4d1bd"], // 07 — navy / leather / tan
];

/** Monotonic id for gradient stops (row identity for keys + animation). */
let nextStopId = 1;
export const stopId = () => nextStopId++;

/** Spread a palette evenly across the 0..1 brightness ramp as gradient stops. */
export function paletteToStops(colors: string[]): GradientStop[] {
  if (colors.length === 0) return [{ pos: 0, color: OFF_BLACK, id: stopId() }];
  if (colors.length === 1) return [{ pos: 0, color: colors[0], id: stopId() }];
  return colors.map((color, i) => ({
    pos: i / (colors.length - 1),
    color,
    id: stopId(),
  }));
}

export function makeDefaultState(): AppState {
  return {
    layer: {
      image: null,
      naturalW: 0,
      naturalH: 0,
      x: CANVAS_W / 2,
      y: CANVAS_H / 2,
      scale: 1,
    },
    dither: {
      type: "fs",
      pixelSize: 1,
      blackPoint: 0,
      whitePoint: 255,
      gamma: 1,
      threshold: 128,
      pixelLock: false,
      pixelLockSize: 1,
      pixelLockAuto: 1,
      pixelLockColors: 20,
    },
    color: {
      originalColors: true,
      gradientMapOn: false,
      gradientStops: [
        { pos: 0, color: "#0a0908", id: stopId() },
        { pos: 0.5, color: "#ff3d00", id: stopId() },
        { pos: 1, color: "#e7e2c6", id: stopId() },
      ],
      hardStops: false,
      background: "#0a0908",
    },
    crt: {
      on: false,
      barrel: 0.18,
      scanline: 0.35,
      glow: 0.3,
      aberration: 0.18,
      vignette: 0.4,
      flicker: 0.25,
      mask: 0.3,
    },
    selected: false,
    eyedropper: false,
    exportTransparent: false,
    exportScale: 2,
  };
}

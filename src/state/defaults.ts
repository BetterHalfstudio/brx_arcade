import type { AppState } from "./types";
import { CANVAS_W, CANVAS_H } from "./types";

// Default palette is sampled straight from hero reference #1 so a freshly
// dropped image already snaps to the BRX_ARCADE look. Easy to edit in-app.
export const HERO_PALETTE = [
  "#0a0908", // near black
  "#2a2823", // warm dark
  "#3b3934", // grey key
  "#ef4a20", // orange-red
  "#29a7af", // teal
  "#a7af2a", // olive
  "#a9a489", // dim cream
  "#e7e2c6", // cream
];

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
      blackPoint: 0,
      whitePoint: 255,
      gamma: 1,
      threshold: 128,
      colorOn: true,
    },
    color: {
      palette: [...HERO_PALETTE],
      gradientMapOn: false,
      gradientStops: [
        { pos: 0, color: "#0a0908" },
        { pos: 0.5, color: "#ef4a20" },
        { pos: 1, color: "#e7e2c6" },
      ],
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

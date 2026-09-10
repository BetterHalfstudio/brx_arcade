// The locked-in FACE look — single source of truth for the main tool AND the
// standalone avatar kiosk. When new values are dialled in (dev mode sliders),
// bake them here.

import type { AutoLightOpts } from "./autolight";

export const FACE_TARGET_H = 144;
export const FACE_TYPE = "bayer2" as const;
export const FACE_THRESHOLD = 124;
export const FACE_DARK = "#000000";
export const FACE_LIT = "#ff3d00";

export const BAKED_LEVELS = {
  blackPoint: 91,
  whitePoint: 170,
  gamma: 0.9,
};

export const BAKED_AUTOLIGHT: AutoLightOpts = {
  targetMid: 0.51,
  clipLo: 0,
  clipHi: 100,
  flatten: 0,
};

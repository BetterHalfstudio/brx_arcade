import { useMemo, useState } from "react";
import type {
  AppState,
  Layer,
  DitherState,
  ColorState,
  CRTState,
} from "./types";
import { CANVAS_W, CANVAS_H } from "./types";
import { makeDefaultState } from "./defaults";

// Central state + typed update helpers. One immutable slice update per call so
// React re-renders the panel and the top-level effect re-pushes to the Engine.

export interface StoreApi {
  state: AppState;
  setLayer: (p: Partial<Layer>) => void;
  setDither: (p: Partial<DitherState>) => void;
  setColor: (p: Partial<ColorState>) => void;
  setCRT: (p: Partial<CRTState>) => void;
  patch: (p: Partial<AppState>) => void;
  loadImage: (img: HTMLImageElement) => void;
}

export function useAppStore(): StoreApi {
  const [state, setState] = useState<AppState>(makeDefaultState);

  const api = useMemo(
    () => ({
      setLayer: (p: Partial<Layer>) =>
        setState((s) => ({ ...s, layer: { ...s.layer, ...p } })),
      setDither: (p: Partial<DitherState>) =>
        setState((s) => ({ ...s, dither: { ...s.dither, ...p } })),
      setColor: (p: Partial<ColorState>) =>
        setState((s) => ({ ...s, color: { ...s.color, ...p } })),
      setCRT: (p: Partial<CRTState>) =>
        setState((s) => ({ ...s, crt: { ...s.crt, ...p } })),
      patch: (p: Partial<AppState>) => setState((s) => ({ ...s, ...p })),
      loadImage: (img: HTMLImageElement) =>
        setState((s) => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          // Fit ~85% of the frame; center it; select it.
          const scale = Math.min(
            (CANVAS_W * 0.85) / w,
            (CANVAS_H * 0.85) / h
          );
          return {
            ...s,
            layer: {
              image: img,
              naturalW: w,
              naturalH: h,
              x: CANVAS_W / 2,
              y: CANVAS_H / 2,
              scale: scale > 0 ? scale : 1,
            },
            selected: true,
          };
        }),
    }),
    []
  );

  return { state, ...api };
}

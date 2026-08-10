import { useMemo, useRef, useState } from "react";
import type {
  AppState,
  Layer,
  DitherState,
  ColorState,
  CRTState,
  ToolMode,
} from "./types";
import { CANVAS_W, CANVAS_H, BG_W, BG_DEFAULT_H } from "./types";
import { makeDefaultState } from "./defaults";

// Central state + typed update helpers. One immutable slice update per call so
// React re-renders the panel and the top-level effect re-pushes to the Engine.
//
// UNDO: every recorded update snapshots the previous state onto a history
// stack. Updates arriving in quick succession (a slider drag, auto-detect
// firing right after an image swap) coalesce into ONE undo step — the snapshot
// taken at the start of the burst. Ctrl/Cmd+Z pops the stack.

const UNDO_COALESCE_MS = 400;
const UNDO_MAX = 60;

export interface StoreApi {
  state: AppState;
  setLayer: (p: Partial<Layer>) => void;
  setDither: (p: Partial<DitherState>) => void;
  setColor: (p: Partial<ColorState>) => void;
  setCRT: (p: Partial<CRTState>) => void;
  patch: (p: Partial<AppState>) => void;
  loadImage: (img: HTMLImageElement) => void;
  clearImage: () => void;
  /** restore the previous recorded state (Ctrl/Cmd+Z) */
  undo: () => void;
}

/** Patch keys that are transient UI state — not worth an undo step on their own. */
const UNRECORDED_KEYS = new Set<keyof AppState>(["selected", "eyedropper"]);

export function useAppStore(mode: ToolMode = "dither"): StoreApi {
  const [state, setState] = useState<AppState>(() => makeDefaultState(mode));
  const history = useRef<AppState[]>([]);
  const lastChange = useRef(0);

  const api = useMemo(() => {
    /** setState wrapper that snapshots for undo (bursts coalesce). */
    const recorded = (updater: (s: AppState) => AppState) =>
      setState((s) => {
        const now = Date.now();
        if (now - lastChange.current > UNDO_COALESCE_MS) {
          history.current.push(s);
          if (history.current.length > UNDO_MAX) history.current.shift();
        }
        lastChange.current = now;
        return updater(s);
      });

    return {
      setLayer: (p: Partial<Layer>) =>
        recorded((s) => ({ ...s, layer: { ...s.layer, ...p } })),
      setDither: (p: Partial<DitherState>) =>
        recorded((s) => ({ ...s, dither: { ...s.dither, ...p } })),
      setColor: (p: Partial<ColorState>) =>
        recorded((s) => ({ ...s, color: { ...s.color, ...p } })),
      setCRT: (p: Partial<CRTState>) =>
        recorded((s) => ({ ...s, crt: { ...s.crt, ...p } })),
      patch: (p: Partial<AppState>) => {
        const recordable = Object.keys(p).some(
          (k) => !UNRECORDED_KEYS.has(k as keyof AppState)
        );
        if (recordable) recorded((s) => ({ ...s, ...p }));
        else setState((s) => ({ ...s, ...p }));
      },
      clearImage: () =>
        recorded((s) => {
          const cw = s.mode === "bg" ? BG_W : CANVAS_W;
          const ch = s.mode === "bg" ? BG_DEFAULT_H : CANVAS_H;
          return {
            ...s,
            canvas: { w: cw, h: ch },
            layer: { image: null, naturalW: 0, naturalH: 0, x: cw / 2, y: ch / 2, scale: 1 },
            selected: false,
          };
        }),
      loadImage: (img: HTMLImageElement) =>
        recorded((s) => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (s.mode === "bg") {
            // BG workspace: the canvas IS the image — width locked to BG_W,
            // height follows, the layer exactly covers it (no repositioning).
            const scale = BG_W / w;
            const ch = Math.max(1, Math.round(h * scale));
            return {
              ...s,
              canvas: { w: BG_W, h: ch },
              layer: {
                image: img,
                naturalW: w,
                naturalH: h,
                x: BG_W / 2,
                y: ch / 2,
                scale,
              },
              selected: false,
            };
          }
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
      undo: () => {
        const prev = history.current.pop();
        if (!prev) return;
        lastChange.current = 0; // the next change starts a fresh undo step
        setState(prev);
      },
    };
  }, []);

  return { state, ...api };
}

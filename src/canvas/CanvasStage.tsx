import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { StoreApi } from "../state/store";
import { CANVAS_W, CANVAS_H } from "../state/types";
import { Engine } from "./Engine";

// Right-hand canvas stage. Hosts the three stacked canvases, fits them to a
// 4:3 box in the available space (never overlapping the panel), and drives all
// pointer interaction. Editing happens on the flat (un-warped) buffer — pointer
// coords are NOT inverse-mapped through the CRT bulge (it is minimal by design).

type DragMode =
  | { kind: "none" }
  | { kind: "move"; startX: number; startY: number; ox: number; oy: number }
  | { kind: "scale"; cx: number; cy: number; startDist: number; startScale: number };

export function CanvasStage({
  store,
  engineRef,
  onDropFile,
}: {
  store: StoreApi;
  engineRef: MutableRefObject<Engine | null>;
  /** App decides whether to confirm an overwrite before loading. */
  onDropFile: (file: File) => void;
}) {
  const { state } = store;
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const flatRef = useRef<HTMLCanvasElement>(null);
  const crtRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragMode>({ kind: "none" });
  const [dragOver, setDragOver] = useState(false);

  // keep latest state for imperative pointer handlers
  const stateRef = useRef(state);
  stateRef.current = state;

  // --- create engine once ----------------------------------------------------
  useEffect(() => {
    const eng = new Engine(flatRef.current!, crtRef.current!, overlayRef.current!);
    engineRef.current = eng;
    return () => eng.dispose();
  }, []);

  // --- push state to engine on every change ----------------------------------
  useEffect(() => {
    engineRef.current?.setState(state);
  }, [state]);

  // --- fit the 4:3 frame into the available space ----------------------------
  useEffect(() => {
    const stage = stageRef.current!;
    const fit = () => {
      // Reserve a bottom band for the HUD so the canvas never overlaps it.
      const padX = 44;
      const padTop = 22;
      const padBottom = 44;
      const availW = stage.clientWidth - padX;
      const availH = stage.clientHeight - padTop - padBottom;
      let w = availW;
      let h = (w * CANVAS_H) / CANVAS_W;
      if (h > availH) {
        h = availH;
        w = (h * CANVAS_W) / CANVAS_H;
      }
      w = Math.max(160, Math.floor(w));
      h = Math.max(120, Math.floor(h));
      const frame = frameRef.current!;
      frame.style.width = w + "px";
      frame.style.height = h + "px";
      engineRef.current?.setDisplayMetrics(w, h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // --- drop loading (App gates on the overwrite confirm) ---------------------
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) onDropFile(file);
  }

  // --- pointer mapping -------------------------------------------------------
  function toSource(e: React.PointerEvent | React.MouseEvent) {
    const rect = overlayRef.current!.getBoundingClientRect();
    const sx = CANVAS_W / rect.width;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sx,
      cssScale: rect.width / CANVAS_W,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    const s = stateRef.current;
    if (!s.layer.image) return;
    const eng = engineRef.current!;
    const p = toSource(e);

    // eyedropper takes priority
    if (s.eyedropper) {
      store.setColor({ background: eng.pickColor(p.x, p.y) });
      store.patch({ eyedropper: false });
      return;
    }

    const r = eng.displayRect(s); // CSS px
    const px = e.clientX - overlayRef.current!.getBoundingClientRect().left;
    const py = e.clientY - overlayRef.current!.getBoundingClientRect().top;

    // corner-handle hit test (scale)
    const corners: [number, number][] = [
      [r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h],
    ];
    const HANDLE = 9;
    const onHandle =
      s.selected && corners.some(([hx, hy]) => Math.abs(px - hx) <= HANDLE && Math.abs(py - hy) <= HANDLE);

    const cx = s.layer.x;
    const cy = s.layer.y;
    const halfW = (s.layer.naturalW * s.layer.scale) / 2;
    const halfH = (s.layer.naturalH * s.layer.scale) / 2;
    const inside = Math.abs(p.x - cx) <= halfW && Math.abs(p.y - cy) <= halfH;

    if (onHandle) {
      const startDist = Math.hypot(p.x - cx, p.y - cy);
      drag.current = { kind: "scale", cx, cy, startDist: startDist || 1, startScale: s.layer.scale };
      capture(e);
    } else if (inside) {
      if (!s.selected) store.patch({ selected: true });
      drag.current = { kind: "move", startX: p.x, startY: p.y, ox: cx, oy: cy };
      capture(e);
    } else {
      // clicked empty space — deselect
      if (s.selected) store.patch({ selected: false });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (d.kind === "none") return;
    const p = toSource(e);
    if (d.kind === "move") {
      store.setLayer({ x: d.ox + (p.x - d.startX), y: d.oy + (p.y - d.startY) });
    } else if (d.kind === "scale") {
      const dist = Math.hypot(p.x - d.cx, p.y - d.cy);
      const next = Math.max(0.02, Math.min(64, (d.startScale * dist) / d.startDist));
      store.setLayer({ scale: next });
    }
  }

  function capture(e: React.PointerEvent) {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic event) — drag still works */
    }
  }

  function endDrag(e: React.PointerEvent) {
    if (drag.current.kind !== "none") {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
    }
    drag.current = { kind: "none" };
  }

  function onWheel(e: React.WheelEvent) {
    const s = stateRef.current;
    if (!s.layer.image || !s.selected) return;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const next = Math.max(0.02, Math.min(64, s.layer.scale * factor));
    store.setLayer({ scale: next });
  }

  const hasImage = !!state.layer.image;
  const r = state.layer;
  const dispW = Math.round(r.naturalW * r.scale);
  const dispH = Math.round(r.naturalH * r.scale);

  return (
    <div
      className={
        "stage" + (dragOver ? " dragover" : "") + (state.eyedropper ? " eyedrop" : "")
      }
      ref={stageRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="stage__frame" ref={frameRef}>
        <canvas
          ref={flatRef}
          className="stage__view"
          style={{ width: "100%", height: "100%", display: state.crt.on ? "none" : "block" }}
        />
        <canvas
          ref={crtRef}
          className="stage__view"
          style={{
            width: "100%",
            height: "100%",
            position: state.crt.on ? "static" : "absolute",
            display: state.crt.on ? "block" : "none",
          }}
        />
        <canvas
          ref={overlayRef}
          className="stage__overlay"
          style={{ width: "100%", height: "100%" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
        />

        {!hasImage && (
          <div className="stage__empty">
            <div>
              <div className="glyph">▦</div>
              <div className="big">DROP A PNG</div>
            </div>
          </div>
        )}

        <div className={"stage__drop" + (hasImage ? " replace" : "")}>
          <div>
            <div className="big">{hasImage ? "RELEASE TO REPLACE" : "RELEASE TO LOAD"}</div>
            <div className="sub">
              {hasImage ? "⚠ OVERWRITES CURRENT IMAGE" : "PNG → 600 × 450"}
            </div>
          </div>
        </div>
      </div>

      <div className="stage__hud" style={{ position: "absolute", left: 22, bottom: 14 }}>
        <span>
          <b>RES</b> {CANVAS_W}×{CANVAS_H}
        </span>
        {hasImage && (
          <>
            <span>
              <b>POS</b> {Math.round(r.x)},{Math.round(r.y)}
            </span>
            <span>
              <b>SIZE</b> {dispW}×{dispH}
            </span>
            <span>
              <b>SCALE</b> {r.scale.toFixed(2)}×
            </span>
          </>
        )}
        <span>
          <b>CRT</b> {state.crt.on ? "ON" : "OFF"}
        </span>
      </div>
    </div>
  );
}

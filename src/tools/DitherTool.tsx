import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import { Panel } from "../panel/Panel";
import { CanvasStage } from "../canvas/CanvasStage";
import type { Engine } from "../canvas/Engine";
import { downloadBlob, stampName } from "../export/download";
import { detectPixelGrid } from "../pipeline/pixelLock";

// The original dither/CRT tool, now mounted at the "/" route.

// Pending overwrite request — either the toolbar button or a dropped file.
type Pending = { kind: "button" } | { kind: "drop"; file: File } | null;

export function DitherTool() {
  const store = useAppStore();
  const engineRef = useRef<Engine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const hasImage = !!store.state.layer.image;

  // --- Pixel-Lock auto grid detection ----------------------------------------
  // Detect the native cell size once per image (the first time Pixel-Lock is
  // active for it); after that the slider is the user's to adjust. RE-DETECT
  // re-runs it on demand.
  const { setDither } = store;
  const image = store.state.layer.image;
  const pixelLock = store.state.dither.pixelLock;
  const detectedFor = useRef<HTMLImageElement | null>(null);

  const runDetect = useCallback(() => {
    if (!image) return;
    detectedFor.current = image;
    const cell = detectPixelGrid(image);
    setDither({ pixelLockSize: cell, pixelLockAuto: cell });
  }, [image, setDither]);

  useEffect(() => {
    if (!image || !pixelLock || detectedFor.current === image) return;
    runDetect();
  }, [image, pixelLock, runDetect]);

  // Delete / Backspace removes the placed image (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      e.preventDefault();
      store.clearImage();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store.clearImage]);

  function decodeAndLoad(file: File) {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      store.loadImage(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  const openPicker = () => fileRef.current?.click();

  function handleAddImage() {
    if (hasImage) setPending({ kind: "button" });
    else openPicker();
  }

  function handleDropFile(file: File) {
    if (hasImage) setPending({ kind: "drop", file });
    else decodeAndLoad(file);
  }

  function confirmReplace() {
    if (pending?.kind === "button") openPicker();
    else if (pending?.kind === "drop") decodeAndLoad(pending.file);
    setPending(null);
  }

  async function onExport() {
    const eng = engineRef.current;
    if (!eng || !store.state.layer.image) return;
    try {
      const blob = await eng.exportPNG(store.state);
      downloadBlob(blob, stampName());
    } catch (err) {
      console.error("export failed", err);
    }
  }

  return (
    <div className="app">
      <Panel store={store} onExport={onExport} onAddImage={handleAddImage} onRedetect={runDetect} />
      <CanvasStage store={store} engineRef={engineRef} onDropFile={handleDropFile} />

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) decodeAndLoad(f);
          e.target.value = "";
        }}
      />

      {pending && (
        <div className="modal" onClick={() => setPending(null)}>
          <div className="modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="modal__title">⚠ REPLACE IMAGE</div>
            <div className="modal__body">
              THIS WILL OVERWRITE YOUR CURRENT IMAGE. THIS CANNOT BE UNDONE.
            </div>
            <div className="modal__actions">
              <button className="key ghost" onClick={() => setPending(null)}>
                CANCEL
              </button>
              <button className="key hot" onClick={confirmReplace}>
                REPLACE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import { Panel } from "../panel/Panel";
import { CanvasStage } from "../canvas/CanvasStage";
import type { Engine } from "../canvas/Engine";
import { downloadBlob, stampName } from "../export/download";
import { detectPixelGrid } from "../pipeline/pixelLock";
import { removeSolidBackground } from "../util/removeBg";
import type { ToolMode } from "../state/types";

// The dither/CRT tool. Two workspaces share it:
//   "dither" — the classic fixed 600x450 canvas ("/")
//   "bg"     — parallax backgrounds: canvas locked to 1600px wide, height
//              follows the image, no repositioning ("/bg")

// Pending overwrite request — either the toolbar button or a dropped file.
type Pending = { kind: "button" } | { kind: "drop"; file: File } | null;

export function DitherTool({ mode = "dither" }: { mode?: ToolMode }) {
  const store = useAppStore(mode);
  const engineRef = useRef<Engine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const hasImage = !!store.state.layer.image;

  // --- Pixel-Lock grid detection ---------------------------------------------
  // Manual only: Pixel-Lock starts at the 1px default and stays there until the
  // slider is moved or RE-DETECT is pressed. (Auto-running this on enable was
  // overwriting the default before it was ever visible.)
  const { setDither } = store;
  const image = store.state.layer.image;

  const runDetect = useCallback(() => {
    if (!image) return;
    const cell = detectPixelGrid(image);
    setDither({ pixelLockSize: cell, pixelLockAuto: cell });
  }, [image, setDither]);

  // Delete / Backspace removes the placed image (ignored while typing).
  // Ctrl/Cmd+Z undoes the last change (sliders, colors, bg removal, …).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range"));

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (typing) return; // text fields keep the browser's native undo
        e.preventDefault();
        store.undo();
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      e.preventDefault();
      store.clearImage();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store.clearImage, store.undo]);

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

  // Auto background removal (border flood-fill — solid backgrounds).
  const [removingBg, setRemovingBg] = useState(false);
  async function onRemoveBg() {
    const img = store.state.layer.image;
    if (!img || removingBg) return;
    setRemovingBg(true);
    try {
      const cleaned = await removeSolidBackground(img);
      if (cleaned !== img) store.setLayer({ image: cleaned });
    } catch (err) {
      console.error("bg removal failed", err);
    } finally {
      setRemovingBg(false);
    }
  }

  /** image-only (cropped to visible pixels) */
  async function onExportImage() {
    const eng = engineRef.current;
    if (!eng || !store.state.layer.image) return;
    try {
      const blob = await eng.exportImagePNG(store.state);
      downloadBlob(blob, stampName());
    } catch (err) {
      console.error("export failed", err);
    }
  }

  /** full 600x450 frame (CRT baked when on) */
  async function onExportFrame() {
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
      <Panel
        store={store}
        onExportImage={onExportImage}
        onExportFrame={onExportFrame}
        onAddImage={handleAddImage}
        onRemoveBg={onRemoveBg}
        removingBg={removingBg}
        onRedetect={runDetect}
      />
      <CanvasStage
        store={store}
        engineRef={engineRef}
        onDropFile={handleDropFile}
        locked={mode === "bg"}
      />

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

import { useEffect, useRef, useState } from "react";
import { Slider, Toggle, Segmented } from "../panel/controls";
import type { DitherType } from "../state/types";
import { HERO_PALETTE } from "../state/defaults";
import { stylize, downscaleToBase64, type InlineImage } from "../face/api";
import { pixelLock, upscale } from "../face/finisher";
import { downloadBlob, stampName } from "../export/download";

const DEFAULT_PROMPT =
  "Redraw this person as a bold caricature: exaggerate their most distinctive " +
  "features while keeping them recognizable. Flat illustrated style, clean cel " +
  "shading, limited palette, head-and-shoulders, transparent background, no " +
  "text. Match the style of any reference images.";

type Source = HTMLImageElement | HTMLCanvasElement;
interface Ref extends InlineImage {
  url: string;
}

export function FaceTool() {
  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<HTMLImageElement | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // finisher (pixel lock) params
  const [lockOn, setLockOn] = useState(true);
  const [type, setType] = useState<DitherType>("bayer4");
  const [targetH, setTargetH] = useState(128);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const faceFileRef = useRef<HTMLInputElement>(null);
  const refFileRef = useRef<HTMLInputElement>(null);

  // --- camera ----------------------------------------------------------------
  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }
  async function startCam() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 1280, height: 960 },
        audio: false,
      });
      streamRef.current = stream;
      setCamOn(true);
      // attach after the <video> is shown
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 0);
    } catch (e: any) {
      setError(e?.message || "camera unavailable");
    }
  }
  function capture() {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setResult(null);
    setSource(c);
    stopCam();
  }
  useEffect(() => () => stopCam(), []);

  // --- file inputs -----------------------------------------------------------
  function loadFace(file: File) {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setResult(null);
      setSource(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  function addRefs(files: FileList) {
    Array.from(files).forEach((f) => {
      if (!f.type.startsWith("image/")) return;
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const inl = downscaleToBase64(img, 768, "image/png", 1);
        setRefs((r) => [...r, { ...inl, url }]);
      };
      img.src = url;
    });
  }

  // --- stylize ---------------------------------------------------------------
  async function onStylize() {
    if (!source || busy) return;
    setBusy(true);
    setError(null);
    try {
      const face = downscaleToBase64(source, 768, "image/jpeg", 0.92);
      const out = await stylize(
        face,
        prompt,
        refs.map((r) => ({ data: r.data, mimeType: r.mimeType }))
      );
      const img = new Image();
      img.onload = () => {
        setResult(img);
        setBusy(false);
      };
      img.onerror = () => {
        setError("could not decode model output");
        setBusy(false);
      };
      img.src = `data:${out.mimeType};base64,${out.image}`;
    } catch (e: any) {
      setError(e?.message || "stylize failed");
      setBusy(false);
    }
  }

  // --- live pixel-lock preview ----------------------------------------------
  useEffect(() => {
    const base = result || source;
    const cv = previewRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    if (!base) {
      cv.width = cv.height = 0;
      return;
    }
    const sprite = pixelLock(base, { targetH, palette: HERO_PALETTE, type, on: lockOn });
    cv.width = sprite.width;
    cv.height = sprite.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(sprite, 0, 0);
  }, [source, result, lockOn, type, targetH]);

  function onExport() {
    const base = result || source;
    if (!base) return;
    const sprite = pixelLock(base, { targetH, palette: HERO_PALETTE, type, on: lockOn });
    const factor = Math.max(1, Math.round(512 / sprite.height));
    upscale(sprite, factor).toBlob((b) => b && downloadBlob(b, stampName()), "image/png");
  }

  const hasBase = !!(source || result);

  return (
    <div className="app">
      <aside className="panel">
        {/* INPUT */}
        <div className="fgroup">
          <div className="ttl">INPUT · FACE</div>
          <div className="row">
            {!camOn ? (
              <button className="key block" onClick={startCam}>◉ CAMERA</button>
            ) : (
              <button className="key hot block" onClick={capture}>◉ CAPTURE</button>
            )}
            <button className="key block" onClick={() => faceFileRef.current?.click()}>↑ UPLOAD</button>
          </div>
          {camOn && (
            <button className="key sm ghost" onClick={stopCam}>✕ STOP CAMERA</button>
          )}
        </div>

        {/* AI STYLIZE */}
        <div className="fgroup">
          <div className="ttl">CARICATURE · GEMINI</div>
          <textarea
            className="prompt"
            value={prompt}
            spellCheck={false}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="ctl__label">
            <span>STYLE REFS</span>
            <span className="val">{refs.length}</span>
          </div>
          <div className="palette">
            {refs.map((r, i) => (
              <div
                className="chip"
                key={i}
                style={{ background: `center/cover url(${r.url})` }}
              >
                <span
                  className="x"
                  onClick={() => setRefs((rr) => rr.filter((_, j) => j !== i))}
                >
                  ×
                </span>
              </div>
            ))}
            <button className="add" onClick={() => refFileRef.current?.click()}>+</button>
          </div>
          <button
            className="key teal block"
            disabled={!source || busy}
            style={{ opacity: !source || busy ? 0.45 : 1 }}
            onClick={onStylize}
          >
            {busy ? "◴ STYLIZING…" : "▶ STYLIZE"}
          </button>
          {error && <div className="note err">⚠ {error}</div>}
        </div>

        {/* FINISH (pixel lock) */}
        <div className="fgroup">
          <div className="ttl">PIXEL LOCK</div>
          <Toggle label="ENABLE" on={lockOn} onChange={setLockOn} />
          <div className="ctl">
            <div className="ctl__label"><span>DITHER</span></div>
            <Segmented
              value={type}
              options={[
                { value: "fs", label: "FS" },
                { value: "bayer2", label: "B2" },
                { value: "bayer4", label: "B4" },
                { value: "bayer8", label: "B8" },
              ]}
              onChange={setType}
            />
          </div>
          <Slider
            label="PIXEL HEIGHT"
            value={targetH}
            min={32}
            max={256}
            step={8}
            fmt={(v) => v + "px"}
            onChange={setTargetH}
          />
        </div>

        {/* EXPORT */}
        <div className="export">
          <button
            className="key cream block"
            disabled={!hasBase}
            style={{ opacity: hasBase ? 1 : 0.4 }}
            onClick={onExport}
          >
            ▼ EXPORT PNG
          </button>
        </div>

        <input
          ref={faceFileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFace(f);
            e.target.value = "";
          }}
        />
        <input
          ref={refFileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) addRefs(e.target.files);
            e.target.value = "";
          }}
        />
      </aside>

      {/* PREVIEW */}
      <div className="stage">
        <div className="stage__frame face">
          <video
            ref={videoRef}
            className="face__video"
            playsInline
            muted
            style={{ display: camOn ? "block" : "none" }}
          />
          {!camOn && hasBase && (
            <canvas ref={previewRef} className="face__preview" />
          )}
          {!camOn && !hasBase && (
            <div className="stage__empty">
              <div>
                <div className="glyph">☺</div>
                <div className="big">CAPTURE OR UPLOAD A FACE</div>
              </div>
            </div>
          )}
        </div>
        <div className="stage__hud" style={{ position: "absolute", left: 22, bottom: 14 }}>
          <span><b>STAGE</b> {result ? "AI + LOCK" : source ? "LOCK (no AI yet)" : "EMPTY"}</span>
          <span><b>REFS</b> {refs.length}</span>
        </div>
      </div>
    </div>
  );
}

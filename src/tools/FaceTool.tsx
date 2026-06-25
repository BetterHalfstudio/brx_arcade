import { useEffect, useRef, useState } from "react";
import { Slider } from "../panel/controls";
import { stylize, downscaleToBase64, type InlineImage } from "../face/api";
import { facePixelArt, upscale } from "../face/finisher";
import { downloadBlob, stampName } from "../export/download";
import { faceVersion } from "../face/versions";

// Fixed: sprite height, dither pattern, and the two output colours.
// Only levels + threshold are adjustable. Prompt / style-ref / background mode
// come from the selected version.
const FACE_TARGET_H = 144; // px — fixed (no control)
const FACE_TYPE = "bayer2" as const; // B2 — fixed (no control)
const FACE_DARK = "#000000";
const FACE_LIT = "#ff3d00";

type Source = HTMLImageElement | HTMLCanvasElement;

export function FaceTool({ version }: { version: number }) {
  const cfg = faceVersion(version);

  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<HTMLImageElement | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [prompt, setPrompt] = useState(cfg.prompt);
  const [promptOpen, setPromptOpen] = useState(false);
  const [styleRef, setStyleRef] = useState<InlineImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // levels + threshold (PX size and dither pattern stay fixed)
  const [blackPoint, setBlackPoint] = useState(0);
  const [whitePoint, setWhitePoint] = useState(255);
  const [gamma, setGamma] = useState(1);
  const [threshold, setThreshold] = useState(128);
  const faceOpts = {
    targetH: FACE_TARGET_H,
    type: FACE_TYPE,
    blackPoint,
    whitePoint,
    gamma,
    threshold,
    dark: FACE_DARK,
    lit: FACE_LIT,
    bg: cfg.bg,
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const faceFileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  // progressive gating
  const step2Locked = !source;
  const step3Locked = !result;
  const hasBase = !!(source || result);

  // load the version's style reference (reloads when version changes)
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setStyleRef(downscaleToBase64(img, 768, "image/png", 1));
    };
    img.onerror = () => {};
    img.src = cfg.styleRef;
    return () => {
      cancelled = true;
    };
  }, [cfg.styleRef]);

  // switching version loads that version's default prompt
  useEffect(() => {
    setPrompt(cfg.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // auto-grow the prompt textarea to fit its content (no scrolling)
  useEffect(() => {
    const ta = taRef.current;
    if (promptOpen && ta) {
      ta.style.height = "auto";
      const borderY = ta.offsetHeight - ta.clientHeight;
      ta.style.height = ta.scrollHeight + borderY + "px";
    }
  }, [promptOpen, prompt]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // Delete / Backspace clears the current face (ignored while typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      e.preventDefault();
      setSource(null);
      setResult(null);
      stopCam();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function flashInputStep() {
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1400);
  }

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

  // --- upload ----------------------------------------------------------------
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

  // --- stylize ---------------------------------------------------------------
  async function onStylize() {
    if (!source || busy) return;
    setBusy(true);
    setError(null);
    try {
      const face = downscaleToBase64(source, 768, "image/jpeg", 0.92);
      const out = await stylize(face, prompt, styleRef ? [styleRef] : []);
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

  // --- live pixel-art preview ------------------------------------------------
  useEffect(() => {
    const base = result || source;
    const cv = previewRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    if (!base) {
      cv.width = cv.height = 0;
      return;
    }
    const sprite = facePixelArt(base, faceOpts);
    cv.width = sprite.width;
    cv.height = sprite.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(sprite, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, result, version, blackPoint, whitePoint, gamma, threshold]);

  function onExport() {
    const base = result || source;
    if (!base) return;
    const sprite = facePixelArt(base, faceOpts);
    const factor = Math.max(1, Math.round(512 / sprite.height));
    upscale(sprite, factor).toBlob((b) => b && downloadBlob(b, stampName()), "image/png");
  }

  return (
    <div className={"app" + (flash ? " attention" : "")}>
      <aside className="panel">
        {/* STEP 1 — INPUT */}
        <div className={"step" + (flash ? " step--flash" : "")}>
          <div className="step__head">
            <span className="step__num">1</span>
            <span className="step__title">INPUT · FACE</span>
          </div>
          <div className="row">
            {!camOn ? (
              <button className="key block" onClick={startCam}>◉ CAMERA</button>
            ) : (
              <button className="key hot block" onClick={capture}>◉ CAPTURE</button>
            )}
            <button className="key block" onClick={() => faceFileRef.current?.click()}>↑ UPLOAD</button>
          </div>
          {camOn && <button className="key sm ghost" onClick={stopCam}>✕ STOP CAMERA</button>}
        </div>

        {/* STEP 2 — CARICATURE */}
        <div className={"step" + (step2Locked ? " locked" : "")}>
          <div className="step__head clickable" onClick={() => setPromptOpen((o) => !o)}>
            <span className="step__num">2</span>
            <span className="step__title">CARICATURE · GEMINI</span>
            <span className="spacer" />
            <span className="chev">{promptOpen ? "▾" : "▸"}</span>
          </div>
          {promptOpen && (
            <textarea
              ref={taRef}
              className="prompt"
              value={prompt}
              spellCheck={false}
              onChange={(e) => setPrompt(e.target.value)}
            />
          )}
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

        {/* STEP 3 — LEVELS */}
        <div className={"step" + (step3Locked ? " locked" : "")}>
          <div className="step__head">
            <span className="step__num">3</span>
            <span className="step__title">LEVELS · 144PX</span>
          </div>
          <Slider label="BLACK PT" value={blackPoint} min={0} max={254}
            onChange={(v) => setBlackPoint(Math.min(v, whitePoint - 1))} />
          <Slider label="WHITE PT" value={whitePoint} min={1} max={255}
            onChange={(v) => setWhitePoint(Math.max(v, blackPoint + 1))} />
          <Slider label="GAMMA" value={gamma} min={0.1} max={3} step={0.01}
            fmt={(v) => v.toFixed(2)} onChange={setGamma} />
          <Slider label="THRESHOLD" value={threshold} min={0} max={255}
            onChange={setThreshold} />
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
      </aside>

      {/* PREVIEW (head cut out, shown on black) */}
      <div className="stage">
        <div className="stage__frame face">
          <video
            ref={videoRef}
            className="face__video"
            playsInline
            muted
            style={{ display: camOn ? "block" : "none" }}
          />
          {!camOn && hasBase && <canvas ref={previewRef} className="face__preview" />}
          {!camOn && !hasBase && (
            <button className="stage__empty stage__empty--btn" onClick={flashInputStep}>
              <div>
                <div className="glyph">☺</div>
                <div className="big">CAPTURE OR UPLOAD A FACE</div>
              </div>
            </button>
          )}
        </div>
        <div className="stage__hud" style={{ position: "absolute", left: 22, bottom: 14 }}>
          <span><b>STAGE</b> {result ? "AI + ART" : source ? "ART (no AI yet)" : "EMPTY"}</span>
          <span><b>VER</b> {cfg.label} · {cfg.bg.toUpperCase()} BG</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Slider } from "../panel/controls";
import { stylize, downscaleToBase64, type InlineImage } from "../face/api";
import { facePixelArt, upscale } from "../face/finisher";
import { downloadBlob, stampName } from "../export/download";

// Fixed: sprite height, dither pattern, and the two output colours.
// Only levels + threshold are adjustable.
const FACE_TARGET_H = 144; // px — fixed (no control)
const FACE_TYPE = "bayer2" as const; // B2 — fixed (no control)
const FACE_DARK = "#000000"; // "off" tone
const FACE_LIT = "#ff3d00"; // "on" tone
const STYLE_REF_URL = "/style-ref.webp"; // bundled, sent with every call

const DEFAULT_PROMPT =
  "Redraw this person as a caricature: slightly exaggerate their most " +
  "distinctive features while keeping them recognizable. Flat illustrated " +
  "style, clean cel shading, limited palette, head-and-shoulders, transparent " +
  "background, no text. Match the style of any reference images.";

type Source = HTMLImageElement | HTMLCanvasElement;

export function FaceTool() {
  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<HTMLImageElement | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [styleRef, setStyleRef] = useState<InlineImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const faceFileRef = useRef<HTMLInputElement>(null);

  // --- load the bundled style reference once ---------------------------------
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setStyleRef(downscaleToBase64(img, 768, "image/png", 1));
    };
    img.onerror = () => {}; // missing file -> no style ref, still works
    img.src = STYLE_REF_URL;
    return () => {
      cancelled = true;
    };
  }, []);

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

  // --- fixed pixel-art preview ----------------------------------------------
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
  }, [source, result, blackPoint, whitePoint, gamma, threshold]);

  function onExport() {
    const base = result || source;
    if (!base) return;
    const sprite = facePixelArt(base, faceOpts);
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
          {camOn && <button className="key sm ghost" onClick={stopCam}>✕ STOP CAMERA</button>}
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
          <button
            className="key teal block"
            disabled={!source || busy}
            style={{ opacity: !source || busy ? 0.45 : 1 }}
            onClick={onStylize}
          >
            {busy ? "◴ STYLIZING…" : "▶ STYLIZE"}
          </button>
          <div className="note">
            STYLE REF {styleRef ? "· LOADED" : "· NONE (add public/style-ref.webp)"}
            {" · "}144PX · 2-COLOR
          </div>
          {error && <div className="note err">⚠ {error}</div>}
        </div>

        {/* LEVELS + THRESHOLD (PX size + dither pattern fixed) */}
        <div className="fgroup">
          <div className="ttl">LEVELS · 144PX</div>
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
          <div className="note">TRANSPARENT · HEAD CUT OUT</div>
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
            <div className="stage__empty">
              <div>
                <div className="glyph">☺</div>
                <div className="big">CAPTURE OR UPLOAD A FACE</div>
              </div>
            </div>
          )}
        </div>
        <div className="stage__hud" style={{ position: "absolute", left: 22, bottom: 14 }}>
          <span><b>STAGE</b> {result ? "AI + ART" : source ? "ART (no AI yet)" : "EMPTY"}</span>
          <span><b>OUT</b> 144PX · BLACK + FF3D00</span>
        </div>
      </div>
    </div>
  );
}

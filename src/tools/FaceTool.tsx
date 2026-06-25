import { useEffect, useRef, useState } from "react";
import { Slider, Toggle, Segmented } from "../panel/controls";
import type { DitherType } from "../state/types";
import { stylize, downscaleToBase64, type InlineImage } from "../face/api";
import { facePixelArt, upscale } from "../face/finisher";
import { downloadBlob, stampName } from "../export/download";
import { faceVersion } from "../face/versions";

// Fixed: sprite height + the two output colours. Levels/threshold/dither and the
// refine tools (raw preview, style-ref swap) are temporary tuning aids.
const FACE_TARGET_H = 144;
const FACE_DARK = "#000000";
const FACE_LIT = "#ff3d00";

const DITHERS: { value: DitherType; label: string }[] = [
  { value: "fs", label: "FS" },
  { value: "bayer2", label: "B2" },
];

type Source = HTMLImageElement | HTMLCanvasElement;
interface RefOverride extends InlineImage {
  url: string;
}

export function FaceTool({ version }: { version: number }) {
  const cfg = faceVersion(version);

  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<HTMLImageElement | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [prompt, setPrompt] = useState(cfg.prompts[0].text);
  const [promptOpen, setPromptOpen] = useState(false);
  const [styleRef, setStyleRef] = useState<InlineImage | null>(null);
  const [styleRefOverride, setStyleRefOverride] = useState<RefOverride | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // tuning controls (temporary while refining v2)
  const [type, setType] = useState<DitherType>("bayer2");
  const [blackPoint, setBlackPoint] = useState(0);
  const [whitePoint, setWhitePoint] = useState(255);
  const [gamma, setGamma] = useState(1);
  const [threshold, setThreshold] = useState(128);
  const [showRaw, setShowRaw] = useState(false); // before/after the dither
  const faceOpts = {
    targetH: FACE_TARGET_H,
    type,
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
  const refFileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const step2Locked = !source;
  const step3Locked = !result;
  const hasBase = !!(source || result);

  // load the version's bundled style reference (reloads when version changes)
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

  // switching version loads that version's default prompt + clears any override
  useEffect(() => {
    setPrompt(cfg.prompts[0].text);
    setStyleRefOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // auto-grow the prompt textarea to fit its content (no scrolling). Two passes
  // (now + next frame) so it settles after layout/font reflow on preset swaps.
  useEffect(() => {
    const ta = taRef.current;
    if (!promptOpen || !ta) return;
    const fit = () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight) + "px";
    };
    fit();
    const raf = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(raf);
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

  // --- uploads ---------------------------------------------------------------
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
  function loadStyleRef(file: File) {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const inl = downscaleToBase64(img, 768, "image/png", 1);
      setStyleRefOverride({ ...inl, url });
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
      const ref = styleRefOverride || styleRef;
      const out = await stylize(
        face,
        prompt,
        ref ? [{ data: ref.data, mimeType: ref.mimeType }] : []
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

  // --- preview: dithered art, or raw Gemini output (before/after) ------------
  useEffect(() => {
    const base = result || source;
    const cv = previewRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    if (!base) {
      cv.width = cv.height = 0;
      return;
    }
    if (showRaw) {
      const bw = (base as HTMLImageElement).naturalWidth || (base as HTMLCanvasElement).width;
      const bh = (base as HTMLImageElement).naturalHeight || (base as HTMLCanvasElement).height;
      cv.width = bw;
      cv.height = bh;
      cv.style.imageRendering = "auto";
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, bw, bh);
      ctx.drawImage(base, 0, 0, bw, bh);
    } else {
      const sprite = facePixelArt(base, faceOpts);
      cv.width = sprite.width;
      cv.height = sprite.height;
      cv.style.imageRendering = "pixelated";
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(sprite, 0, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, result, version, showRaw, type, blackPoint, whitePoint, gamma, threshold]);

  function onExport() {
    const base = result || source;
    if (!base) return;
    const sprite = facePixelArt(base, faceOpts);
    const factor = Math.max(1, Math.round(512 / sprite.height));
    upscale(sprite, factor).toBlob((b) => b && downloadBlob(b, stampName()), "image/png");
  }

  const refThumb = styleRefOverride?.url || cfg.styleRef;

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
            <>
              {cfg.prompts.length > 1 && (
                <Segmented
                  value={prompt}
                  options={cfg.prompts.map((p) => ({ value: p.text, label: p.label }))}
                  onChange={(t) => setPrompt(t)}
                />
              )}
              <textarea
                ref={taRef}
                className="prompt"
                value={prompt}
                spellCheck={false}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="ctl__label">
                <span>STYLE REF</span>
                <span className="val">{styleRefOverride ? "SWAPPED" : "DEFAULT"}</span>
              </div>
              <div className="colorrow">
                <span className="swatch" style={{ background: `center/cover url(${refThumb})` }} />
                <button className="key sm grow" onClick={() => refFileRef.current?.click()}>↑ SWAP REF</button>
                {styleRefOverride && (
                  <button className="key sm ghost" onClick={() => setStyleRefOverride(null)}>RESET</button>
                )}
              </div>
            </>
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

        {/* STEP 3 — LEVELS + tuning (temporary) */}
        <div className={"step" + (step3Locked ? " locked" : "")}>
          <div className="step__head">
            <span className="step__num">3</span>
            <span className="step__title">LEVELS · 144PX</span>
          </div>
          <Toggle label="RAW PREVIEW (PRE-DITHER)" on={showRaw} onChange={setShowRaw} />
          <div className="ctl">
            <div className="ctl__label"><span>DITHER</span></div>
            <Segmented value={type} options={DITHERS} onChange={setType} />
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
        <input
          ref={refFileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadStyleRef(f);
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
          <span><b>STAGE</b> {showRaw ? "RAW (PRE-DITHER)" : result ? "AI + ART" : source ? "ART (no AI yet)" : "EMPTY"}</span>
          <span><b>VER</b> {cfg.label} · {cfg.bg.toUpperCase()} BG</span>
        </div>
      </div>
    </div>
  );
}

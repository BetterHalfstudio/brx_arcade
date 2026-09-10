import { useEffect, useRef, useState } from "react";
import { Slider, Toggle, Segmented } from "../panel/controls";
import { stylize, downscaleToBase64, type InlineImage, type StylizeDebug } from "../face/api";
import { facePixelArt, upscale } from "../face/finisher";
import { generateAvatar } from "../face/generate";
import { segmentPerson, applyCutout, type SegEngine, type SegMask } from "../face/segment";
import { downloadBlob, stampName } from "../export/download";
import { faceVersion } from "../face/versions";

// Fixed sprite/palette/dither + baked levels live in face/baked.ts (shared
// with the standalone avatar kiosk). Dev mode exposes the tuning sliders.
import {
  FACE_TARGET_H,
  FACE_TYPE,
  FACE_THRESHOLD,
  FACE_DARK,
  FACE_LIT,
  BAKED_LEVELS,
  BAKED_AUTOLIGHT,
} from "../face/baked";

const SEG_ENGINES: { value: SegEngine; label: string }[] = [
  { value: "mediapipe", label: "MEDIAPIPE" },
  { value: "u2net", label: "U2NET" },
];

type Source = HTMLImageElement | HTMLCanvasElement;

export function FaceTool({ version, dev = false }: { version: number; dev?: boolean }) {
  const cfg = faceVersion(version);
  const isFree = cfg.bg === "segment";
  const basePrompt = cfg.prompts[0]?.text ?? ""; // fixed per version (FREE has none)
  // dev mode can edit the prompt live; resets when the version changes
  const [promptText, setPromptText] = useState(basePrompt);
  useEffect(() => setPromptText(basePrompt), [basePrompt]);
  const prompt = promptText;

  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<Source | null>(null);
  /** set when the result came from the validated pipeline: alpha already cut,
   *  threshold possibly adapted per image */
  const [genInfo, setGenInfo] = useState<{ threshold: number } | null>(null);
  const [busyLabel, setBusyLabel] = useState("STYLIZING…");
  const [camOn, setCamOn] = useState(false);
  const [styleRef, setStyleRef] = useState<InlineImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<StylizeDebug | null>(null);
  const [flash, setFlash] = useState(false);

  // levels — BAKED defaults (dialled in by hand); only dev mode shows the UI
  const [blackPoint, setBlackPoint] = useState(BAKED_LEVELS.blackPoint);
  const [whitePoint, setWhitePoint] = useState(BAKED_LEVELS.whitePoint);
  const [gamma, setGamma] = useState(BAKED_LEVELS.gamma);

  // AUTO LIGHT — lighting normalization so different photos / Gemini renders
  // hit the dither with the same tonal distribution. Baked ON.
  const [autoLight, setAutoLight] = useState(true);
  const [alMid, setAlMid] = useState(BAKED_AUTOLIGHT.targetMid);
  const [alClipLo, setAlClipLo] = useState(BAKED_AUTOLIGHT.clipLo);
  const [alClipHi, setAlClipHi] = useState(BAKED_AUTOLIGHT.clipHi);
  const [alFlatten, setAlFlatten] = useState(BAKED_AUTOLIGHT.flatten);

  // FREE cutout — probability mask cached per (source, engine); the sliders
  // re-compose from the cache without re-running the model.
  // drag & drop upload (with a replace warning when something is on screen)
  const [dragOver, setDragOver] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<File | null>(null);

  const [segEngine, setSegEngine] = useState<SegEngine>("mediapipe");
  const [cut, setCut] = useState<HTMLCanvasElement | null>(null);
  const [segBusy, setSegBusy] = useState(false);
  const [segErr, setSegErr] = useState<string | null>(null);
  const segMask = useRef<SegMask | null>(null);
  const [maskThresh, setMaskThresh] = useState(0.5);
  const [maskFeather, setMaskFeather] = useState(0.08);
  const [maskEdge, setMaskEdge] = useState(0);

  const faceOpts = {
    targetH: FACE_TARGET_H,
    type: FACE_TYPE,
    blackPoint,
    whitePoint,
    gamma,
    threshold: genInfo?.threshold ?? FACE_THRESHOLD,
    dark: FACE_DARK,
    lit: FACE_LIT,
    // pipeline results and FREE cutouts already carry their alpha
    bg: (isFree || genInfo ? "none" : cfg.bg) as "flood" | "chroma" | "none",
    autoLight: autoLight
      ? { targetMid: alMid, clipLo: alClipLo, clipHi: alClipHi, flatten: alFlatten }
      : null,
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const faceFileRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const step2Locked = !source;
  const step3Locked = isFree ? !source : !result;
  const hasBase = !!(source || result);

  // load the version's bundled style reference (reloads when version changes)
  useEffect(() => {
    if (!cfg.styleRef) {
      setStyleRef(null);
      return;
    }
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
      setGenInfo(null);
      setCut(null);
      segMask.current = null;
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
    setGenInfo(null);
    setCut(null);
    segMask.current = null;
    setSource(c);
    stopCam();
  }
  useEffect(() => () => stopCam(), []);

  // --- drag & drop -----------------------------------------------------------
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (hasBase) setPendingDrop(file); // something is on screen → confirm first
    else {
      stopCam();
      loadFace(file);
    }
  }

  // --- upload ----------------------------------------------------------------
  function loadFace(file: File) {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setResult(null);
      setGenInfo(null);
      setCut(null);
      segMask.current = null;
      setSource(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // --- FREE cutout: segment once per (source, engine) ------------------------
  useEffect(() => {
    if (!isFree || !source) return;
    let gone = false;
    setSegBusy(true);
    setSegErr(null);
    segMask.current = null;
    segmentPerson(source, segEngine)
      .then((mask) => {
        if (gone) return;
        segMask.current = mask;
        setCut(applyCutout(source, mask, { threshold: maskThresh, feather: maskFeather, edge: maskEdge }));
      })
      .catch((e) => {
        if (!gone) setSegErr(e?.message || "segmentation failed");
      })
      .finally(() => {
        if (!gone) setSegBusy(false);
      });
    return () => {
      gone = true;
    };
    // mask params intentionally excluded — they re-compose from the cache below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFree, source, segEngine]);

  // cheap re-composition when the mask sliders move (no model re-run)
  useEffect(() => {
    if (!isFree || !source || !segMask.current) return;
    setCut(
      applyCutout(source, segMask.current, {
        threshold: maskThresh,
        feather: maskFeather,
        edge: maskEdge,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskThresh, maskFeather, maskEdge]);

  // --- stylize (Gemini versions only) ----------------------------------------
  // V2 goes through the validated pipeline (cutout fallback, tone rescue,
  // framing re-rolls). V1 keeps the raw single-shot path.
  async function onStylize() {
    if (!source || busy) return;
    setBusy(true);
    setBusyLabel("STYLIZING…");
    setError(null);
    try {
      if (cfg.bg === "chroma") {
        const res = await generateAvatar({
          source,
          prompt,
          styleRef,
          // always adapt from the BAKED threshold, not a previous adaptation
          baked: { ...faceOpts, threshold: FACE_THRESHOLD },
          maxAttempts: 3,
          onStatus: setBusyLabel,
        });
        if (res.debug) {
          console.log("[stylize] exact request sent to Gemini:", res.debug);
          setSent(res.debug);
        }
        setResult(res.cut);
        setGenInfo({ threshold: res.threshold });
      } else {
        const face = downscaleToBase64(source, 768, "image/jpeg", 0.92);
        const out = await stylize(
          face,
          prompt,
          styleRef ? [{ data: styleRef.data, mimeType: styleRef.mimeType }] : []
        );
        if (out.debug) {
          console.log("[stylize] exact request sent to Gemini:", out.debug);
          setSent(out.debug);
        }
        const img = await new Promise<HTMLImageElement>((res2, rej) => {
          const im = new Image();
          im.onload = () => res2(im);
          im.onerror = () => rej(new Error("could not decode model output"));
          im.src = `data:${out.mimeType};base64,${out.image}`;
        });
        setResult(img);
        setGenInfo(null);
      }
    } catch (e: any) {
      setError(e?.message || "stylize failed");
    } finally {
      setBusy(false);
    }
  }

  // the image the finisher works on, per mode
  const base: Source | null = isFree ? (cut ?? source) : (result || source);

  // --- pixel-art preview -----------------------------------------------------
  useEffect(() => {
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
  }, [
    source, result, cut, genInfo, version,
    blackPoint, whitePoint, gamma,
    autoLight, alMid, alClipLo, alClipHi, alFlatten,
  ]);

  // an adapted threshold belongs to the version that produced it
  useEffect(() => setGenInfo(null), [version]);

  function onExport() {
    if (!base) return;
    const sprite = facePixelArt(base, faceOpts);
    const factor = Math.max(1, Math.round(512 / sprite.height));
    upscale(sprite, factor).toBlob((b) => b && downloadBlob(b, stampName()), "image/png");
  }

  const sentImgs = sent
    ? (sent.sent.filter((p) => p.kind === "image") as {
        kind: "image";
        mimeType: string;
        approxKB: number;
      }[])
    : [];

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

        {/* STEP 2 — CARICATURE (Gemini) or CUTOUT (FREE) */}
        <div className={"step" + (step2Locked ? " locked" : "")}>
          <div className="step__head">
            <span className="step__num">2</span>
            <span className="step__title">{isFree ? "CUTOUT · FREE" : "CARICATURE · GEMINI"}</span>
          </div>
          {isFree ? (
            <>
              <div className="ctl">
                <div className="ctl__label"><span>ENGINE</span></div>
                <Segmented value={segEngine} options={SEG_ENGINES} onChange={setSegEngine} />
              </div>
              <Slider label="MASK" value={maskThresh} min={0.05} max={0.95} step={0.01}
                fmt={(v) => v.toFixed(2)} onChange={setMaskThresh} />
              <Slider label="FEATHER" value={maskFeather} min={0} max={0.3} step={0.01}
                fmt={(v) => v.toFixed(2)} onChange={setMaskFeather} />
              <Slider label="EDGE" value={maskEdge} min={-0.2} max={0.2} step={0.01}
                fmt={(v) => (v > 0 ? "+" : "") + v.toFixed(2)} onChange={setMaskEdge} />
              {segBusy && <div className="note">◴ SEGMENTING… (FIRST RUN DOWNLOADS THE MODEL)</div>}
              {segErr && <div className="note err">⚠ {segErr}</div>}
              {!segBusy && !segErr && cut && (
                <div className="note">✓ CUT OUT · {segEngine === "u2net" ? "U2NET" : "MEDIAPIPE"} · $0</div>
              )}
            </>
          ) : (
            <>
              {dev && (
                <>
                  {/* DEV: the exact prompt sent to Gemini — editable live */}
                  <div className="ctl__label"><span>PROMPT (DEV)</span></div>
                  <textarea
                    className="prompt devprompt"
                    value={promptText}
                    spellCheck={false}
                    onChange={(e) => setPromptText(e.target.value)}
                  />
                  {/* DEV: the style reference image actually being sent */}
                  <div className="devref">
                    <img src={cfg.styleRef} alt="style reference" />
                    <div className="note">
                      STYLE REF SENT WITH EVERY STYLIZE
                      {styleRef ? ` · ${Math.round((styleRef.data.length * 3) / 4 / 1024)}KB` : " · LOADING…"}
                    </div>
                  </div>
                </>
              )}
              <button
                className="key teal block"
                disabled={!source || busy}
                style={{ opacity: !source || busy ? 0.45 : 1 }}
                onClick={onStylize}
              >
                {busy ? `◴ ${busyLabel}` : "▶ STYLIZE"}
              </button>
              {sent && (
                <div className="note">
                  ✓ GEMINI GOT {sentImgs.length} IMAGES
                  {sentImgs[1] ? ` · STYLE REF ${sentImgs[1].approxKB}KB` : ""}
                  {sent.usage?.promptTokenCount ? ` · ${sent.usage.promptTokenCount} INPUT TOKENS` : ""}
                </div>
              )}
              {error && <div className="note err">⚠ {error}</div>}
            </>
          )}
        </div>

        {/* STEP 3 — LIGHT + LEVELS (baked values; the UI is dev-mode only) */}
        {dev && (
          <div className={"step" + (step3Locked ? " locked" : "")}>
            <div className="step__head">
              <span className="step__num">3</span>
              <span className="step__title">LEVELS · DEV</span>
            </div>
            <Toggle label="AUTO LIGHT" on={autoLight} hot onChange={setAutoLight} />
            {autoLight && (
              <>
                <Slider label="TARGET MID" value={alMid} min={0.25} max={0.75} step={0.01}
                  fmt={(v) => v.toFixed(2)} onChange={setAlMid} />
                <Slider label="CLIP LO" value={alClipLo} min={0} max={10} step={0.5}
                  fmt={(v) => v.toFixed(1) + "%"} onChange={setAlClipLo} />
                <Slider label="CLIP HI" value={alClipHi} min={90} max={100} step={0.5}
                  fmt={(v) => v.toFixed(1) + "%"} onChange={setAlClipHi} />
                <Slider label="FLATTEN" value={alFlatten} min={0} max={1} step={0.01}
                  fmt={(v) => v.toFixed(2)} onChange={setAlFlatten} />
              </>
            )}
            <Slider label="BLACK PT" value={blackPoint} min={0} max={254}
              onChange={(v) => setBlackPoint(Math.min(v, whitePoint - 1))} />
            <Slider label="WHITE PT" value={whitePoint} min={1} max={255}
              onChange={(v) => setWhitePoint(Math.max(v, blackPoint + 1))} />
            <Slider label="GAMMA" value={gamma} min={0.1} max={3} step={0.01}
              fmt={(v) => v.toFixed(2)} onChange={setGamma} />
          </div>
        )}

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

      {/* PREVIEW */}
      <div
        className={"stage" + (dragOver ? " dragover" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
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

          <div className={"stage__drop" + (hasBase ? " replace" : "")}>
            <div>
              <div className="big">{hasBase ? "RELEASE TO REPLACE" : "RELEASE TO LOAD"}</div>
              <div className="sub">
                {hasBase ? "⚠ OVERWRITES THE CURRENT FACE" : "PNG / JPG → FACE"}
              </div>
            </div>
          </div>
        </div>
        <div className="stage__hud" style={{ position: "absolute", left: 22, bottom: 14 }}>
          <span>
            <b>STAGE</b>{" "}
            {isFree
              ? cut ? "FREE · CUT + ART" : source ? "FREE (no cutout yet)" : "EMPTY"
              : result ? "AI + ART" : source ? "ART (no AI yet)" : "EMPTY"}
          </span>
          <span><b>VER</b> {cfg.label}{isFree ? " · $0" : ` · ${cfg.bg.toUpperCase()} BG`}</span>
        </div>
      </div>

      {pendingDrop && (
        <div className="modal" onClick={() => setPendingDrop(null)}>
          <div className="modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="modal__title">⚠ REPLACE IMAGE</div>
            <div className="modal__body">
              THIS WILL OVERWRITE YOUR CURRENT {result ? "AVATAR" : "PHOTO"}. THIS CANNOT BE
              UNDONE.
            </div>
            <div className="modal__actions">
              <button className="key ghost" onClick={() => setPendingDrop(null)}>
                CANCEL
              </button>
              <button
                className="key hot"
                onClick={() => {
                  stopCam();
                  loadFace(pendingDrop);
                  setPendingDrop(null);
                }}
              >
                REPLACE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

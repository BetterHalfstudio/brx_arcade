import { useEffect, useRef, useState } from "react";
import { downscaleToBase64, type InlineImage } from "../face/api";
import { facePixelArt, upscale } from "../face/finisher";
import { generateAvatar, type GenResult } from "../face/generate";
import { faceVersion } from "../face/versions";
import { downloadBlob, stampName } from "../export/download";
import {
  FACE_TARGET_H,
  FACE_TYPE,
  FACE_THRESHOLD,
  FACE_DARK,
  FACE_LIT,
  BAKED_LEVELS,
  BAKED_AUTOLIGHT,
} from "../face/baked";

// STANDALONE AVATAR KIOSK (served at /avatar, no links from the main site).
// V2 pipeline only, everything baked, zero tuning UI. Flow:
//   gate (password, remembered per device) → start (camera + small upload)
//   → camera (capture) → review (the raw photo + GENERATE AVATAR)
//   → result (the dithered avatar; EXPORT replaces GENERATE).
// Built mobile-first: one column, big touch targets.

const V2 = faceVersion(2);
const PASS_KEY = "brx:avatar:ok";
const PASS_FALLBACK = "Hyperagent"; // used when the api route is unreachable (dev)

const BAKED = {
  targetH: FACE_TARGET_H,
  type: FACE_TYPE,
  threshold: FACE_THRESHOLD,
  dark: FACE_DARK,
  lit: FACE_LIT,
  bg: "chroma" as const, // V2's background strategy
  autoLight: BAKED_AUTOLIGHT,
  ...BAKED_LEVELS,
};

type Stage = "gate" | "start" | "camera" | "review" | "result";
type Source = HTMLImageElement | HTMLCanvasElement;

function unlocked(): boolean {
  try {
    return localStorage.getItem(PASS_KEY) === "1";
  } catch {
    return false;
  }
}

export function AvatarApp() {
  const [stage, setStage] = useState<Stage>(unlocked() ? "start" : "gate");
  const [pass, setPass] = useState("");
  const [gateErr, setGateErr] = useState(false);
  const [checking, setChecking] = useState(false);

  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<GenResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("GENERATING…");
  const [error, setError] = useState<string | null>(null);
  const [styleRef, setStyleRef] = useState<InlineImage | null>(null);

  // drag & drop upload (with a replace warning when something is on screen)
  const [dragOver, setDragOver] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<File | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const photoRef = useRef<HTMLCanvasElement>(null);
  const spriteRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- password gate ---------------------------------------------------------
  async function tryUnlock() {
    if (checking || !pass) return;
    setChecking(true);
    setGateErr(false);
    let ok = false;
    try {
      const r = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass }),
      });
      if ((r.headers.get("content-type") || "").includes("json")) {
        ok = Boolean((await r.json())?.ok);
      } else {
        ok = pass === PASS_FALLBACK; // local dev: no serverless runtime
      }
    } catch {
      ok = pass === PASS_FALLBACK;
    }
    setChecking(false);
    if (!ok) {
      setGateErr(true);
      return;
    }
    try {
      localStorage.setItem(PASS_KEY, "1");
    } catch {
      /* private mode — unlocked for this visit only */
    }
    setStage("start");
  }

  // --- style reference (always V2's) -----------------------------------------
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setStyleRef(downscaleToBase64(img, 768, "image/png", 1));
    };
    img.onerror = () => {};
    img.src = V2.styleRef;
    return () => {
      cancelled = true;
    };
  }, []);

  // --- camera ----------------------------------------------------------------
  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => () => stopCam(), []);

  async function startCam() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 1280, height: 960 },
        audio: false,
      });
      streamRef.current = stream;
      setStage("camera"); // the effect below attaches the stream once mounted
    } catch (e: any) {
      setError(e?.message || "camera unavailable");
    }
  }

  // Attach the stream AFTER the <video> exists, and (re)play on metadata —
  // Safari shows a black window if srcObject/play race the mount.
  useEffect(() => {
    if (stage !== "camera") return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    v.srcObject = s;
    const go = () => v.play().catch(() => {});
    go();
    v.addEventListener("loadedmetadata", go);
    return () => v.removeEventListener("loadedmetadata", go);
  }, [stage]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    stopCam();
    setResult(null);
    setSource(c);
    setStage("review");
  }

  function loadFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setResult(null);
      setSource(img);
      setStage("review");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (stage === "gate" || busy) return;
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (stage === "review" || stage === "result") {
      setPendingDrop(file); // a photo/avatar is on screen → confirm first
    } else {
      stopCam();
      loadFile(file);
    }
  }

  function goBack() {
    setError(null);
    if (stage === "camera") {
      stopCam();
      setStage("start");
    } else if (stage === "review") {
      setSource(null);
      setStage("start");
    } else if (stage === "result") {
      setResult(null);
      setStage("review"); // keep the photo — GENERATE again re-rolls
    }
  }

  // --- generate (validated: cutout fallback, tone rescue, framing re-rolls) --
  async function onGenerate() {
    if (!source || busy) return;
    setBusy(true);
    setBusyLabel("GENERATING…");
    setError(null);
    try {
      const res = await generateAvatar({
        source,
        prompt: V2.prompts[0].text,
        styleRef,
        baked: BAKED,
        maxAttempts: 3,
        onStatus: setBusyLabel,
      });
      setResult(res);
      setStage("result");
    } catch (e: any) {
      setError(e?.message || "generation failed — try again");
    } finally {
      setBusy(false);
    }
  }

  // --- draw the raw photo (review) and the dithered avatar (result) ----------
  useEffect(() => {
    if (stage !== "review" || !source || !photoRef.current) return;
    const cv = photoRef.current;
    const sw = (source as HTMLCanvasElement).width || (source as HTMLImageElement).naturalWidth;
    const sh = (source as HTMLCanvasElement).height || (source as HTMLImageElement).naturalHeight;
    cv.width = sw;
    cv.height = sh;
    cv.getContext("2d")!.drawImage(source, 0, 0);
  }, [stage, source]);

  const finish = (r: GenResult) =>
    facePixelArt(r.cut, { ...BAKED, bg: "none", threshold: r.threshold });

  useEffect(() => {
    if (stage !== "result" || !result || !spriteRef.current) return;
    const sprite = finish(result);
    const cv = spriteRef.current;
    cv.width = sprite.width;
    cv.height = sprite.height;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, result]);

  function onExport() {
    if (!result) return;
    const sprite = finish(result);
    const factor = Math.max(1, Math.round(512 / sprite.height));
    upscale(sprite, factor).toBlob((b) => b && downloadBlob(b, stampName()), "image/png");
  }

  // ---------------------------------------------------------------------------
  return (
    <div
      className={"kiosk" + (dragOver ? " dragover" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        if (stage !== "gate") setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="kiosk__brand">
        <span className="br">BRX</span>_AVATAR
      </div>

      {stage === "gate" && (
        <div className="kiosk__gate">
          <div className="kiosk__gatecard">
            <div className="ttl">ENTER PASSWORD</div>
            <input
              type="password"
              value={pass}
              autoFocus
              onChange={(e) => {
                setPass(e.target.value);
                setGateErr(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            />
            <button className="key cream block" onClick={tryUnlock} disabled={checking}>
              {checking ? "◴ CHECKING…" : "▶ ENTER"}
            </button>
            {gateErr && <div className="note err">⚠ WRONG PASSWORD</div>}
          </div>
        </div>
      )}

      {stage !== "gate" && (
        <>
          <div className="kiosk__stagearea">
            {stage === "start" && (
              <div className="kiosk__hint">
                <div className="glyph">☺</div>
                <div className="big">TAKE A PHOTO TO GET YOUR AVATAR</div>
              </div>
            )}
            {stage === "camera" && (
              <video ref={videoRef} className="kiosk__video" playsInline muted autoPlay />
            )}
            {stage === "review" && <canvas ref={photoRef} className="kiosk__photo" />}
            {stage === "result" && <canvas ref={spriteRef} className="kiosk__sprite" />}

            <div
              className={
                "kiosk__drop" + (stage === "review" || stage === "result" ? " replace" : "")
              }
            >
              <div>
                <div className="big">
                  {stage === "review" || stage === "result"
                    ? "RELEASE TO REPLACE"
                    : "RELEASE TO LOAD"}
                </div>
                <div className="sub">
                  {stage === "result"
                    ? "⚠ OVERWRITES YOUR AVATAR"
                    : stage === "review"
                      ? "⚠ OVERWRITES YOUR PHOTO"
                      : "PNG / JPG → PHOTO"}
                </div>
              </div>
            </div>
          </div>

          {error && <div className="note err kiosk__err">⚠ {error.toUpperCase()}</div>}

          <div className="kiosk__actions">
            {stage === "start" && (
              <>
                <button className="key cream kiosk__main" onClick={startCam}>
                  ◉ CAMERA
                </button>
                <button
                  className="key kiosk__side"
                  onClick={() => fileRef.current?.click()}
                  title="upload a photo"
                >
                  ↑
                </button>
              </>
            )}
            {stage === "camera" && (
              <>
                <button className="key kiosk__side" onClick={goBack}>←</button>
                <button className="key hot kiosk__main" onClick={capture}>
                  ◉ CAPTURE
                </button>
              </>
            )}
            {stage === "review" && (
              <>
                <button className="key kiosk__side" onClick={goBack} disabled={busy}>←</button>
                <button
                  className="key teal kiosk__main"
                  onClick={onGenerate}
                  disabled={busy || !styleRef}
                >
                  {busy ? `◴ ${busyLabel}` : "★ GENERATE AVATAR"}
                </button>
              </>
            )}
            {stage === "result" && (
              <>
                <button className="key kiosk__side" onClick={goBack}>←</button>
                <button className="key cream kiosk__main" onClick={onExport}>
                  ▼ EXPORT PNG
                </button>
              </>
            )}
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = "";
        }}
      />

      {pendingDrop && (
        <div className="modal" onClick={() => setPendingDrop(null)}>
          <div className="modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="modal__title">⚠ REPLACE {stage === "result" ? "AVATAR" : "PHOTO"}</div>
            <div className="modal__body">
              THIS WILL OVERWRITE YOUR CURRENT {stage === "result" ? "AVATAR" : "PHOTO"}. THIS
              CANNOT BE UNDONE.
            </div>
            <div className="modal__actions">
              <button className="key ghost" onClick={() => setPendingDrop(null)}>
                CANCEL
              </button>
              <button
                className="key hot"
                onClick={() => {
                  loadFile(pendingDrop);
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

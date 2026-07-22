import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "../state/store";
import type { DitherType, GradientStop } from "../state/types";
import { STOPS_MAX, PIXEL_LOCK_COLORS_MIN, PIXEL_LOCK_COLORS_MAX } from "../state/types";
import { DEFAULT_PALETTES, paletteToStops } from "../state/defaults";
import { ditherGradient } from "../pipeline/dither";
import { isValidHex, hexToRgb } from "../util/color";
import { Section, Slider, Toggle, Segmented } from "./controls";

// Left panel. Title → Add Image → three collapsible dropdowns (all collapsed
// on load) → muted roadmap → export pinned at the bottom.

const DITHERS: { value: DitherType; label: string }[] = [
  { value: "fs", label: "FS" },
  { value: "bayer2", label: "B2" },
];

const PIXEL_SIZES: { value: string; label: string }[] = [
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "4", label: "4×" },
  { value: "8", label: "8×" },
];

export function Panel({
  store,
  onExport,
  onAddImage,
  onRedetect,
}: {
  store: StoreApi;
  onExport: () => void;
  onAddImage: () => void;
  /** re-run pixel-grid auto-detection on the current image */
  onRedetect: () => void;
}) {
  const { state, setDither, setColor, setCRT, patch } = store;
  const [open, setOpen] = useState({
    dither: false,
    color: false,
    crt: false,
    roadmap: false,
  });
  // nested Pixel-Lock settings dropdown (open by default when the mode is on)
  const [plOpen, setPlOpen] = useState(true);
  const toggle = (k: keyof typeof open) =>
    setOpen((o) => ({ ...o, [k]: !o[k] }));

  const d = state.dither;
  const c = state.color;
  const crt = state.crt;

  // pure black & white only when no recolor is active
  const bwMode = !c.originalColors && !c.gradientMapOn;

  // ---- pixel-lock derived readout (native grid the current cell resolves to) --
  const plCell = Math.max(1, Math.round(d.pixelLockSize));
  const plGridW = state.layer.naturalW ? Math.max(1, Math.round(state.layer.naturalW / plCell)) : 0;
  const plGridH = state.layer.naturalH ? Math.max(1, Math.round(state.layer.naturalH / plCell)) : 0;
  const plIsAuto = plCell === Math.round(d.pixelLockAuto);

  const setOriginal = (v: boolean) => setColor({ originalColors: v });
  const setGradientOn = (v: boolean) => setColor({ gradientMapOn: v });

  // ---- gradient map: the single recolor system ----------------------------
  // Presets are just loaders — they drop a palette in as evenly spaced stops
  // and everything stays editable from there (no default/custom modes).
  const stops = c.gradientStops;
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const setStop = (i: number, p: Partial<GradientStop>) =>
    setColor({ gradientStops: stops.map((st, j) => (j === i ? { ...st, ...p } : st)) });
  const addStop = () =>
    stops.length < STOPS_MAX &&
    setColor({ gradientStops: [...stops, { pos: 1, color: "#ffffff" }] });
  const removeStop = (i: number) =>
    stops.length > 2 && setColor({ gradientStops: stops.filter((_, j) => j !== i) });
  const loadPreset = (i: number) =>
    setColor({ gradientMapOn: true, gradientStops: paletteToStops(DEFAULT_PALETTES[i]) });


  return (
    <aside className="panel">
      <div className="toolbar">
        <button className="key cream block" onClick={onAddImage}>
          ＋ ADD IMAGE
        </button>
      </div>

      {/* 1 — PIXELIZE / DITHER ------------------------------------------------ */}
      <Section
        index="01"
        title="PIXELIZE / DITHER"
        open={open.dither}
        onToggle={() => toggle("dither")}
        pip={d.pixelLock ? "hot" : "off"}
      >
        <Toggle
          label="PIXEL-LOCK"
          on={d.pixelLock}
          hot
          onChange={(v) => setDither({ pixelLock: v })}
        />

        {d.pixelLock ? (
          /* Snap AI pixel-art to its native grid instead of dithering. The
             AI-pixel-art controls live in their own dropdown to stay tidy. */
          <div className={"subsec" + (plOpen ? " open" : "")}>
            <div
              className="subsec__head"
              role="button"
              tabIndex={0}
              onClick={() => setPlOpen((o) => !o)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPlOpen((o) => !o);
                }
              }}
            >
              <span className="chev">{plOpen ? "▾" : "▸"}</span>
              <span>PIXEL-LOCK · AI ART</span>
              <span className="spacer" />
              <span className="val">{plGridW ? `${plGridW}×${plGridH}` : "—"}</span>
            </div>
            {plOpen && (
              <div className="subsec__body">
                <div className="ctl">
                  <div className="ctl__label">
                    <span>PIXEL SIZE</span>
                    <span className="val">{plCell}px</span>
                  </div>
                  <input
                    type="range"
                    className="hot"
                    min={1}
                    max={64}
                    step={1}
                    value={plCell}
                    onChange={(e) => setDither({ pixelLockSize: Number(e.target.value) })}
                  />
                </div>
                <Slider
                  label="COLORS"
                  value={d.pixelLockColors}
                  min={PIXEL_LOCK_COLORS_MIN}
                  max={PIXEL_LOCK_COLORS_MAX}
                  hot
                  onChange={(v) => setDither({ pixelLockColors: v })}
                />
                <div className="row">
                  <button className="key sm ghost" onClick={onRedetect} disabled={!state.layer.image}>
                    ◎ RE-DETECT
                  </button>
                  <div className="note" style={{ margin: 0, flex: 1, textAlign: "right" }}>
                    {plGridW ? (
                      <>
                        GRID {plGridW}×{plGridH} · {plIsAuto ? "AUTO ✓" : "MANUAL"}
                      </>
                    ) : (
                      "NO IMAGE"
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="ctl">
              <div className="ctl__label">
                <span>DITHER</span>
              </div>
              <Segmented value={d.type} options={DITHERS} onChange={(t) => setDither({ type: t })} />
            </div>
            <div className="ctl">
              <div className="ctl__label">
                <span>PIXEL SIZE</span>
                <span className="val">{d.pixelSize}×</span>
              </div>
              <Segmented
                value={String(d.pixelSize)}
                options={PIXEL_SIZES}
                onChange={(v) => setDither({ pixelSize: Number(v) })}
              />
            </div>
          </>
        )}
        <Slider
          label="BLACK PT"
          value={d.blackPoint}
          min={0}
          max={254}
          onChange={(v) => setDither({ blackPoint: Math.min(v, d.whitePoint - 1) })}
        />
        <Slider
          label="WHITE PT"
          value={d.whitePoint}
          min={1}
          max={255}
          onChange={(v) => setDither({ whitePoint: Math.max(v, d.blackPoint + 1) })}
        />
        <Slider
          label="GAMMA"
          value={d.gamma}
          min={0.1}
          max={3}
          step={0.01}
          fmt={(v) => v.toFixed(2)}
          onChange={(v) => setDither({ gamma: v })}
        />
        {!d.pixelLock && (
          <Slider
            label="THRESHOLD"
            value={d.threshold}
            min={0}
            max={255}
            disabled={!bwMode}
            onChange={(v) => setDither({ threshold: v })}
          />
        )}
      </Section>

      {/* 2 — COLOR ----------------------------------------------------------- */}
      <Section
        index="02"
        title="COLOR"
        open={open.color}
        onToggle={() => toggle("color")}
        pip={c.gradientMapOn ? "hot" : "off"}
      >
        <Toggle
          label="ORIGINAL COLORS"
          on={c.originalColors}
          onChange={setOriginal}
          disabled={c.gradientMapOn}
        />

        <Toggle label="GRADIENT MAP" on={c.gradientMapOn} hot onChange={setGradientOn} />

        {/* Presets load straight into the stops below — pick one, then edit. */}
        <div className="ctl">
          <div className="ctl__label"><span>PRESETS</span></div>
          <div className="palrow">
            {DEFAULT_PALETTES.map((p, i) => (
              <button
                key={i}
                className="palbtn"
                onClick={() => loadPreset(i)}
                title={`load palette 0${i + 1} into the gradient`}
              >
                <span className="sw">
                  {p.slice(0, 4).map((col, j) => (
                    <i key={j} style={{ background: col }} />
                  ))}
                </span>
                <span className="lbl">0{i + 1}</span>
              </button>
            ))}
          </div>
        </div>

        {c.gradientMapOn && (
          <div className="gstops">
            <GradientPreview stops={sorted} hard={c.hardStops} type={d.type} />

            <Toggle
              label="HARD STOPS"
              on={c.hardStops}
              onChange={(v) => setColor({ hardStops: v })}
            />

            <div className="ctl__label">
              <span>STOPS</span>
              <span className="val">{stops.length}/{STOPS_MAX}</span>
            </div>
            {stops.map((s, i) => (
              <div className="gstop" key={i}>
                <label className="swatch" style={{ background: s.color }}>
                  <input type="color" value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} />
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={s.pos}
                  onChange={(e) => setStop(i, { pos: parseFloat(e.target.value) })}
                />
                <span className="gpos">{Math.round(s.pos * 100)}%</span>
                <button className="key sm ghost" onClick={() => removeStop(i)} disabled={stops.length <= 2}>
                  ×
                </button>
              </div>
            ))}
            {stops.length < STOPS_MAX && (
              <button className="key sm ghost" onClick={addStop}>
                + STOP
              </button>
            )}
          </div>
        )}

        <div className="ctl">
          <div className="ctl__label">
            <span>BACKGROUND</span>
          </div>
          <div className="colorrow">
            <label className="swatch" style={{ background: c.background }}>
              <input type="color" value={c.background} onChange={(e) => setColor({ background: e.target.value })} />
            </label>
            <input
              className="hex"
              value={c.background}
              onChange={(e) => {
                const v = e.target.value;
                if (isValidHex(v)) setColor({ background: v.startsWith("#") ? v : "#" + v });
              }}
            />
            <button
              className={"key sm" + (state.eyedropper ? " teal" : "")}
              onClick={() => patch({ eyedropper: !state.eyedropper })}
              title="pick from canvas"
            >
              ⊹
            </button>
          </div>
          {state.eyedropper && (
            <div className="note" style={{ padding: 0 }}>
              CLICK INSIDE THE CANVAS TO PICK
            </div>
          )}
        </div>
      </Section>

      {/* 3 — CRT (toggle lives in the header, visible while collapsed) -------- */}
      <Section
        index="03"
        title="CRT"
        open={open.crt}
        onToggle={() => toggle("crt")}
        headerToggle={{ on: crt.on, onChange: (v) => setCRT({ on: v }), hot: true }}
      >
        <Slider label="BARREL" value={crt.barrel} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ barrel: v })} />
        <Slider label="SCANLINE" value={crt.scanline} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ scanline: v })} />
        <Slider label="GLOW" value={crt.glow} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ glow: v })} />
        <Slider label="ABERRATION" value={crt.aberration} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ aberration: v })} />
        <Slider label="VIGNETTE" value={crt.vignette} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ vignette: v })} />
        <Slider label="FLICKER" value={crt.flicker} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ flicker: v })} />
        <Slider label="MASK" value={crt.mask} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ mask: v })} />
      </Section>

      {/* ROADMAP (muted) ----------------------------------------------------- */}
      <div className="roadmap">
        <Section title="ROADMAP" open={open.roadmap} onToggle={() => toggle("roadmap")}>
          <ul>
            <li>MULTI-SPRITE SUPPORT</li>
            <li>COLOR THEMES</li>
          </ul>
        </Section>
      </div>

      {/* EXPORT (pinned to the very bottom) ---------------------------------- */}
      <div className="export">
        <div className="ttl">EXPORT · PNG · 4:3</div>
        {crt.on ? (
          <>
            <div className="ctl">
              <div className="ctl__label">
                <span>SCALE</span>
                <span className="val">{state.exportScale}×</span>
              </div>
              <Segmented
                value={String(state.exportScale)}
                options={[
                  { value: "1", label: "1×" },
                  { value: "2", label: "2×" },
                  { value: "3", label: "3×" },
                ]}
                teal
                onChange={(v) => patch({ exportScale: Number(v) as 1 | 2 | 3 })}
              />
            </div>
            <div className="note">CRT BAKED · BG OPAQUE · {600 * state.exportScale}×{450 * state.exportScale}</div>
          </>
        ) : (
          <>
            <Toggle
              label="TRANSPARENT BG"
              on={state.exportTransparent}
              onChange={(v) => patch({ exportTransparent: v })}
            />
            <div className="note">
              FLAT 600×450 · {state.exportTransparent ? "ALPHA PRESERVED" : "BACKGROUND FILLED"}
            </div>
          </>
        )}
        <button
          className="key cream block"
          onClick={onExport}
          disabled={!state.layer.image}
          style={{ opacity: state.layer.image ? 1 : 0.4 }}
        >
          ▼ EXPORT PNG
        </button>
      </div>
    </aside>
  );
}

const pct = (v: number) => Math.round(v * 100) + "%";

// Gradient preview. Runs the REAL dither over a 0→1 brightness ramp rather than
// drawing a CSS gradient, so what you see is what the canvas does — including
// the dither texture, which is the only thing that makes hard stops read as
// tones rather than flat bands.
function GradientPreview({
  stops,
  hard,
  type,
}: {
  stops: GradientStop[];
  hard: boolean;
  type: DitherType;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = Math.max(32, Math.round(cv.clientWidth));
    const h = 14;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.round((x / (w - 1)) * 255);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ditherGradient(
      img.data,
      w,
      h,
      type,
      stops.map((s) => ({ pos: s.pos, ...hexToRgb(s.color) })),
      hard
    );
    ctx.putImageData(img, 0, 0);
  }, [stops, hard, type]);
  return <canvas ref={ref} className="gradbar" />;
}

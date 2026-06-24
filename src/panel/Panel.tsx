import { useState } from "react";
import type { StoreApi } from "../state/store";
import type { DitherType } from "../state/types";
import { isValidHex } from "../util/color";
import { Section, Slider, Toggle, Segmented } from "./controls";

// Left panel. Title → three collapsible dropdowns (all collapsed on load) →
// export controls → muted roadmap. Compact, unobtrusive chrome.

const DITHERS: { value: DitherType; label: string }[] = [
  { value: "fs", label: "FS" },
  { value: "bayer2", label: "B2" },
  { value: "bayer4", label: "B4" },
  { value: "bayer8", label: "B8" },
];

export function Panel({
  store,
  onExport,
}: {
  store: StoreApi;
  onExport: () => void;
}) {
  const { state, setDither, setColor, setCRT, patch } = store;
  const [open, setOpen] = useState({
    dither: false,
    color: false,
    crt: false,
    roadmap: false,
  });
  const toggle = (k: keyof typeof open) =>
    setOpen((o) => ({ ...o, [k]: !o[k] }));

  const d = state.dither;
  const c = state.color;
  const crt = state.crt;

  // ---- palette helpers ----
  const setPaletteAt = (i: number, hex: string) =>
    setColor({ palette: c.palette.map((p, j) => (j === i ? hex : p)) });
  const removePalette = (i: number) =>
    setColor({ palette: c.palette.filter((_, j) => j !== i) });
  const addPalette = () =>
    setColor({ palette: [...c.palette, c.palette[c.palette.length - 1] ?? "#ffffff"] });

  // ---- gradient stop helpers ----
  const stops = c.gradientStops;
  const setStop = (i: number, patchStop: Partial<{ pos: number; color: string }>) =>
    setColor({
      gradientStops: stops.map((st, j) => (j === i ? { ...st, ...patchStop } : st)),
    });
  const addStop = () =>
    setColor({ gradientStops: [...stops, { pos: 1, color: "#ffffff" }] });
  const removeStop = (i: number) =>
    stops.length > 2 &&
    setColor({ gradientStops: stops.filter((_, j) => j !== i) });
  const gradientCss =
    "linear-gradient(90deg," +
    [...stops]
      .sort((a, b) => a.pos - b.pos)
      .map((s) => `${s.color} ${Math.round(s.pos * 100)}%`)
      .join(",") +
    ")";

  return (
    <aside className="panel">
      <div className="brand">
        <h1>
          <span className="br">BRX</span>_ARCADE
        </h1>
        <span className="blip">
          <i />
          <i />
          <i />
        </span>
      </div>

      {/* 1 — PIXELIZE / DITHER ------------------------------------------------ */}
      <Section
        index="01"
        title="PIXELIZE / DITHER"
        open={open.dither}
        onToggle={() => toggle("dither")}
        pip={d.colorOn ? "on" : "off"}
      >
        <div className="ctl">
          <div className="ctl__label">
            <span>DITHER</span>
          </div>
          <Segmented
            value={d.type}
            options={DITHERS}
            onChange={(t) => setDither({ type: t })}
          />
        </div>
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
        <Slider
          label="THRESHOLD"
          value={d.threshold}
          min={0}
          max={255}
          disabled={d.colorOn}
          onChange={(v) => setDither({ threshold: v })}
        />
        <Toggle
          label="COLOR"
          on={d.colorOn}
          onChange={(v) => setDither({ colorOn: v })}
        />
        <div className="export note" style={{ padding: 0 }}>
          {d.colorOn
            ? "DITHER SNAPS TO PALETTE →"
            : "1-BIT · THRESHOLD SETS CUTOFF"}
        </div>
      </Section>

      {/* 2 — COLOR ----------------------------------------------------------- */}
      <Section
        index="02"
        title="COLOR"
        open={open.color}
        onToggle={() => toggle("color")}
        pip={c.gradientMapOn ? "hot" : "off"}
      >
        <div className="ctl">
          <div className="ctl__label">
            <span>PALETTE</span>
            <span className="val">{c.palette.length}</span>
          </div>
          <div className="palette">
            {c.palette.map((hex, i) => (
              <label className="chip" key={i} style={{ background: hex }}>
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setPaletteAt(i, e.target.value)}
                  style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                />
                <span
                  className="x"
                  onClick={(e) => {
                    e.preventDefault();
                    removePalette(i);
                  }}
                >
                  ×
                </span>
              </label>
            ))}
            <button className="add" onClick={addPalette} title="add color">
              +
            </button>
          </div>
        </div>

        <Toggle
          label="GRADIENT MAP"
          on={c.gradientMapOn}
          hot
          onChange={(v) => setColor({ gradientMapOn: v })}
        />
        {c.gradientMapOn && (
          <div className="gstops">
            <div className="gradbar" style={{ background: gradientCss }} />
            {stops.map((s, i) => (
              <div className="gstop" key={i}>
                <label className="swatch" style={{ background: s.color }}>
                  <input
                    type="color"
                    value={s.color}
                    onChange={(e) => setStop(i, { color: e.target.value })}
                  />
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
                <button
                  className="key sm ghost"
                  onClick={() => removeStop(i)}
                  disabled={stops.length <= 2}
                >
                  ×
                </button>
              </div>
            ))}
            <button className="key sm ghost" onClick={addStop}>
              + STOP
            </button>
            <div className="export note" style={{ padding: 0 }}>
              OVERRIDES PALETTE ENTIRELY
            </div>
          </div>
        )}

        <div className="ctl">
          <div className="ctl__label">
            <span>BACKGROUND</span>
          </div>
          <div className="colorrow">
            <label className="swatch" style={{ background: c.background }}>
              <input
                type="color"
                value={c.background}
                onChange={(e) => setColor({ background: e.target.value })}
              />
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
            <div className="export note" style={{ padding: 0 }}>
              CLICK INSIDE THE CANVAS TO PICK
            </div>
          )}
        </div>
      </Section>

      {/* 3 — CRT ------------------------------------------------------------- */}
      <Section
        index="03"
        title="CRT"
        open={open.crt}
        onToggle={() => toggle("crt")}
        pip={crt.on ? "hot" : "off"}
      >
        <Toggle
          label="CRT POST"
          on={crt.on}
          hot
          onChange={(v) => setCRT({ on: v })}
        />
        <Slider label="BARREL" value={crt.barrel} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ barrel: v })} />
        <Slider label="SCANLINE" value={crt.scanline} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ scanline: v })} />
        <Slider label="GLOW" value={crt.glow} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ glow: v })} />
        <Slider label="ABERRATION" value={crt.aberration} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ aberration: v })} />
        <Slider label="VIGNETTE" value={crt.vignette} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ vignette: v })} />
        <Slider label="FLICKER" value={crt.flicker} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ flicker: v })} />
        <Slider label="MASK" value={crt.mask} min={0} max={1} step={0.01} hot disabled={!crt.on} fmt={pct} onChange={(v) => setCRT({ mask: v })} />
      </Section>

      {/* EXPORT -------------------------------------------------------------- */}
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
                value={String(state.exportScale) as "1" | "2" | "3"}
                options={[
                  { value: "1", label: "1×" },
                  { value: "2", label: "2×" },
                  { value: "3", label: "3×" },
                ]}
                teal
                onChange={(v) => patch({ exportScale: Number(v) as 1 | 2 | 3 })}
              />
            </div>
            <div className="note">
              CRT BAKED IN · BACKGROUND FORCED OPAQUE ·{" "}
              {800 * state.exportScale}×{600 * state.exportScale}
            </div>
          </>
        ) : (
          <>
            <Toggle
              label="TRANSPARENT BG"
              on={state.exportTransparent}
              onChange={(v) => patch({ exportTransparent: v })}
            />
            <div className="note">
              FLAT 800×600 ·{" "}
              {state.exportTransparent ? "ALPHA PRESERVED" : "BACKGROUND FILLED"}
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

      {/* ROADMAP ------------------------------------------------------------- */}
      <div className="roadmap">
        <Section
          title="ROADMAP"
          open={open.roadmap}
          onToggle={() => toggle("roadmap")}
        >
          <ul>
            <li>MULTI-SPRITE SUPPORT</li>
            <li>COLOR THEMES</li>
          </ul>
        </Section>
      </div>
    </aside>
  );
}

const pct = (v: number) => Math.round(v * 100) + "%";

import { useState } from "react";
import type { StoreApi } from "../state/store";
import type { DitherType } from "../state/types";
import { PALETTE_MAX, PALETTE_MAX_BW } from "../state/types";
import { DEFAULT_PALETTES } from "../state/defaults";
import { isValidHex } from "../util/color";
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
}: {
  store: StoreApi;
  onExport: () => void;
  onAddImage: () => void;
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

  // pure black & white only when no recolor is active
  const bwMode = !c.originalColors && !c.paletteOn && !c.gradientMapOn;

  // ---- custom (color-mode) palette helpers — editing switches to custom ----
  const setCustomAt = (i: number, hex: string) =>
    setColor({ paletteSource: "custom", customPalette: c.customPalette.map((p, j) => (j === i ? hex : p)) });
  const removeCustom = (i: number) =>
    setColor({ paletteSource: "custom", customPalette: c.customPalette.filter((_, j) => j !== i) });
  const addCustom = () =>
    c.customPalette.length < PALETTE_MAX &&
    setColor({ paletteSource: "custom", customPalette: [...c.customPalette, c.customPalette[c.customPalette.length - 1] ?? "#ffffff"] });
  const selectDefault = (i: number) => setColor({ paletteSource: "default", defaultIndex: i });

  // ---- B&W duotone helpers (max 2) ----
  const setBwAt = (i: number, hex: string) =>
    setColor({ bwPalette: c.bwPalette.map((p, j) => (j === i ? hex : p)) });
  const addBw = () =>
    c.bwPalette.length < PALETTE_MAX_BW && setColor({ bwPalette: [...c.bwPalette, "#ffffff"] });
  const removeBw = (i: number) =>
    c.bwPalette.length > 1 && setColor({ bwPalette: c.bwPalette.filter((_, j) => j !== i) });

  // ---- recolor toggles — both palettes are preserved across the switch ----
  const setOriginal = (v: boolean) => setColor({ originalColors: v });
  const setPaletteOn = (v: boolean) =>
    setColor({ paletteOn: v, gradientMapOn: v ? false : c.gradientMapOn });
  const setGradientOn = (v: boolean) =>
    setColor({ gradientMapOn: v, paletteOn: v ? false : c.paletteOn });

  // ---- gradient stop helpers ----
  const stops = c.gradientStops;
  const setStop = (i: number, p: Partial<{ pos: number; color: string }>) =>
    setColor({ gradientStops: stops.map((st, j) => (j === i ? { ...st, ...p } : st)) });
  const addStop = () =>
    setColor({ gradientStops: [...stops, { pos: 1, color: "#ffffff" }] });
  const removeStop = (i: number) =>
    stops.length > 2 && setColor({ gradientStops: stops.filter((_, j) => j !== i) });
  const gradientCss =
    "linear-gradient(90deg," +
    [...stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(",") +
    ")";

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
      >
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
          disabled={!bwMode}
          onChange={(v) => setDither({ threshold: v })}
        />
      </Section>

      {/* 2 — COLOR ----------------------------------------------------------- */}
      <Section
        index="02"
        title="COLOR"
        open={open.color}
        onToggle={() => toggle("color")}
        pip={c.gradientMapOn ? "hot" : c.paletteOn ? "on" : "off"}
      >
        <Toggle label="ORIGINAL COLORS" on={c.originalColors} onChange={setOriginal} />

        <Toggle label="PALETTE" on={c.paletteOn} onChange={setPaletteOn} />

        {/* color mode: 5 default palettes + custom (mutually greyed) */}
        {c.paletteOn && c.originalColors && (
          <>
            <div className="ctl">
              <div className="ctl__label"><span>DEFAULT</span></div>
              <div className={"palrow" + (c.paletteSource === "custom" ? " inactive" : "")}>
                {DEFAULT_PALETTES.map((p, i) => (
                  <button
                    key={i}
                    className={"palbtn" + (c.paletteSource === "default" && c.defaultIndex === i ? " active" : "")}
                    onClick={() => selectDefault(i)}
                    title={`palette 0${i + 1}`}
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

            <div className={"ctl" + (c.paletteSource === "default" ? " dim" : "")}>
              <div className="ctl__label">
                <span>CUSTOM</span>
                <span className="val">{c.customPalette.length}/{PALETTE_MAX}</span>
              </div>
              <div className="palette">
                {c.customPalette.map((hex, i) => (
                  <label className="chip" key={i} style={{ background: hex }}>
                    <input
                      type="color"
                      value={hex}
                      onChange={(e) => setCustomAt(i, e.target.value)}
                      style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                    />
                    <span className="x" onClick={(e) => { e.preventDefault(); removeCustom(i); }}>×</span>
                  </label>
                ))}
                {c.customPalette.length < PALETTE_MAX && (
                  <button className="add" onClick={addCustom} title="add color">+</button>
                )}
              </div>
            </div>
          </>
        )}

        {/* B&W mode: 2-slot duotone (defaults to black + FF3D00) */}
        {c.paletteOn && !c.originalColors && (
          <div className="ctl">
            <div className="ctl__label">
              <span>DUOTONE</span>
              <span className="val">{c.bwPalette.length}/{PALETTE_MAX_BW}</span>
            </div>
            <div className="palette">
              {c.bwPalette.map((hex, i) => (
                <label className="chip" key={i} style={{ background: hex }}>
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => setBwAt(i, e.target.value)}
                    style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                  />
                  {c.bwPalette.length > 1 && (
                    <span className="x" onClick={(e) => { e.preventDefault(); removeBw(i); }}>×</span>
                  )}
                </label>
              ))}
              {c.bwPalette.length < PALETTE_MAX_BW && (
                <button className="add" onClick={addBw} title="add color">+</button>
              )}
            </div>
          </div>
        )}

        <Toggle label="GRADIENT MAP" on={c.gradientMapOn} hot onChange={setGradientOn} />
        {c.gradientMapOn && (
          <div className="gstops">
            <div className="gradbar" style={{ background: gradientCss }} />
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
            <button className="key sm ghost" onClick={addStop}>
              + STOP
            </button>
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

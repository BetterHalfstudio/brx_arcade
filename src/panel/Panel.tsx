import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "../state/store";
import type { DitherType, GradientStop } from "../state/types";
import { STOPS_MAX, PIXEL_LOCK_COLORS_MIN, PIXEL_LOCK_COLORS_MAX } from "../state/types";
import { DEFAULT_PALETTES, paletteToStops, stopId } from "../state/defaults";
import {
  fetchCommunity,
  saveCommunity,
  toGradientStops,
  stopsSignature,
  type SharedPalette,
} from "../state/community";
import { ditherGradient } from "../pipeline/dither";
import { hexToRgb } from "../util/color";
import { Section, Slider, Toggle, Segmented, HexSwatch } from "./controls";

// Left panel. Title → Add Image → three collapsible dropdowns (all collapsed
// on load) → export pinned at the bottom.

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
  onExportImage,
  onExportFrame,
  onAddImage,
  onRemoveBg,
  removingBg,
  onRedetect,
}: {
  store: StoreApi;
  /** export just the processed image, cropped to its visible pixels */
  onExportImage: () => void;
  /** export the full 600x450 frame (CRT baked when on) */
  onExportFrame: () => void;
  onAddImage: () => void;
  /** auto-remove a (near-)solid background from the placed image */
  onRemoveBg: () => void;
  removingBg: boolean;
  /** re-run pixel-grid auto-detection on the current image */
  onRedetect: () => void;
}) {
  const { state, setDither, setColor, setCRT, patch } = store;
  const [open, setOpen] = useState({
    dither: false,
    color: false,
    crt: false,
  });
  const toggle = (k: keyof typeof open) =>
    setOpen((o) => ({ ...o, [k]: !o[k] }));

  const d = state.dither;
  const c = state.color;
  const crt = state.crt;

  // pure black & white only when no recolor is active
  const bwMode = !c.originalColors && !c.gradientMapOn;

  // ---- pixel-lock: current cell size (native px per art-pixel) ----
  const plCell = Math.max(1, Math.round(d.pixelLockSize));

  const setOriginal = (v: boolean) => setColor({ originalColors: v });
  const setGradientOn = (v: boolean) => setColor({ gradientMapOn: v });

  // ---- gradient map: the single recolor system ----------------------------
  // Presets are just loaders — they drop a palette in as evenly spaced stops
  // and everything stays editable from there (no default/custom modes).
  const stops = c.gradientStops;
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const setStop = (id: number, p: Partial<GradientStop>) =>
    setColor({ gradientStops: stops.map((st) => (st.id === id ? { ...st, ...p } : st)) });
  const addStop = () =>
    stops.length < STOPS_MAX &&
    // sorted insert: a new 100% stop lands at the bottom, below existing 100%s
    setColor({
      gradientStops: [...stops, { pos: 1, color: "#ffffff", id: stopId() }].sort(
        (a, b) => a.pos - b.pos
      ),
    });
  const removeStop = (id: number) =>
    stops.length > 2 && setColor({ gradientStops: stops.filter((st) => st.id !== id) });
  const loadPreset = (i: number) =>
    setColor({ gradientMapOn: true, gradientStops: paletteToStops(DEFAULT_PALETTES[i]) });

  // ---- stop rows reorder to position order when a slider is RELEASED -------
  // FLIP animation: capture row offsets before the sort, then animate each row
  // from its old spot to its new one; the row that was just adjusted rides on
  // top — slightly grown, with a shadow — while it slides into place.
  const rowsRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<{ prev: Map<number, number>; movedId: number } | null>(null);
  const orderKey = stops.map((s) => s.id).join(",");

  const commitOrder = (movedId: number) => {
    const next = [...stops].sort((a, b) => a.pos - b.pos);
    if (next.every((s, i) => s === stops[i])) return; // already in order
    const prev = new Map<number, number>();
    rowsRef.current
      ?.querySelectorAll<HTMLElement>("[data-sid]")
      .forEach((el) => prev.set(Number(el.dataset.sid), el.getBoundingClientRect().top));
    flipRef.current = { prev, movedId };
    setColor({ gradientStops: next });
  };

  useLayoutEffect(() => {
    const f = flipRef.current;
    if (!f) return;
    flipRef.current = null;
    rowsRef.current?.querySelectorAll<HTMLElement>("[data-sid]").forEach((el) => {
      const id = Number(el.dataset.sid);
      const was = f.prev.get(id);
      if (was == null) return;
      const dy = was - el.getBoundingClientRect().top;
      if (!dy) return;
      const moved = id === f.movedId;
      if (moved) {
        el.style.zIndex = "5";
        el.style.background = "var(--col-bg-2)";
      }
      const anim = el.animate(
        moved
          ? [
              { transform: `translateY(${dy}px) scale(1)`, boxShadow: "0 0 0 rgba(0,0,0,0)" },
              {
                transform: `translateY(${dy / 2}px) scale(1.06)`,
                boxShadow: "0 6px 14px rgba(0,0,0,0.6)",
                offset: 0.5,
              },
              { transform: "translateY(0) scale(1)", boxShadow: "0 0 0 rgba(0,0,0,0)" },
            ]
          : [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        { duration: moved ? 240 : 200, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)" }
      );
      anim.onfinish = () => {
        el.style.zIndex = "";
        el.style.background = "";
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  // ---- community palettes (shared via /api/palettes) -----------------------
  const [community, setCommunity] = useState<SharedPalette[] | null>(null);
  const [communityErr, setCommunityErr] = useState<string | null>(null);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null); // null = field closed
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const communityWanted = communityOpen || c.gradientMapOn;

  useEffect(() => {
    if (!communityWanted || community !== null || communityErr !== null) return;
    let gone = false;
    fetchCommunity()
      .then((list) => !gone && setCommunity(list))
      .catch((e) => !gone && setCommunityErr(e?.message || "unavailable"));
    return () => {
      gone = true;
    };
  }, [communityWanted, community, communityErr]);

  // SAVE is greyed out while the current stops ARE a preset / saved palette.
  const presetSigs = useMemo(
    () => new Set(DEFAULT_PALETTES.map((p) => stopsSignature(paletteToStops(p)))),
    []
  );
  const currentSig = stopsSignature(stops);
  const isExisting =
    presetSigs.has(currentSig) ||
    (community ?? []).some((p) => stopsSignature(p.stops) === currentSig);

  const loadCommunity = (p: SharedPalette) =>
    setColor({ gradientMapOn: true, gradientStops: toGradientStops(p) });

  const doSave = async () => {
    if (saving || isExisting) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveCommunity(saveName || "", sorted);
      const mine: SharedPalette = {
        name: (saveName || "").toUpperCase().trim().slice(0, 14),
        stops: sorted.map((s) => ({ pos: s.pos, color: s.color })),
        ts: Date.now(),
      };
      setCommunity((list) => [mine, ...(list ?? [])]);
      setSaveName(null);
      setNotice("✓ SAVED FOR EVERYONE");
    } catch (e: any) {
      setNotice("⚠ " + (e?.message || "save failed"));
    } finally {
      setSaving(false);
    }
  };

  // background colour is meaningless while the export is transparent
  const bgDisabled = state.exportTransparent && !crt.on;


  return (
    <aside className="panel">
      <div className="toolbar">
        <button className="key cream block" onClick={onAddImage}>
          ＋ ADD IMAGE
        </button>
        <button
          className="key sm ghost block"
          onClick={onRemoveBg}
          disabled={!state.layer.image || removingBg}
          style={{ opacity: state.layer.image ? 1 : 0.4 }}
          title="auto-remove a solid background"
        >
          {removingBg ? "◴ REMOVING…" : "◌ REMOVE BG"}
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
          /* Snap AI pixel-art to its native grid instead of dithering. */
          <div className="subsec">
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
              <button
                className="key sm ghost block"
                onClick={onRedetect}
                disabled={!state.layer.image}
              >
                ◎ RE-DETECT
              </button>
            </div>
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

        {/* community palettes — saved by users, visible to everyone */}
        <div className="commsec">
          <button
            type="button"
            className="commsec__head"
            onClick={() => setCommunityOpen((o) => !o)}
          >
            <span className="chev">{communityOpen ? "▾" : "▸"}</span>
            <span>COMMUNITY</span>
            <span className="spacer" />
            <span className="val">{community ? community.length : "···"}</span>
          </button>
          {communityOpen && (
            <div className="commsec__body">
              {communityErr ? (
                <div className="note err">⚠ {communityErr.toUpperCase()}</div>
              ) : community === null ? (
                <div className="note">LOADING…</div>
              ) : community.length === 0 ? (
                <div className="note">NOTHING SAVED YET — BUILD A GRADIENT AND HIT SAVE</div>
              ) : (
                <div className="palrow">
                  {community.map((p, i) => (
                    <button
                      key={(p.ts ?? 0) + "-" + i}
                      className="palbtn"
                      onClick={() => loadCommunity(p)}
                      title={(p.name || "untitled") + " — load into the gradient"}
                    >
                      <span className="sw">
                        {p.stops.slice(0, 4).map((s, j) => (
                          <i key={j} style={{ background: s.color }} />
                        ))}
                      </span>
                      <span className="lbl">{(p.name || `C${community.length - i}`).slice(0, 10)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
            <div className="gstoplist" ref={rowsRef}>
              {stops.map((s) => (
                <div className="gstop" key={s.id} data-sid={s.id}>
                  <HexSwatch color={s.color} onChange={(hex) => setStop(s.id, { color: hex })} />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={s.pos}
                    onChange={(e) => setStop(s.id, { pos: parseFloat(e.target.value) })}
                    onPointerUp={() => commitOrder(s.id)}
                    onKeyUp={(e) => e.key.startsWith("Arrow") && commitOrder(s.id)}
                    onBlur={() => commitOrder(s.id)}
                  />
                  <span className="gpos">{Math.round(s.pos * 100)}%</span>
                  <button
                    className="key sm ghost"
                    onClick={() => removeStop(s.id)}
                    disabled={stops.length <= 2}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="row">
              <button
                className="key sm ghost grow"
                onClick={addStop}
                disabled={stops.length >= STOPS_MAX}
              >
                + STOP
              </button>
              <button
                className="key sm ghost grow"
                onClick={() => (saveName === null ? setSaveName("") : doSave())}
                disabled={isExisting || saving}
                title={
                  isExisting
                    ? "this palette is already a preset / saved palette"
                    : "share this palette with everyone"
                }
              >
                {saving ? "◴ SAVING…" : "◇ SAVE PALETTE"}
              </button>
            </div>
            {saveName !== null && (
              <div className="saverow">
                <input
                  autoFocus
                  placeholder="NAME (OPTIONAL)"
                  value={saveName}
                  maxLength={14}
                  spellCheck={false}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSave();
                    if (e.key === "Escape") setSaveName(null);
                  }}
                />
                <button className="key sm teal" onClick={doSave} disabled={saving}>
                  ✓
                </button>
              </div>
            )}
            {notice && <div className="note">{notice}</div>}
          </div>
        )}

        {/* greyed out while TRANSPARENT BG is exporting — the colour is unused */}
        <div className={"ctl" + (bgDisabled ? " disabled" : "")}>
          <div className="ctl__label">
            <span>BACKGROUND</span>
            {bgDisabled && <span className="val">TRANSPARENT</span>}
          </div>
          <div className="colorrow">
            <HexSwatch
              color={c.background}
              disabled={bgDisabled}
              onChange={(hex) => setColor({ background: hex })}
            />
            <span className="hexval">{c.background.toUpperCase()}</span>
            <button
              className={"key sm" + (state.eyedropper ? " teal" : "")}
              disabled={bgDisabled}
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

      {/* EXPORT (pinned to the very bottom) ---------------------------------- */}
      <div className="export">
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
          <Toggle
            label="TRANSPARENT BG"
            on={state.exportTransparent}
            onChange={(v) => patch({ exportTransparent: v })}
          />
        )}
        <button
          className="key cream block"
          onClick={onExportImage}
          disabled={!state.layer.image}
          style={{ opacity: state.layer.image ? 1 : 0.4 }}
        >
          ▼ EXPORT PNG
        </button>
        <button
          className="key block"
          onClick={onExportFrame}
          disabled={!state.layer.image}
          style={{ opacity: state.layer.image ? 1 : 0.4 }}
        >
          ▼ EXPORT PNG · FULL FRAME
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

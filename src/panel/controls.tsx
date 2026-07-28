import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isValidHex, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from "../util/color";

// Small reusable, theme-driven panel controls. No UI kit — plain elements
// styled by styles.css. Everything is compact to match the hero references.

/**
 * Colour swatch that opens an in-panel picker: saturation/value square + hue
 * slider + a HEX field. Deliberately NOT <input type="color"> — that opens the
 * OS panel with RGB/HSL number fields; here hex is the only numeric entry.
 * Type the code with or without "#"; Enter, Esc, or clicking away locks it in.
 */
export function HexSwatch(props: {
  color: string;
  onChange: (hex: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [hue, setHue] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rgb = hexToRgb(props.color);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  // Keep the hue slider steady on greys/black, where hue is mathematically
  // undefined and would otherwise snap back to 0 on every edit.
  const h = hsv.s === 0 || hsv.v === 0 ? hue : hsv.h;

  const openPop = () => {
    setText(props.color.replace(/^#/, "").toUpperCase());
    setHue(hsv.h);
    setOpen(true);
  };
  const commitText = () => {
    const v = text.trim().replace(/^#/, "");
    if (isValidHex(v)) props.onChange("#" + v.toLowerCase());
  };
  const close = () => {
    commitText();
    setOpen(false);
  };

  // click-away / Esc close the picker
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  });

  const emit = (nh: number, s: number, v: number) => {
    const c = hsvToRgb(nh, s, v);
    const hex = rgbToHex(c.r, c.g, c.b);
    setText(hex.replace(/^#/, "").toUpperCase());
    props.onChange(hex);
  };

  /** drag anywhere in the SV square */
  const pickSV = (e: React.PointerEvent) => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    emit(h, s, v);
  };

  return (
    <span className="swatchwrap" ref={wrapRef}>
      <button
        type="button"
        className="swatch"
        style={{ background: props.color }}
        title={props.title ?? props.color}
        onClick={() => (open ? close() : openPop())}
      />
      {open && (
        <div className="cpick" onPointerDown={(e) => e.stopPropagation()}>
          <div
            ref={svRef}
            className="cpick__sv"
            style={{ background: `hsl(${Math.round(h)},100%,50%)` }}
            onPointerDown={(e) => {
              try {
                (e.target as Element).setPointerCapture?.(e.pointerId);
              } catch {
                /* no active pointer (e.g. synthetic event) — drag still works */
              }
              pickSV(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) pickSV(e);
            }}
          >
            <span
              className="cpick__dot"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>
          <input
            className="cpick__hue"
            type="range"
            min={0}
            max={360}
            step={1}
            value={Math.round(h)}
            onChange={(e) => {
              const nh = Number(e.target.value);
              setHue(nh);
              emit(nh, hsv.s, hsv.v === 0 && hsv.s === 0 ? 1 : hsv.v);
            }}
          />
          <div className="cpick__hex">
            <span className="hash">#</span>
            <input
              ref={inputRef}
              value={text}
              maxLength={6}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
                setText(v);
                if (isValidHex(v)) props.onChange("#" + v.toLowerCase());
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
              }}
            />
          </div>
        </div>
      )}
    </span>
  );
}

export function Section(props: {
  index?: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  pip?: "off" | "on" | "hot";
  /** optional switch shown in the header (visible while collapsed) */
  headerToggle?: { on: boolean; onChange: (v: boolean) => void; hot?: boolean };
  children: ReactNode;
}) {
  const ht = props.headerToggle;
  return (
    <div className={"section" + (props.open ? " section--open" : "")}>
      <div
        className={"section__head" + (props.open ? " open" : "")}
        role="button"
        tabIndex={0}
        onClick={props.onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onToggle();
          }
        }}
      >
        <span className="chev">{props.open ? "▾" : "▸"}</span>
        {props.index && <span className="idx">{props.index}</span>}
        <span>{props.title}</span>
        <span className="spacer" />
        {ht && (
          <span
            className={"hswitch" + (ht.on ? " on" : "") + (ht.hot ? " hot" : "")}
            role="switch"
            aria-checked={ht.on}
            onClick={(e) => {
              e.stopPropagation();
              ht.onChange(!ht.on);
            }}
          >
            <i />
          </span>
        )}
        {props.pip && !ht && (
          <span
            className={
              "pip" + (props.pip === "on" ? " on" : props.pip === "hot" ? " hot" : "")
            }
          />
        )}
      </div>
      {props.open && <div className="section__body">{props.children}</div>}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
  hot?: boolean;
  disabled?: boolean;
}) {
  const fmt = props.fmt ?? ((v: number) => String(v));
  return (
    <div className={"ctl" + (props.disabled ? " disabled" : "")}>
      <div className="ctl__label">
        <span>{props.label}</span>
        <span className="val">{fmt(props.value)}</span>
      </div>
      <input
        type="range"
        className={props.hot ? "hot" : ""}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function Toggle(props: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  hot?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={
        "toggle" +
        (props.on ? " on" : "") +
        (props.hot ? " hot" : "") +
        (props.disabled ? " disabled" : "")
      }
      disabled={props.disabled}
      onClick={() => props.onChange(!props.on)}
    >
      <span>{props.label}</span>
      <span className="sw" />
    </button>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  teal?: boolean;
}) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button
          key={o.value}
          className={
            (o.value === props.value ? "active" : "") +
            (props.teal ? " teal" : "")
          }
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

import type { ReactNode } from "react";

// Small reusable, theme-driven panel controls. No UI kit — plain elements
// styled by styles.css. Everything is compact to match the hero references.

export function Section(props: {
  index?: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  pip?: "off" | "on" | "hot";
  children: ReactNode;
}) {
  return (
    <div className="section">
      <button
        className={"section__head" + (props.open ? " open" : "")}
        onClick={props.onToggle}
      >
        <span className="chev">{props.open ? "▾" : "▸"}</span>
        {props.index && <span className="idx">{props.index}</span>}
        <span>{props.title}</span>
        <span className="spacer" />
        {props.pip && (
          <span
            className={
              "pip" + (props.pip === "on" ? " on" : props.pip === "hot" ? " hot" : "")
            }
          />
        )}
      </button>
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
}) {
  return (
    <button
      className={"toggle" + (props.on ? " on" : "") + (props.hot ? " hot" : "")}
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

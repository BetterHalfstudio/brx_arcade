// Client side of the shared community palettes (see api/palettes.ts).

import type { GradientStop } from "./types";
import { stopId } from "./defaults";

export interface SharedPalette {
  name: string;
  stops: { pos: number; color: string }[];
  ts?: number;
}

/** Order-independent identity of a set of stops (1% position buckets). */
export function stopsSignature(stops: { pos: number; color: string }[]): string {
  return [...stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${Math.round(s.pos * 100)}:${s.color.toLowerCase()}`)
    .join("|");
}

export async function fetchCommunity(): Promise<SharedPalette[]> {
  const r = await fetch("/api/palettes", { headers: { Accept: "application/json" } });
  // vite dev has no serverless runtime and answers with the SPA page — treat
  // anything that isn't JSON as "no backend here"
  if (!(r.headers.get("content-type") || "").includes("json")) {
    throw new Error("shared storage unavailable (local dev)");
  }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `shared storage unavailable (${r.status})`);
  return Array.isArray(j?.palettes) ? j.palettes : [];
}

export async function saveCommunity(name: string, stops: GradientStop[]): Promise<void> {
  const r = await fetch("/api/palettes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      stops: stops.map((s) => ({ pos: s.pos, color: s.color })),
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `save failed (${r.status})`);
}

/** A shared palette as loadable gradient stops (exact positions, fresh ids). */
export function toGradientStops(p: SharedPalette): GradientStop[] {
  return [...p.stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => ({ pos: s.pos, color: s.color, id: stopId() }));
}

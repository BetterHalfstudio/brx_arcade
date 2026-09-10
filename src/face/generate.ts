// BULLETPROOF AVATAR GENERATION — the answer to "it must work 100% of the
// time" against a stochastic image model: generate, then VALIDATE the output
// deterministically, rescue what can be rescued in code, and auto-re-roll only
// what cannot.
//
//   failure                        detection                    remedy
//   ────────────────────────────── ──────────────────────────── ─────────────
//   background not flat #0047BB    top border ring stays        u2net cutout
//   (orange-noise / inverted bgs)  opaque after the chroma key  (no re-roll)
//   washed-out OR too-dark face    subject ink outside the      re-pick dither
//                                  band good outputs share      threshold
//   figure runs off the frame      opaque pixels touch bottom/  RE-ROLL (the
//   (silhouette not closed)        side edges of the cutout     art is absent)
//
// The kiosk and the main FACE tool (V2) both generate through here.

import { stylize, downscaleToBase64, type InlineImage, type StylizeDebug } from "./api";
import { removeChromaBackground, facePixelArt, type FaceOpts } from "./finisher";

type Src = HTMLImageElement | HTMLCanvasElement;

const srcDims = (s: Src): [number, number] => [
  (s as HTMLCanvasElement).width || (s as HTMLImageElement).naturalWidth,
  (s as HTMLCanvasElement).height || (s as HTMLImageElement).naturalHeight,
];

/** Draw a source at a bounded working width (aspect preserved). */
function toCanvas(src: Src, maxW: number): HTMLCanvasElement {
  const [sw, sh] = srcDims(src);
  const w = Math.min(maxW, sw);
  const h = Math.max(1, Math.round((sh / sw) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/** Chroma-key a working copy; report how much of the TOP border ring survived
 *  (a properly flat #0047BB background keys to ~0 there). */
export function chromaCutout(src: Src): { canvas: HTMLCanvasElement; borderOpaque: number } {
  const c = toCanvas(src, 512);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  removeChromaBackground(img.data);
  let opaque = 0;
  let total = 0;
  const rows = Math.min(3, c.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < c.width; x++) {
      total++;
      if (img.data[(y * c.width + x) * 4 + 3] >= 128) opaque++;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, borderOpaque: total ? opaque / total : 0 };
}

/** Person cutout via the u2net segmenter (works on illustrations) — the
 *  fallback when the chroma key fails. Lazy-loads the model. */
export async function u2netCutout(src: Src): Promise<HTMLCanvasElement> {
  const { segmentPerson, applyCutout } = await import("./segment");
  const work = toCanvas(src, 768);
  const mask = await segmentPerson(work, "u2net");
  return applyCutout(work, mask, { threshold: 0.5, feather: 0.04, edge: 0 });
}

/** How much of each frame edge the subject touches (0..1 per edge). */
export function edgeContact(cut: HTMLCanvasElement): {
  bottom: number;
  left: number;
  right: number;
} {
  const ctx = cut.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = cut;
  const d = ctx.getImageData(0, 0, w, h).data;
  const opaqueAt = (x: number, y: number) => d[(y * w + x) * 4 + 3] >= 128;
  let bottom = 0;
  for (let x = 0; x < w; x++) {
    if (opaqueAt(x, h - 1) || opaqueAt(x, h - 2)) bottom++;
  }
  let left = 0;
  let right = 0;
  for (let y = 0; y < h; y++) {
    if (opaqueAt(0, y) || opaqueAt(1, y)) left++;
    if (opaqueAt(w - 1, y) || opaqueAt(w - 2, y)) right++;
  }
  return { bottom: bottom / w, left: left / h, right: right / h };
}

/** Fraction of DARK ink among the subject pixels of a finished sprite. */
export function spriteInk(sprite: HTMLCanvasElement): number {
  const ctx = sprite.getContext("2d", { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, sprite.width, sprite.height).data;
  let subject = 0;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    subject++;
    if (d[i] < 128) dark++; // dark maps to #000, lit to #ff3d00 (r=255)
  }
  return subject ? dark / subject : 0;
}

// The band the known-good outputs live in (share of black within the figure).
const INK_MIN = 0.26;
const INK_MAX = 0.62;
const INK_TARGET = 0.44;
const EDGE_LIMIT = 0.04; // >4% of an edge covered = the silhouette is open
const BORDER_BG_LIMIT = 0.1; // >10% of the top ring opaque = chroma key failed

/** Re-pick the 1-bit threshold when the default lands outside the ink band —
 *  rescues washed-out AND too-dark renders without another generation. */
export function adaptThreshold(cut: Src, baked: FaceOpts): number {
  const measure = (thr: number) =>
    spriteInk(facePixelArt(cut, { ...baked, bg: "none", threshold: thr }));
  const base = measure(baked.threshold);
  if (base >= INK_MIN && base <= INK_MAX) return baked.threshold;
  // ink rises monotonically with threshold — binary search to the target
  let lo = 40;
  let hi = 215;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (measure(mid) < INK_TARGET) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export interface GenResult {
  /** full working-res cutout — feed the finisher with bg:"none" */
  cut: HTMLCanvasElement;
  /** last raw model output (dev display) */
  raw: HTMLImageElement;
  /** dither threshold to use (baked value unless it had to adapt) */
  threshold: number;
  usedFallbackCutout: boolean;
  attempts: number;
  /** silhouette fully inside the frame? (false only if retries ran out) */
  closed: boolean;
  debug?: StylizeDebug;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("could not decode model output"));
    img.src = url;
  });
}

export async function generateAvatar(opts: {
  source: Src;
  prompt: string;
  styleRef: InlineImage | null;
  baked: FaceOpts;
  maxAttempts?: number;
  onStatus?: (label: string) => void;
}): Promise<GenResult> {
  const max = Math.max(1, opts.maxAttempts ?? 3);
  let best: GenResult | null = null;
  let bestOpenness = Infinity;

  for (let attempt = 1; attempt <= max; attempt++) {
    opts.onStatus?.(attempt === 1 ? "GENERATING…" : `RE-DRAWING ${attempt}/${max}…`);
    const face = downscaleToBase64(opts.source, 768, "image/jpeg", 0.92);
    const out = await stylize(
      face,
      opts.prompt,
      opts.styleRef ? [{ data: opts.styleRef.data, mimeType: opts.styleRef.mimeType }] : []
    );
    const raw = await loadImage(`data:${out.mimeType};base64,${out.image}`);

    // 1 — cutout: chroma key, or u2net when the background wasn't flat blue
    let { canvas: cut, borderOpaque } = chromaCutout(raw);
    let usedFallback = false;
    if (borderOpaque > BORDER_BG_LIMIT) {
      opts.onStatus?.("CUTTING OUT…");
      try {
        cut = await u2netCutout(raw);
        usedFallback = true;
      } catch {
        /* keep the chroma attempt — tone check still applies */
      }
    }

    // 2 — tone: bring the ink coverage into the good band deterministically
    const threshold = adaptThreshold(cut, opts.baked);

    // 3 — framing: an open silhouette cannot be fixed in code → re-roll
    const e = edgeContact(cut);
    const openness = e.bottom + e.left + e.right;
    const closed = e.bottom <= EDGE_LIMIT && e.left <= EDGE_LIMIT && e.right <= EDGE_LIMIT;

    const res: GenResult = {
      cut,
      raw,
      threshold,
      usedFallbackCutout: usedFallback,
      attempts: attempt,
      closed,
      debug: out.debug,
    };
    (window as any).__brxGen = {
      attempts: attempt,
      closed,
      usedFallbackCutout: usedFallback,
      threshold,
      borderOpaque,
      edges: e,
    };
    if (closed) return res;
    if (openness < bestOpenness) {
      bestOpenness = openness;
      best = res;
    }
  }
  return best!;
}

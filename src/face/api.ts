// Client helper for the FACE tool: talks to the /api/stylize serverless
// function (which holds the Gemini key). Images travel as bare base64.

export interface InlineImage {
  data: string;
  mimeType: string;
}

export interface StylizeDebug {
  model: string;
  sent: Array<
    | { kind: "text"; chars: number; preview: string }
    | { kind: "image"; mimeType: string; approxKB: number }
  >;
  usage: { promptTokenCount?: number; totalTokenCount?: number } | null;
}

export interface StylizeResult {
  image: string; // base64
  mimeType: string;
  debug?: StylizeDebug;
}

export async function stylize(
  face: InlineImage,
  prompt: string,
  styleRefs: InlineImage[]
): Promise<StylizeResult> {
  const res = await fetch("/api/stylize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: face.data,
      mimeType: face.mimeType,
      prompt,
      styleRefs,
    }),
  });
  let j: any = null;
  try {
    j = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    throw new Error(j?.error || `stylize failed (${res.status})`);
  }
  return j as StylizeResult;
}

/** Draw an image onto a canvas downscaled to fit `max` on its long edge. */
export function downscaleToBase64(
  img: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  max = 768,
  type = "image/jpeg",
  quality = 0.9
): InlineImage {
  const w = (img as HTMLVideoElement).videoWidth || (img as HTMLCanvasElement).width;
  const h = (img as HTMLVideoElement).videoHeight || (img as HTMLCanvasElement).height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL(type, quality);
  return { data: dataUrl.split(",")[1], mimeType: type };
}

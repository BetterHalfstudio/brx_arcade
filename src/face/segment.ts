// FREE cutout — in-browser person segmentation, no API, no cost.
//
// Two engines, both lazy-loaded so DITHER/BG users never pay the download:
//   mediapipe — Google Selfie Segmentation (tasks-vision). ~1MB model, fast
//               (~50ms), purpose-built for webcam portraits. The default.
//   u2net     — u2netp via onnxruntime-web (model self-hosted in /models,
//               ~4.5MB). Slower (seconds) but better on hair/edges and on
//               non-selfie framing.
//
// Inference returns a person-probability field ONCE per (source, engine);
// threshold / feather / edge are cheap re-compositions of that cached mask,
// so the sliders stay live without re-running the model.

export type SegEngine = "mediapipe" | "u2net";

export interface SegMask {
  /** person probability 0..1, row-major at w x h (model resolution) */
  prob: Float32Array;
  w: number;
  h: number;
}

type Src = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

function srcSize(s: Src): [number, number] {
  if (s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
  if (s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  return [s.width, s.height];
}

// --- MediaPipe Selfie Segmentation ------------------------------------------

const MP_VERSION = "1.0.1"; // keep in sync with package.json
let mpLoader: Promise<import("@mediapipe/tasks-vision").ImageSegmenter> | null = null;

function loadMediaPipe() {
  if (!mpLoader) {
    mpLoader = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
      );
      return ImageSegmenter.createFromOptions(files, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
        },
        runningMode: "IMAGE",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    })();
    mpLoader.catch(() => (mpLoader = null)); // allow retry after a failed load
  }
  return mpLoader;
}

async function segmentMediaPipe(source: Src): Promise<SegMask> {
  const seg = await loadMediaPipe();
  const res = seg.segment(source as HTMLImageElement);
  try {
    const masks = res.confidenceMasks ?? [];
    if (masks.length === 0) throw new Error("no mask returned");
    // The selfie model reports one confidence mask per category; which index is
    // "person" varies by model build. In a portrait the CENTER pixel is the
    // subject, so pick the mask most confident there.
    let best = 0;
    let bestV = -1;
    const reads = masks.map((m) => m.getAsFloat32Array());
    for (let k = 0; k < reads.length; k++) {
      const w = masks[k].width;
      const h = masks[k].height;
      const v = reads[k][((h >> 1) * w + (w >> 1)) | 0];
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    return {
      prob: Float32Array.from(reads[best]),
      w: masks[best].width,
      h: masks[best].height,
    };
  } finally {
    res.close();
  }
}

// --- u2netp via onnxruntime-web ----------------------------------------------

const ORT_VERSION = "1.29.0"; // keep in sync with package.json
const U2_SIZE = 320;
let u2Loader: Promise<{
  ort: typeof import("onnxruntime-web");
  session: import("onnxruntime-web").InferenceSession;
}> | null = null;

function loadU2Net() {
  if (!u2Loader) {
    u2Loader = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      const session = await ort.InferenceSession.create("/models/u2netp.onnx", {
        executionProviders: ["wasm"],
      });
      return { ort, session };
    })();
    u2Loader.catch(() => (u2Loader = null));
  }
  return u2Loader;
}

async function segmentU2Net(source: Src): Promise<SegMask> {
  const { ort, session } = await loadU2Net();

  // letterbox-free square resize (u2net tolerates the stretch fine)
  const c = document.createElement("canvas");
  c.width = U2_SIZE;
  c.height = U2_SIZE;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, U2_SIZE, U2_SIZE);
  const px = ctx.getImageData(0, 0, U2_SIZE, U2_SIZE).data;

  const plane = U2_SIZE * U2_SIZE;
  const input = new Float32Array(3 * plane);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let p = 0; p < plane; p++) {
    const i = p * 4;
    input[p] = (px[i] / 255 - mean[0]) / std[0];
    input[plane + p] = (px[i + 1] / 255 - mean[1]) / std[1];
    input[2 * plane + p] = (px[i + 2] / 255 - mean[2]) / std[2];
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, U2_SIZE, U2_SIZE]);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const d0 = out[session.outputNames[0]].data as Float32Array;

  // min-max normalize the fused output to a clean 0..1 probability
  let lo = Infinity;
  let hi = -Infinity;
  for (let p = 0; p < plane; p++) {
    if (d0[p] < lo) lo = d0[p];
    if (d0[p] > hi) hi = d0[p];
  }
  const span = Math.max(1e-6, hi - lo);
  const prob = new Float32Array(plane);
  for (let p = 0; p < plane; p++) prob[p] = (d0[p] - lo) / span;
  return { prob, w: U2_SIZE, h: U2_SIZE };
}

// --- public API ---------------------------------------------------------------

export function segmentPerson(source: Src, engine: SegEngine): Promise<SegMask> {
  return engine === "u2net" ? segmentU2Net(source) : segmentMediaPipe(source);
}

export interface CutoutOpts {
  /** probability below which a pixel is background (0..1) */
  threshold: number;
  /** softness of the alpha ramp around the threshold (0..0.5) */
  feather: number;
  /** grow (+) / shrink (−) the cutout by shifting the effective threshold */
  edge: number;
}

/** Compose the source with mask-driven alpha, at full source resolution. */
export function applyCutout(source: Src, mask: SegMask, o: CutoutOpts): HTMLCanvasElement {
  const [sw, sh] = srcSize(source);

  // paint the probability field as grayscale, then let the canvas scaler give
  // us a smooth full-resolution field for free
  const mc = document.createElement("canvas");
  mc.width = mask.w;
  mc.height = mask.h;
  const mctx = mc.getContext("2d")!;
  const mimg = mctx.createImageData(mask.w, mask.h);
  for (let p = 0; p < mask.prob.length; p++) {
    const v = Math.max(0, Math.min(255, Math.round(mask.prob[p] * 255)));
    mimg.data[p * 4] = v;
    mimg.data[p * 4 + 3] = 255;
  }
  mctx.putImageData(mimg, 0, 0);

  const ms = document.createElement("canvas");
  ms.width = sw;
  ms.height = sh;
  const msctx = ms.getContext("2d", { willReadFrequently: true })!;
  msctx.imageSmoothingEnabled = true;
  msctx.drawImage(mc, 0, 0, sw, sh);
  const mdata = msctx.getImageData(0, 0, sw, sh).data;

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const octx = out.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0);
  const img = octx.getImageData(0, 0, sw, sh);

  const eff = Math.min(0.98, Math.max(0.02, o.threshold - o.edge));
  const f = Math.max(0.005, o.feather);
  for (let p = 0; p < sw * sh; p++) {
    const prob = mdata[p * 4] / 255;
    // smoothstep across [eff - f/2, eff + f/2]
    let t = (prob - (eff - f / 2)) / f;
    t = Math.min(1, Math.max(0, t));
    const a = t * t * (3 - 2 * t);
    img.data[p * 4 + 3] = Math.min(img.data[p * 4 + 3], Math.round(a * 255));
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// AUTO BACKGROUND REMOVAL — free, instant, fully client-side.
//
// Built for graphics on a (near-)solid background: find the dominant border
// colour, then flood-fill inward from the edges clearing everything within
// tolerance of it. Connected-only, so enclosed regions that happen to share
// the background colour (eyes, holes in letters…) are kept. A soft second pass
// fades the 1px anti-aliased fringe left along the cutout edge.
//
// Not an AI matte — hair/soft shadows are out of scope on purpose. For that
// you'd need a segmentation model (server GPU or a multi-MB WASM model); this
// tool's inputs are flat-background graphics, so the algorithm is the fit.

export function removeSolidBackground(img: HTMLImageElement): Promise<HTMLImageElement> {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;

  // --- dominant border colour (quantized vote) -------------------------------
  const votes = new Map<number, number>();
  let transparentBorder = 0;
  let borderCount = 0;
  const vote = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    borderCount++;
    if (d[i + 3] < 128) {
      transparentBorder++;
      return;
    }
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    votes.set(k, (votes.get(k) || 0) + 1);
  };
  for (let x = 0; x < w; x++) {
    vote(x, 0);
    vote(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    vote(0, y);
    vote(w - 1, y);
  }

  // Border already mostly transparent → nothing to remove.
  if (transparentBorder * 2 > borderCount || votes.size === 0) {
    return Promise.resolve(img);
  }
  let bestK = 0;
  let bestN = -1;
  for (const [k, n] of votes) {
    if (n > bestN) {
      bestN = n;
      bestK = k;
    }
  }
  // back to representative RGB (bucket centre)
  const bgR = (((bestK >> 10) & 31) << 3) + 4;
  const bgG = (((bestK >> 5) & 31) << 3) + 4;
  const bgB = ((bestK & 31) << 3) + 4;

  const TOL = 48; // sum-of-abs channel distance that still counts as background
  const near = (i: number) =>
    d[i + 3] >= 128 &&
    Math.abs(d[i] - bgR) + Math.abs(d[i + 1] - bgG) + Math.abs(d[i + 2] - bgB) <= TOL;

  // --- flood fill from the borders ------------------------------------------
  const cleared = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  const seed = (x: number, y: number) => {
    const p = y * w + x;
    if (cleared[p]) return;
    const i = p * 4;
    if (d[i + 3] < 128 || near(i)) {
      cleared[p] = 1;
      queue[qt++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0 && !cleared[p - 1] && near((p - 1) * 4)) {
      cleared[p - 1] = 1;
      queue[qt++] = p - 1;
    }
    if (x < w - 1 && !cleared[p + 1] && near((p + 1) * 4)) {
      cleared[p + 1] = 1;
      queue[qt++] = p + 1;
    }
    if (y > 0 && !cleared[p - w] && near((p - w) * 4)) {
      cleared[p - w] = 1;
      queue[qt++] = p - w;
    }
    if (y < h - 1 && !cleared[p + w] && near((p + w) * 4)) {
      cleared[p + w] = 1;
      queue[qt++] = p + w;
    }
  }

  // --- apply + soften the anti-aliased fringe --------------------------------
  for (let p = 0; p < w * h; p++) if (cleared[p]) d[p * 4 + 3] = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (cleared[p]) continue;
      const i = p * 4;
      if (d[i + 3] === 0) continue;
      const nextToBg =
        (x > 0 && cleared[p - 1]) ||
        (x < w - 1 && cleared[p + 1]) ||
        (y > 0 && cleared[p - w]) ||
        (y < h - 1 && cleared[p + w]);
      if (!nextToBg) continue;
      // fringe pixel: fade it by how close it still is to the background colour
      const dist =
        Math.abs(d[i] - bgR) + Math.abs(d[i + 1] - bgG) + Math.abs(d[i + 2] - bgB);
      if (dist < TOL * 3) {
        d[i + 3] = Math.min(255, Math.round((dist / (TOL * 3)) * 255));
      }
    }
  }

  ctx.putImageData(id, 0, 0);
  return new Promise((resolve, reject) => {
    const out = new Image();
    out.onload = () => resolve(out);
    out.onerror = () => reject(new Error("could not rebuild image"));
    out.src = c.toDataURL("image/png");
  });
}

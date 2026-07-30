# BRX_ARCADE — Session Handoff

A working handoff for continuing this project in a fresh chat. Read this first.

---

## 1. What it is

Two client-side pixel-art tools in one Vite + TS + React single-page app, hash-routed,
linked by the `BRX_ARCADE` title in a top nav. Fully responsive (desktop + mobile).

- **DITHER** (`/`) — drop/add a PNG onto a fixed **600×450** canvas, position/scale it,
  run it through a **rasterize → levels → dither → color → background → CRT** pipeline,
  export a PNG. Entirely client-side.
- **FACE** (`#/face`) — webcam or upload a face → **Gemini** redraws it as a caricature →
  a deterministic **"pixel lock"** finisher (downscale to 144px, B2 dither, 2 colours
  black + `#FF3D00`, background removed) → transparent PNG. Has **V1/V2** versions
  (nav buttons, FACE only). **V2 is the default and the active line of development.**

## 2. Where it lives

- **Live:** https://brx-arcade.vercel.app  (FACE at `https://brx-arcade.vercel.app/#/face`)
- **Repo:** https://github.com/BetterHalfstudio/brx_arcade  (GitHub org: `BetterHalfstudio`)
- **Local:** `/Users/hughk/Documents/AA-BRX_ARCADE/BRX_ARCADE_REPO`
- Branch: `main`. Git user: hughkavanagh / hughkavanagh2@gmail.com.

## 3. Stack & conventions

- **Vite + TypeScript + React.** Canvas 2D for CPU pixel work; **WebGL2** for the CRT.
  Plain CSS, no UI kit. **Nearest-neighbor everywhere** (`imageSmoothingEnabled=false`,
  GL `NEAREST`).
- **All theme values live in `src/theme.css`** (colours, spacing, font, panel width) —
  re-skinning is a one-file change. Font: VCR_OSD_MONO (`public/fonts/`).
- Palette/colours come from the original hero reference (near-black field, cream, teal
  `#29a7af`, orange-red `#ef4a20` / `#ff3d00`).
- `npm run dev` (UI only — `/api/*` does NOT run under Vite dev), `npm run build`
  (`tsc --noEmit && vite build`).

## 4. File map (the important ones)

```
api/stylize.ts            Vercel serverless function → calls Gemini (key server-side),
                          labels the two images, returns image + a debug echo
src/App.tsx               shell: hash router + faceVersion state
src/router.ts             minimal hash router ("/" and "/face")
src/components/TopNav.tsx  nav: DITHER/FACE tabs + V1/V2 version buttons (FACE only)
src/tools/DitherTool.tsx   the dither tool (Delete key clears image)
src/tools/FaceTool.tsx     the face tool (steps, refine tools, levels, stylize)
src/state/{types,defaults,store}.ts   central state + helpers
src/pipeline/{rasterize,levels,dither,gradientMap,pipeline}.ts   the dither pipeline
src/crt/{crt.ts,shaders.ts}           WebGL2 CRT post-process
src/canvas/{Engine.ts,CanvasStage.tsx}  imperative render engine + canvas interaction
src/face/versions.ts       FACE versions: prompts, style-ref urls, bg-removal mode
src/face/finisher.ts       pixel-lock: downscale, bg removal (flood/chroma), 2-colour
src/face/api.ts            client → /api/stylize + image helpers
src/theme.css              single re-skin point
src/styles.css             layout + the mobile media query (@media max-width:760px)
public/style-ref.webp      V1 style reference (orange)
public/style-ref-2.png     V2 style reference (grayscale on #0047BB) — see caching note
```

## 5. The FACE pipeline (how it actually works)

1. **Input** — webcam capture or file upload → a source image.
2. **Stylize** — POST to `/api/stylize` with: the face (base64), the prompt, and the
   bundled style reference. The function sends Gemini, in order: a text label, the face
   image, a text label, the style-ref image, the prompt. Returns the generated image.
3. **Pixel lock** (`src/face/finisher.ts`, deterministic, the consistency lever):
   downscale to 144px → remove background → apply levels → 1-bit threshold dither (FS/B2)
   → remap the two tones to black + `#FF3D00`. Transparent cutout out.
4. **Export** — transparent PNG.

**V1 vs V2** (`src/face/versions.ts`):
- **V1**: keeps colour; transparent-background prompt; background removed by border
  flood-fill; `style-ref.webp`.
- **V2** (default): grayscale subject on a solid `#0047BB` blue; background removed by
  **blue chroma-key** (removes blue-dominant pixels → robust vs floating pixels / filled
  backgrounds); the long editorial-caricature prompt; `style-ref-2.png`.

**FACE refine tools (TEMPORARY — to be removed once V2 is dialled in):**
RAW PREVIEW toggle (shows raw Gemini output pre-dither), FS/B2 dither selector, SWAP REF
(upload a different reference live), and the levels sliders. Current default levels:
**BLACK PT 0, WHITE PT 165, GAMMA 0.10, THRESHOLD 124, dither B2.**

## 6. Gemini integration

- **Model:** `gemini-2.5-flash-image` (~$0.04/image, image-to-image editing). Override via
  `GEMINI_IMAGE_MODEL` env. (The $0.02 "fast" tier = Imagen 4 Fast, which is text-to-image
  only and can't take the input face, so it's not usable here. Batch mode is ~$0.02 but
  has a 24h turnaround — not interactive.)
- **Key:** `GEMINI_API_KEY` set in **Vercel → Project → Settings → Environments →
  Production**. Required for the AI step; the client never sees it. Locally, the function
  only runs under `vercel dev` with a `.env` — plain `npm run dev` won't run the AI step,
  so test the AI on the deployed site.
- **Debug echo:** `/api/stylize` returns `debug` = the exact ordered request parts (labels
  + image byte sizes) + Gemini's `usageMetadata` (input token count). FaceTool logs the
  full payload to the console and shows `✓ GEMINI GOT N IMAGES · STYLE REF NKB · M INPUT
  TOKENS` after each stylize — proof the reference is transmitted, labelled, and counted.

## 7. Deploy workflow & gotchas

- **Deploy = `git push` to `main`** → Vercel auto-builds (~20–30s).
- **STALL GOTCHA:** occasionally the GitHub→Vercel webhook doesn't fire and a push doesn't
  trigger a build (production keeps serving the old bundle). Fix: push an **empty commit**
  (`git commit --allow-empty -m "redeploy"`) or hit **Redeploy** in the Vercel dashboard.
  Confirm a deploy by checking the live JS/CSS hash changed (or a unique new string is
  served).
- `gh` CLI login fails (the available token lacks `read:org`). Repo/PR operations were done
  via the **GitHub REST API** with the token, but day-to-day you only need `git push`
  (osxkeychain has the credential). If the token expires, refresh it.
- `vercel.json` pins `buildCommand: vite build` (skips `tsc` on Vercel).

## 8. Decisions & gotchas worth knowing

- **The deterministic finisher is the consistency guarantee.** Gemini owns the
  *illustration*; the 2-colour + palette + chroma-key + 144px crush owns the *brand look*.
  Even if the AI varies, the finisher normalizes it.
- **Replacing a FACE reference image:** bump the `?v=N` query on the `styleRef` url in
  `versions.ts` (the browser fetches it client-side and would otherwise cache the old one).
- **Prompt textarea auto-grow** needs `scrollbar-gutter: stable` on `.panel` — the panel's
  scrollbar appearing/disappearing changes width and breaks the height measurement.
- **Mobile** (`@media max-width:760px`): column layout, canvas/preview on top via flex
  `order`, controls scroll below, sticky export, bigger touch targets. Canvas supports
  one-finger drag + two-finger pinch-to-scale (`touch-action:none` on `.stage__overlay`).
- **Image labels matter:** Gemini gets two images (subject + style ref); without clear
  text labels it confuses them. See `api/stylize.ts` part assembly.

## 9. CURRENT OPEN ISSUE — FACE V2 inconsistency (DIAGNOSED)

**Symptom:** identical inputs, ~3/4 come out as a correct flat illustration, ~1/4 comes out
**photorealistic** (a desaturated/filtered photo — drawn style not applied). Identity is
fine in all; only *style application* varies.

**Root cause (confirmed by a multi-agent diagnosis + adversarial verify):** Gemini 2.5
Flash Image defaults to image-EDIT mode on a photo and stochastically samples its transform
strength; `api/stylize.ts` sends only `responseModalities:["IMAGE"]` (no seed/temperature),
so ~1 in 4 runs takes the low-transform branch and just desaturates the selfie. The prompt
*allows* it: it never makes "this is a drawing, not a photo" a hard early constraint, every
clause is also satisfiable by a high-contrast desaturated photo, "preserve identity" is the
sole top priority (cheapest to satisfy by NOT redrawing), and "the attached image" is
ambiguous (two images attached).

**Key insight from the adversarial pass:** do NOT lead with "must not be a photo" (models
weight the noun "photo" over the negation, can backfire). Lead with a **positive medium
noun** (silkscreen / cel-shade) and demand **POSTERIZATION** (count a few flat tones, hard
edges, zero gradients) — a constraint a filtered photo physically cannot meet. "Grayscale"
and "high contrast" are photo-satisfiable and apply zero pressure.

**TWO parts to the fix:**

**(A) Hardened prompt + labels — ready to apply** (from the verified workflow output).
Replace `V2_PROMPT` in `src/face/versions.ts` and the two image-role labels in
`api/stylize.ts`. The full text is in **Appendix A** below.

**(B) Structural mitigation — text alone CANNOT reach 100%** (no seed/temperature). Add a
**best-of-N or detect-and-reroll** around the `stylize()` call in `FaceTool.tsx`, scoring
the RAW Gemini output with a cheap canvas **illustration score** (count distinct luma
buckets + histogram bimodality — posterized illustration vs continuous-tone photo separate
cleanly). N=2 collapses ~1-in-4 → ~1-in-16. ⚠️ The downstream finisher is **NOT** a safety
net: `facePixelArt()` is a 1-bit luma threshold and `removeChromaBackground()` keys only
blue, so a photoreal output (no white keyline, smooth ramps) becomes a speckled,
broken-edged sprite — gate/flag export on the illustration score instead of shipping it.

## 10. Roadmap / next steps

1. Apply the hardened V2 prompt + image labels (from the diagnosis workflow). Re-test.
2. Once V2 reliably produces good results: **strip the temporary FACE refine tools**
   (RAW PREVIEW, SWAP REF, dither selector) and the levels/threshold sliders, and hard-code
   the winning values. End goal: a no-user-input, consistent FACE tool.
3. Optional: best-of-N or auto-reroll for residual variance; SSH keys to drop the GitHub
   token dependency; abuse rate-limiting on `/api/stylize` before any public scale.

---

_Tip for the next chat: this repo is Claude-Code-friendly. Point the new session at this
file, then at `src/face/versions.ts`, `src/face/finisher.ts`, and `api/stylize.ts` for the
FACE work._

---

## Appendix A — hardened V2 prompt + image labels (ready to apply)

Produced by the diagnosis workflow and adversarially verified. **Not yet applied** — review
first (the aggressive "posterize to 3–5 flat tones" can occasionally cost identity nuance;
eyeball a few runs). Preserves the user's artistic intent (exaggeration, upper-left key
light, framing, `#0047BB`, white keyline) and adds the posterization/medium/role hardening.

### A1 — `V2_PROMPT` (replace in `src/face/versions.ts`)

```text
Make a SILKSCREEN / VECTOR CEL-SHADE ILLUSTRATION — hand-drawn poster art, the kind made of a few flat blocks of tone with hard edges and a clean outline. That medium is the single most important requirement and overrides everything else below.

Build the entire image out of flat, posterized tone: reduce all shading to roughly three to five solid tone regions with hard, crisp borders between them. There must be ZERO smooth gradients, zero continuous tonal ramp, zero soft photographic falloff, and zero fine texture anywhere — if any region fades smoothly from light to dark instead of snapping at a hard edge, the image is wrong and must be redrawn as flat shapes. Every shadow is a deliberate solid shape, not a blur.

Two requirements are mandatory and equal: (1) the output is unmistakably a flat, posterized, cel-shaded illustration as described above — never a photograph, never a filtered or desaturated version of the input; (2) the person stays immediately recognizable. If these ever seem to conflict, resolve it by drawing MORE — flatten and stylize harder — never by keeping photographic detail.

Roles of the two supplied images. The first supplied image (the second item in this request) is the IDENTITY SOURCE: read ONLY the person's facial geometry, proportions, and distinctive features from it. Do not carry over its surface qualities — discard its skin texture, pores, hair strands, depth of field, photographic lighting, and all of its smooth tonal gradients. Treat it as a 3-D reference you are illustrating from, not an image to recolor. The second supplied image (the fourth item in this request) is the OUTPUT-MEDIUM AUTHORITY: the finished result must be drawn in exactly its technique — flat posterized cel-shading, hard-edged shadow shapes, limited tones, and a thick clean white keyline around the silhouette. Take ONLY the drawing technique, palette, finish, and framing from it; completely ignore the face, person, and identity it depicts, which are a different person used purely as a style sample.

Reconstruct the lighting as illustration, do not copy it: imagine a single hard key light from the upper left and DRAW the result as large, connected, solid shadow masses against bright lit areas — deep blacks, bright whites, almost no mid-tones, very little ambient fill. Keep this lighting scheme identical across every portrait regardless of the subject. The light must read as drawn flat shapes, not as a photograph's soft shading.

Redesign the face as a bold caricature. Exaggerate the most distinctive features — head shape, jaw, chin, brow, nose, ears, forehead, cheekbones, hairline, hairstyle, neck, and overall facial proportions — pushing well past a subtle likeness and prioritizing strong, simplified shape design over realism, while keeping the person instantly recognizable. Render hair as a few solid flat shapes, not individual strands; render skin as flat tone regions with hard edges, not as photographic skin. Avoid oversized anime eyes. Add a slightly exaggerated expression that amplifies the subject's natural personality without changing the underlying emotion.

Surround the entire silhouette with a thick, clean, uniform white keyline (outline). Frame consistently: centered, facing forward, cropped at the upper chest, with the bottom edge following the natural silhouette of the shoulders or clothing rather than a straight horizontal cut. Large head, narrow neck, simplified shoulders.

Place the portrait on a completely flat, solid #0047BB blue background. No gradients, textures, patterns, objects, scenery, text, or extra colors.

Self-check before finishing: Can you count the distinct tones on the face on one hand? Are all tone boundaries hard edges with no smooth fade? Is there a clean white keyline around the whole figure? Is there no visible skin texture, pore, or photographic grain anywhere? If any answer is no — especially if the result still resembles the input photo with a grayscale or high-contrast filter applied — discard it and redraw the subject from scratch as flat, posterized, cel-shaded poster art.
```

### A2 — image labels (replace the two `text` parts in `api/stylize.ts`)

**IMAGE 1 (precedes the subject photo):**
```text
FIRST IMAGE = IDENTITY SOURCE ONLY. Read this person's facial geometry, proportions, and distinctive features, and nothing else. Do NOT carry this image's surface into the output: ignore its skin texture, pores, hair strands, depth of field, lighting, and all smooth tonal gradients. The output is a brand-new flat, posterized, cel-shaded illustration of this person drawn from scratch — never a recolored, filtered, or desaturated copy of what you see here. Use it the way an illustrator uses a reference for the head only:
```

**IMAGE 2 (precedes the style reference):**
```text
SECOND IMAGE = REQUIRED OUTPUT MEDIUM. The finished result MUST be drawn in exactly this technique: a flat, posterized, cel-shaded illustration built from only a few solid tone regions with hard crisp edges, large connected shadow shapes, no smooth gradients, and a thick clean white keyline around the whole silhouette. Copy ONLY this drawing technique, tonal flatness, palette, finish, and framing. Completely IGNORE the face, person, and identity shown here — it is a different person included purely as a style sample, never the subject:
```

### A3 — residual risk (why text isn't enough)
The endpoint is nondeterministic (no seed/temperature exposed), so wording cannot reach
0% failure. Pair the prompt with **best-of-N / detect-and-reroll** using a canvas
illustration score on the RAW output (see §9-B). Also note the harder posterize demand can
occasionally over-flatten and cost identity nuance — review a few runs before locking it.

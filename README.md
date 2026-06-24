# BRX_ARCADE

A fully client-side, static pixel-art processing tool. Drop a PNG onto a fixed
**600×450** canvas, position/scale it, run it through a **dither → color → CRT**
pipeline, and export a PNG. No backend — builds to static files.

## Run

```bash
npm install
npm run dev      # vite dev server
npm run build    # type-check + static build to dist/
npm run preview  # preview the built dist/
```

`dist/` is plain static files (relative asset paths) — host anywhere.

## Stack

- **Vite + TypeScript + React** (panel/state). The canvas + pipeline are
  framework-agnostic.
- **Canvas 2D** for all CPU pixel work (levels, dither, palette, gradient map).
- **WebGL2** for the animated CRT post-process (rAF loop).
- Plain CSS, no UI kit. Nearest-neighbor everywhere
  (`imageSmoothingEnabled = false`, GL `NEAREST`).

## Pipeline

An ordered pipeline, **recomputed from the ORIGINAL source on every update**
(never from prior output). One module per stage in `src/pipeline/`:

1. **rasterize** — draw the placed sprite at its position/scale into the
   600×450 buffer (nearest-neighbor, full color). The source of truth.
2. **levels** — black point / white point / gamma (LUT, pre-dither).
3. **dither** — FS error diffusion or Bayer 2/4/8 ordered, at a resolution
   reduced by the PIXEL SIZE block factor then nearest-upscaled. Color mode is
   set in the Color tab: ORIGINAL COLORS (snap to a median-cut palette of the
   image's own colors), PALETTE (snap to the user palette; 2 slots / duotone
   when Original Colors is off), or B&W 1-bit with a threshold cutoff. Bayer is
   keyed to absolute canvas x,y, so the pattern stays locked to the grid as the
   sprite moves ("re-dither as it moves").
4. **gradientMap** — optional; recolors by luminance, **overriding the palette
   entirely**.
5. **background** — composite step; fills behind the result, or stays
   transparent for export.
6. **CRT** — `src/crt/` GL shader samples the composited buffer and animates.

`src/canvas/Engine.ts` orchestrates: it coalesces pipeline recomputes to one run
per animation frame, paints the flat 600×450 canvas (CSS-scaled, crisp) when CRT
is off, feeds the GL renderer when on, draws the selection overlay, and handles
PNG export.

## Re-skinning (single file)

**All theme values live in [`src/theme.css`](src/theme.css)** — colors, spacing,
`font-family`, panel width, accents, glow. Re-skinning is a one-file change.

- Palette is sampled from hero reference #1 (retro keyboard/terminal): near-black
  field, warm cream keys, bright teal + orange-red accents, warm dark greys.
- Display font is **VCR_OSD_MONO** (`public/fonts/VCR_OSD_MONO.ttf`), declared
  via `@font-face` in `theme.css`.

## Forward-compat

The placed image is modeled as a single `layer` object (`image, x, y, scale`)
even though there is one. Multi-sprite (roadmap) becomes `layers: Layer[]` later
— an array, not a rewrite. `x, y` are the sprite **center** in 600×450 source
space; `scale` is a free multiplier on natural size.

## Export rules

- **CRT OFF** → flat 600×450; background **filled** or **transparent** (toggle).
- **CRT ON** → CRT baked in, background **forced opaque**, export scale
  **1× / 2× / 3×** (default 2× ≈ 1200×900).

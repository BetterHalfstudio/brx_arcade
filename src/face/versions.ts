// FACE tool versions, selectable from the nav. v1 is the current behaviour;
// v2 is the "grayscale subject on a solid chroma background, keyed out by
// colour" approach for cleaner, more consistent isolation; FREE skips the AI
// entirely — in-browser person segmentation + the same dither finisher, $0.

export type BgMode = "flood" | "chroma" | "segment";

export interface PromptPreset {
  label: string;
  text: string;
}

export interface FaceVersion {
  id: number;
  label: string;
  prompts: PromptPreset[]; // first is the default
  styleRef: string; // bundled reference image url
  bg: BgMode; // background-removal strategy in the finisher
}

const V1_PROMPT =
  "Redraw this person as a caricature: slightly exaggerate their most " +
  "distinctive features while keeping them recognizable. Flat illustrated " +
  "style, clean cel shading, limited palette, head-and-shoulders, transparent " +
  "background, no text. Match the style of any reference images.";

const V2_PROMPT =
  "Create an original stylized caricature portrait of the person in the " +
  "subject photo.\n\n" +
  "STYLE — the attached reference image is the single source of truth for how " +
  "this portrait is rendered. Match its visual language exactly: flat graphic " +
  "illustration, grayscale only, high contrast, large connected shadow shapes, " +
  "crisp cel shading, minimal gradients, subtle dry-brush texture inside the " +
  "shadows, and a thick clean white outline around the entire silhouette. Same " +
  "line weight, same shading logic, same finish — as if drawn by the same " +
  "artist with the same tools. Do not copy, trace, or reuse the person or " +
  "composition shown in the reference; only its art style.\n\n" +
  "LIKENESS — the highest priority is that the subject is recognizable at a " +
  "glance. Work from their actual proportions and their natural expression.\n\n" +
  "CARICATURE — apply a gentle, confident stylization, not a distortion: " +
  "simplify shapes boldly, and exaggerate only the one or two most distinctive " +
  "features by a modest amount (roughly 20–30% past realistic — clearly " +
  "stylized, never grotesque). Everything else stays close to the person's " +
  "real proportions. Prefer strong graphic shape design over exaggeration. " +
  "The tone is warm, playful arcade art the subject would happily use as " +
  "their avatar — never mockery.\n\n" +
  "IMPORTANT — never exaggerate features in a way that could echo ethnic, " +
  "racial, gender, age, or body stereotypes. If a distinctive feature overlaps " +
  "with such a stereotype, draw it realistically instead of exaggerating it. " +
  "Keep the person dignified.\n\n" +
  "LIGHTING — a single hard key light from the upper left: bold directional " +
  "shadows in large connected masses, deep blacks, bright whites, almost no " +
  "midtones, very little ambient fill. Keep this lighting identical on every " +
  "portrait regardless of the subject.\n\n" +
  "FACE RULES — medium-sized simplified graphic eyes with angular shapes (no " +
  "oversized anime eyes), thick expressive eyebrows, a simplified nose and " +
  "mouth, chunky graphic hair masses, and the subject's natural expression " +
  "only slightly amplified.\n\n" +
  "FRAMING — centered, facing forward, cropped at the upper chest, with the " +
  "bottom edge following the natural silhouette of the shoulders or clothing " +
  "rather than a straight horizontal cut. Large head, narrow neck, simplified " +
  "shoulders.\n\n" +
  "BACKGROUND — completely flat, solid #0047BB blue. No gradients, textures, " +
  "patterns, objects, scenery, text, or additional colors.\n\n" +
  "The result should read as a fresh portrait by the reference's artist — the " +
  "reference's style, this person's face.";

export const FACE_VERSIONS: FaceVersion[] = [
  {
    id: 1,
    label: "V1",
    prompts: [{ label: "STD", text: V1_PROMPT }],
    styleRef: "/style-ref.webp",
    bg: "flood",
  },
  {
    id: 2,
    label: "V2",
    prompts: [{ label: "V2", text: V2_PROMPT }],
    // ?v bump busts the browser cache when the reference image is updated
    styleRef: "/style-ref-2.png?v=2",
    bg: "chroma",
  },
  {
    id: 3,
    label: "FREE",
    prompts: [], // no AI step — segmentation + finisher only
    styleRef: "",
    bg: "segment",
  },
];

export function faceVersion(id: number): FaceVersion {
  return FACE_VERSIONS.find((v) => v.id === id) ?? FACE_VERSIONS[0];
}

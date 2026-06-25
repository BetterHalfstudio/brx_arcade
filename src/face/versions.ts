// FACE tool versions, selectable from the nav. v1 is the current behaviour;
// v2 is the "grayscale subject on a solid chroma background, keyed out by
// colour" approach for cleaner, more consistent isolation.

export type BgMode = "flood" | "chroma";

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
  "Redraw this person as a caricature in the exact style of the single attached " +
  "reference image: flat, illustrative BLACK AND WHITE (grayscale only, no " +
  "colour), bold cel shading with subtle painterly texture and a clean white " +
  "keyline around the figure.\n\n" +
  "Avoid the big anime eyes from the reference but otherwise keep the style of " +
  "the reference image with the cartoony proportions. Strongly exaggerate and " +
  "distort the most prominent features (nose, jaw, brow, ears, hairline) for a " +
  "bold, characterful, comic caricature — push the exaggeration noticeably " +
  "further than a subtle likeness — while keeping the person clearly " +
  "recognizable and stylistically the same as the reference image. Also " +
  "slightly exaggerate the character's facial expression, pushing their " +
  "natural expression a little further for more personality. " +
  "Relight the character to match the lighting, black-and-white levels and " +
  "contrast of the reference image. Place the figure on a completely solid, " +
  "uniform #0047BB blue background — no other colors, no texture, no scenery, " +
  "nothing floating. Frame it like an icon cropped at the upper chest: do not " +
  "cut the body off with a straight horizontal line — let the bottom edge " +
  "follow the natural silhouette of the shoulders, collar or hair, and keep " +
  "that crop point consistent. Centered, no text.";

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
];

export function faceVersion(id: number): FaceVersion {
  return FACE_VERSIONS.find((v) => v.id === id) ?? FACE_VERSIONS[0];
}

// FACE tool versions, selectable from the nav. v1 is the current behaviour;
// v2 is the experimental "grayscale subject on a solid chroma background, keyed
// out by saturation" approach for cleaner, more consistent isolation.

export type BgMode = "flood" | "chroma";

export interface FaceVersion {
  id: number;
  label: string;
  prompt: string;
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
  "keyline around the figure. This is NOT anime or manga — avoid big anime eyes " +
  "and cartoon proportions; keep it a grounded, semi-realistic illustrated " +
  "caricature exactly like the reference. Slightly exaggerate the most " +
  "distinctive features while keeping the person clearly recognizable. Relight " +
  "the character to match the lighting, black-and-white levels and contrast of " +
  "the reference image. Place the figure on a completely solid, uniform #0047BB " +
  "blue background — no other colours, no texture, no scenery, nothing " +
  "floating. Frame it like an icon cropped at the upper chest: do not cut the " +
  "body off with a straight horizontal line — let the bottom edge follow the " +
  "natural silhouette of the shoulders, collar or hair, and keep that crop " +
  "point consistent. Centered, no text.";

export const FACE_VERSIONS: FaceVersion[] = [
  { id: 1, label: "V1", prompt: V1_PROMPT, styleRef: "/style-ref.webp", bg: "flood" },
  { id: 2, label: "V2", prompt: V2_PROMPT, styleRef: "/style-ref-2.png", bg: "chroma" },
];

export function faceVersion(id: number): FaceVersion {
  return FACE_VERSIONS.find((v) => v.id === id) ?? FACE_VERSIONS[0];
}

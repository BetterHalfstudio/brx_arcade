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
  "Create an original editorial caricature portrait of the supplied person.\n\n" +
  "Use the attached image only as a style reference. Match its visual language, " +
  "rendering, lighting, shading, contrast, brushwork, composition, and graphic " +
  "design, but do not recreate, trace, or closely copy the reference image. " +
  "Create a completely new illustration in the same artistic style.\n\n" +
  "The highest priority is preserving the subject's identity while redesigning " +
  "their face as a bold caricature. Aggressively exaggerate the person's most " +
  "distinctive facial features—including head shape, jaw, chin, brow, nose, " +
  "ears, forehead, cheekbones, hairline, hairstyle, neck, and facial " +
  "proportions. Push the exaggeration well beyond a subtle likeness, " +
  "prioritizing strong shape design over realism, while keeping the person " +
  "immediately recognizable.\n\n" +
  "Maintain the style of the reference: flat graphic illustration, grayscale " +
  "only, high contrast, large angular shadow shapes, crisp cel shading, minimal " +
  "gradients, subtle dry-brush texture within the shadows, and a thick clean " +
  "white outline surrounding the entire silhouette.\n\n" +
  "Use a single hard key light from the upper left, producing bold directional " +
  "lighting with large connected shadow masses, deep blacks, bright whites, " +
  "almost no midtones, and very little ambient fill. Keep this lighting " +
  "identical across every portrait regardless of the subject.\n\n" +
  "Avoid oversized anime eyes. Instead, use medium-sized simplified graphic " +
  "eyes with angular shapes, thick expressive eyebrows, a simplified nose and " +
  "mouth, chunky graphic hair masses, and slightly exaggerated facial " +
  "expressions that enhance the subject's natural personality without changing " +
  "the underlying emotion.\n\n" +
  "Frame the portrait consistently: centered, facing forward, cropped at the " +
  "upper chest with the bottom edge following the natural silhouette of the " +
  "shoulders or clothing rather than a straight horizontal cut. Use a large " +
  "head, narrow neck, and simplified shoulders.\n\n" +
  "Place the portrait on a completely flat, solid #0047BB blue background. No " +
  "gradients, textures, patterns, objects, scenery, text, or additional " +
  "colors.\n\n" +
  "This should look like a fresh caricature drawn by the same artist—not a " +
  "grayscale copy of the reference image.";

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

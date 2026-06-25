// Vercel serverless function: proxies a face image to Gemini's image model and
// returns a stylized caricature. The API key stays server-side (never shipped
// to the browser). Lives outside /src so it is not part of the Vite build —
// Vercel compiles /api/* as functions automatically.

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

const DEFAULT_PROMPT =
  "Redraw this person as a caricature: slightly exaggerate their most " +
  "distinctive features while keeping them recognizable. Flat illustrated " +
  "style, clean cel shading, limited palette, head-and-shoulders, transparent " +
  "background, no text. Match the style of any reference images.";

interface InlineImage {
  data: string; // base64 (no data: prefix)
  mimeType?: string;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({
      error:
        "GEMINI_API_KEY is not set. Add it in Vercel → Project → Settings → " +
        "Environment Variables (and redeploy).",
    });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { image, mimeType = "image/jpeg", prompt, styleRefs = [] } = body as {
    image?: string;
    mimeType?: string;
    prompt?: string;
    styleRefs?: InlineImage[];
  };
  if (!image) {
    res.status(400).json({ error: "image (base64) is required" });
    return;
  }

  // Label every image so the model can't confuse the subject photo with the
  // style reference (the reference also contains a face). Subject first (anchors
  // the likeness being redrawn), then each style reference flagged style-only,
  // then the instruction.
  const parts: any[] = [];
  parts.push({
    text:
      "IMAGE 1 — SUBJECT PHOTO. This is the real person to redraw; preserve " +
      "their likeness. Redraw THIS person:",
  });
  parts.push({ inline_data: { mime_type: mimeType, data: image } });
  for (const r of styleRefs) {
    if (r && r.data) {
      parts.push({
        text:
          "IMAGE 2 — ART STYLE REFERENCE ONLY. Copy this illustration style " +
          "exactly (linework, shading, palette, finish, framing). Do NOT use " +
          "the person, face, or identity shown in this reference — it is purely " +
          "a style guide, not the subject:",
      });
      parts.push({ inline_data: { mime_type: r.mimeType || "image/png", data: r.data } });
    }
  }
  parts.push({ text: prompt && prompt.trim() ? prompt : DEFAULT_PROMPT });

  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const j: any = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: j?.error?.message || "Gemini error" });
      return;
    }
    const outParts = j?.candidates?.[0]?.content?.parts || [];
    const imgPart = outParts.find((p: any) => p.inline_data || p.inlineData);
    const out = imgPart ? imgPart.inline_data || imgPart.inlineData : null;
    if (!out?.data) {
      const text = outParts.find((p: any) => p.text)?.text;
      res.status(502).json({ error: text || "No image returned by the model." });
      return;
    }
    res.status(200).json({ image: out.data, mimeType: out.mime_type || out.mimeType || "image/png" });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "request failed" });
  }
}

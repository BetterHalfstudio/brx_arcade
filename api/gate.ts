// Vercel serverless function: password gate for the standalone avatar kiosk.
// POST { pass } → { ok }. The expected password comes from the AVATAR_PASSWORD
// env var (Vercel → Settings → Environment Variables; redeploy to change),
// falling back to a default so the kiosk works before any setup.

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const expected = process.env.AVATAR_PASSWORD || "Hyperagent";
  res.status(200).json({ ok: String(body.pass || "") === expected });
}

// Vercel serverless function: shared community palettes.
// GET  → { palettes: [{ name, stops: [{pos,color}], ts }] }  newest first
// POST { name?, stops } → save one palette → { ok: true }
//
// Storage is Upstash Redis via its REST API (the free tier is plenty) — enable
// it from Vercel → Storage/Marketplace and the env vars appear automatically.
// Both the Vercel-KV names and the Upstash names are accepted. Without them the
// endpoint answers 503 and the client shows a "not set up" note.

const KEY = "brx:palettes";
const KEEP = 200; // stored
const PAGE = 60; // returned per GET
const HEX = /^#[0-9a-f]{6}$/i;

interface StoredStop {
  pos: number;
  color: string;
}

function cfg(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(c: { url: string; token: string }, path: string, body: unknown) {
  const r = await fetch(c.url + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(j?.error || `storage error ${r.status}`);
  return j;
}

/** Validate + normalise incoming stops (sorted, rounded, lowercase hex). */
function cleanStops(raw: unknown): StoredStop[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) return null;
  const out: StoredStop[] = [];
  for (const s of raw) {
    const pos = Number((s as any)?.pos);
    const color = String((s as any)?.color || "");
    if (!Number.isFinite(pos) || pos < 0 || pos > 1 || !HEX.test(color)) return null;
    out.push({ pos: Math.round(pos * 1000) / 1000, color: color.toLowerCase() });
  }
  out.sort((a, b) => a.pos - b.pos);
  return out;
}

const signature = (stops: StoredStop[]) =>
  stops.map((s) => `${Math.round(s.pos * 100)}:${s.color}`).join("|");

export default async function handler(req: any, res: any) {
  const c = cfg();
  if (!c) {
    res.status(503).json({
      error:
        "Shared storage is not set up. In Vercel add the free Upstash Redis " +
        "integration to this project (Storage tab) and redeploy.",
    });
    return;
  }

  try {
    if (req.method === "GET") {
      const j = await redis(c, "", ["LRANGE", KEY, "0", String(PAGE - 1)]);
      const palettes = (Array.isArray(j.result) ? j.result : [])
        .map((s: string) => {
          try {
            return JSON.parse(s);
          } catch {
            return null;
          }
        })
        .filter((p: any) => p && Array.isArray(p.stops));
      res.status(200).json({ palettes });
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const stops = cleanStops(body.stops);
      if (!stops) {
        res.status(400).json({ error: "stops must be 2-12 {pos 0..1, color #rrggbb}" });
        return;
      }
      const name = String(body.name || "")
        .toUpperCase()
        .replace(/[^A-Z0-9 \-_.]/g, "")
        .trim()
        .slice(0, 14);

      // reject exact duplicates of anything already stored
      const sig = signature(stops);
      const existing = await redis(c, "", ["LRANGE", KEY, "0", String(KEEP - 1)]);
      for (const s of Array.isArray(existing.result) ? existing.result : []) {
        try {
          if (signature(cleanStops(JSON.parse(s).stops) || []) === sig) {
            res.status(409).json({ error: "that palette is already saved" });
            return;
          }
        } catch {
          /* ignore malformed entries */
        }
      }

      const item = JSON.stringify({ name, stops, ts: Date.now() });
      await redis(c, "/pipeline", [
        ["LPUSH", KEY, item],
        ["LTRIM", KEY, "0", String(KEEP - 1)],
      ]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "GET or POST only" });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "storage request failed" });
  }
}

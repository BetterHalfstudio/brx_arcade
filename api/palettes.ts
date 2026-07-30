// Vercel serverless function: shared community palettes.
// GET  → { palettes: [{ name, stops: [{pos,color}], ts }] }  newest first
// POST { name?, stops } → save one palette → { ok: true }
//
// Storage: a Redis database provisioned from Vercel → Storage (free tier is
// plenty). Two transports are supported, so any of the marketplace Redis
// products work regardless of the env-var prefix chosen at install time:
//   1. a plain connection string (…REDIS_URL / KV_URL, redis:// or rediss://)
//      → node-redis over TCP (this is what "Redis by Redis Inc." injects)
//   2. an Upstash-style REST pair (…REST_API_URL + …REST_API_TOKEN) → fetch
// Without either, the endpoint answers 503 and the client shows a note.

import { createClient } from "redis";

const KEY = "brx:palettes";
const SEQ = "brx:palettes:seq"; // lifetime counter → stable C01/C02/… labels
const KEEP = 200; // stored
const PAGE = 60; // returned per GET
const HEX = /^#[0-9a-f]{6}$/i;

interface StoredStop {
  pos: number;
  color: string;
}

function redisUrl(): string | null {
  const env = process.env;
  if (env.REDIS_URL) return env.REDIS_URL;
  if (env.KV_URL) return env.KV_URL;
  for (const k of Object.keys(env)) {
    if (k.endsWith("REDIS_URL") && env[k]) return env[k] as string;
  }
  return null;
}

function restCfg(): { url: string; token: string } | null {
  const env = process.env;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { url, token };
  for (const k of Object.keys(env)) {
    if (k.endsWith("REST_API_URL")) {
      const t = env[k.slice(0, -3) + "TOKEN"];
      if (env[k] && t) return { url: env[k] as string, token: t };
    }
  }
  return null;
}

// TCP client is cached across warm invocations.
let tcp: ReturnType<typeof createClient> | null = null;
async function tcpClient(url: string) {
  if (!tcp) {
    tcp = createClient({ url, socket: { connectTimeout: 5000 } });
    tcp.on("error", () => {}); // surfaced via awaited commands instead
  }
  if (!tcp.isOpen) await tcp.connect();
  return tcp;
}

async function rest(c: { url: string; token: string }, path: string, body: unknown) {
  const r = await fetch(c.url + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(j?.error || `storage error ${r.status}`);
  return j;
}

/** newest-first raw entries */
async function storeList(): Promise<string[]> {
  const url = redisUrl();
  if (url) {
    const c = await tcpClient(url);
    return await c.lRange(KEY, 0, KEEP - 1);
  }
  const rc = restCfg();
  if (!rc) throw new Error("no storage");
  const j = await rest(rc, "", ["LRANGE", KEY, "0", String(KEEP - 1)]);
  return Array.isArray(j.result) ? j.result : [];
}

async function storePush(item: string): Promise<void> {
  const url = redisUrl();
  if (url) {
    const c = await tcpClient(url);
    await c.lPush(KEY, item);
    await c.lTrim(KEY, 0, KEEP - 1);
    return;
  }
  const rc = restCfg();
  if (!rc) throw new Error("no storage");
  await rest(rc, "/pipeline", [
    ["LPUSH", KEY, item],
    ["LTRIM", KEY, "0", String(KEEP - 1)],
  ]);
}

/** next lifetime palette number (1-based) — survives trims, never reused */
async function storeNextN(): Promise<number> {
  const url = redisUrl();
  if (url) {
    const c = await tcpClient(url);
    return Number(await c.incr(SEQ));
  }
  const rc = restCfg();
  if (!rc) throw new Error("no storage");
  const j = await rest(rc, "", ["INCR", SEQ]);
  return Number(j.result);
}

const configured = () => Boolean(redisUrl() || restCfg());

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
  if (!configured()) {
    res.status(503).json({
      error:
        "Shared storage is not set up. In Vercel add a free Redis database " +
        "to this project (Storage tab) and redeploy.",
    });
    return;
  }

  try {
    if (req.method === "GET") {
      const palettes = (await storeList())
        .slice(0, PAGE)
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

      // reject exact duplicates of anything already stored
      const sig = signature(stops);
      for (const s of await storeList()) {
        try {
          if (signature(cleanStops(JSON.parse(s).stops) || []) === sig) {
            res.status(409).json({ error: "that palette is already saved" });
            return;
          }
        } catch {
          /* ignore malformed entries */
        }
      }

      const n = await storeNextN();
      await storePush(JSON.stringify({ n, stops, ts: Date.now() }));
      res.status(200).json({ ok: true, n });
      return;
    }

    res.status(405).json({ error: "GET or POST only" });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "storage request failed" });
  }
}

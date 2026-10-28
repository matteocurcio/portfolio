/**
 * portfolio.matteocurcio.com — one Worker for the whole app.
 *
 *   /                 the page (site/index.html, bundled as text)
 *   /api/quote        live prices from Yahoo Finance, server-side (no CORS, no public proxies)
 *   /api/state        GET / PUT the portfolio document, stored in D1 (shared app-data database)
 *   /api/archive      GET lists archived documents (old exports kept for reference), POST adds one
 *
 * Every request, the page included, passes the Cloudflare Access check first and fails closed
 * (src/access.js, same code as bill and inventory). There is no workers.dev or preview URL.
 */
import PAGE from "../site/index.html";
import { verifyAccess } from "./access.js";

const YF = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CACHE_SECONDS = 60; // quotes are fine 1 min stale
const HISTORY_KEEP = 200;
const MAX_DOC_BYTES = 2_000_000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS portfolio_state (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, doc TEXT NOT NULL, saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, saved_by TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS portfolio_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, doc TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by TEXT NOT NULL DEFAULT '')`,
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY, ...extra },
  });
}

// ---------- quotes ----------
async function getQuote(symbol) {
  const url = YF + encodeURIComponent(symbol) + "?interval=1d&range=1d";
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error("yahoo " + res.status);
  const j = await res.json();
  const m = j?.chart?.result?.[0]?.meta;
  const price = m?.regularMarketPrice ?? m?.previousClose;
  if (typeof price !== "number" || !isFinite(price)) throw new Error("no price");
  return { symbol, price, currency: m.currency || null, time: m.regularMarketTime || null };
}

async function quote(url) {
  const cache = { "Cache-Control": "private, max-age=" + CACHE_SECONDS };
  const multi = url.searchParams.get("symbols");
  if (multi) {
    const syms = multi.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const quotes = {};
    await Promise.all(syms.map(async (s) => {
      try { quotes[s] = await getQuote(s); }
      catch (e) { quotes[s] = { symbol: s, error: String(e.message || e) }; }
    }));
    return json({ quotes }, 200, cache);
  }
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return json({ error: "symbol required" }, 400);
  try { return json(await getQuote(symbol), 200, cache); }
  catch (e) { return json({ symbol, error: String(e.message || e) }, 502); }
}

// ---------- state ----------
async function getState(env) {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT doc, version, updated_at FROM portfolio_state WHERE id = 1").first();
  if (!row) return json({ doc: null, version: 0 });
  return json({ doc: JSON.parse(row.doc), version: row.version, updated_at: row.updated_at });
}

async function putState(request, env, email) {
  await ensureSchema(env.DB);
  const text = await request.text();
  if (text.length > MAX_DOC_BYTES) return json({ error: "document too large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "invalid JSON" }, 400); }
  const doc = body?.doc;
  const base = Number(body?.version);
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.tx)) return json({ error: "doc.tx must be an array" }, 400);
  if (!Number.isInteger(base) || base < 0) return json({ error: "version required" }, 400);

  const db = env.DB;
  const next = base + 1;
  const docText = JSON.stringify(doc);
  // Optimistic lock: the write lands only if the stored version is still the one the client saw.
  const results = await db.batch([
    db.prepare(
      `INSERT INTO portfolio_history (version, doc, saved_by)
       SELECT version, doc, updated_by FROM portfolio_state WHERE id = 1 AND version = ?1`).bind(base),
    db.prepare(
      `INSERT INTO portfolio_state (id, doc, version, updated_at, updated_by)
       SELECT 1, ?1, ?2, CURRENT_TIMESTAMP, ?3
       WHERE (?4 = 0 AND NOT EXISTS (SELECT 1 FROM portfolio_state WHERE id = 1))
          OR EXISTS (SELECT 1 FROM portfolio_state WHERE id = 1 AND version = ?4)
       ON CONFLICT (id) DO UPDATE SET doc = excluded.doc, version = excluded.version,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(docText, next, email, base),
    db.prepare(
      `DELETE FROM portfolio_history WHERE id NOT IN (SELECT id FROM portfolio_history ORDER BY id DESC LIMIT ?1)`).bind(HISTORY_KEEP),
  ]);
  if (results[1].meta.changes === 0) {
    const row = await db.prepare("SELECT doc, version FROM portfolio_state WHERE id = 1").first();
    return json({ error: "version conflict", doc: row ? JSON.parse(row.doc) : null, version: row ? row.version : 0 }, 409);
  }
  return json({ ok: true, version: next });
}

// ---------- archive: old documents kept for reference, never loaded as live data ----------
async function archive(request, env, email) {
  await ensureSchema(env.DB);
  if (request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const row = await env.DB.prepare("SELECT id, label, note, created_at, doc FROM portfolio_archive WHERE id = ?1").bind(id).first();
      return row ? json({ ...row, doc: JSON.parse(row.doc) }) : json({ error: "not found" }, 404);
    }
    const { results } = await env.DB.prepare("SELECT id, label, note, created_at, length(doc) AS bytes FROM portfolio_archive ORDER BY id").all();
    return json({ archive: results });
  }
  if (request.method === "POST") {
    let body;
    try { body = JSON.parse(await request.text()); } catch { return json({ error: "invalid JSON" }, 400); }
    const label = String(body?.label || "").trim().slice(0, 120);
    if (!label || !body?.doc || !Array.isArray(body.doc.tx)) return json({ error: "label and doc.tx required" }, 400);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO portfolio_archive (label, doc, note, created_by) VALUES (?1, ?2, ?3, ?4)")
      .bind(label, JSON.stringify(body.doc), String(body.note || "").slice(0, 500), email).run();
    return json({ ok: true, added: r.meta.changes === 1 });
  }
  return json({ error: "method not allowed" }, 405, { Allow: "GET, POST" });
}

export default {
  async fetch(request, env) {
    const auth = await verifyAccess(request, env);
    if (!auth.ok) return json({ error: auth.message }, auth.status);

    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (pathname === "/api/quote") return quote(url);
      if (pathname === "/api/state") {
        if (request.method === "GET") return await getState(env);
        if (request.method === "PUT") return await putState(request, env, auth.email);
        return json({ error: "method not allowed" }, 405, { Allow: "GET, PUT" });
      }
      if (pathname === "/api/archive") return await archive(request, env, auth.email);
      if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, 405);
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY },
      });
    } catch (e) {
      console.error(e);
      return json({ error: "server error" }, 500);
    }
  },
};

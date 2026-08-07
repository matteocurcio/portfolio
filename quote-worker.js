/**
 * Cloudflare Worker — portfolio quote endpoint.
 *
 * Fetches live prices from Yahoo Finance server-side, so the browser never
 * hits a CORS wall and you don't depend on public proxies.
 *
 * Endpoints:
 *   GET /api/quote?symbol=SGLE.MI            -> { symbol, price, currency, time }
 *   GET /api/quote?symbols=SGLE.MI,AEGE.MI   -> { quotes: { "SGLE.MI": {...}, ... } }
 *
 * Deploy (one time):
 *   1. npm i -g wrangler && wrangler login
 *   2. Put this file at src/index.js, add the wrangler.toml below.
 *   3. wrangler deploy
 *   4. In Cloudflare dash > Workers > your worker > Settings > Domains & Routes,
 *      add route:  portfolio.matteocurcio.com/api/*
 *   The app already calls /api/quote, so no further config is needed.
 *
 * wrangler.toml:
 *   name = "portfolio-quotes"
 *   main = "src/index.js"
 *   compatibility_date = "2024-01-01"
 */

const YF = "https://query1.finance.yahoo.com/v8/finance/chart/";
const CACHE_SECONDS = 60; // be gentle on Yahoo; quotes are fine 1 min stale

async function getQuote(symbol) {
  const url = YF + encodeURIComponent(symbol) + "?interval=1d&range=1d";
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  if (!res.ok) throw new Error("yahoo " + res.status);
  const j = await res.json();
  const m = j?.chart?.result?.[0]?.meta;
  const price = m?.regularMarketPrice ?? m?.previousClose;
  if (typeof price !== "number" || !isFinite(price)) throw new Error("no price");
  return { symbol, price, currency: m.currency || null, time: m.regularMarketTime || null };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "https://portfolio.matteocurcio.com",
      "Cache-Control": "public, max-age=" + CACHE_SECONDS,
    },
  });
}

export default {
  async fetch(request) {
    const { searchParams, pathname } = new URL(request.url);
    if (!pathname.endsWith("/quote")) return json({ error: "not found" }, 404);

    const multi = searchParams.get("symbols");
    if (multi) {
      const syms = multi.split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);
      const quotes = {};
      await Promise.all(syms.map(async s => {
        try { quotes[s] = await getQuote(s); }
        catch (e) { quotes[s] = { symbol: s, error: String(e.message || e) }; }
      }));
      return json({ quotes });
    }

    const symbol = searchParams.get("symbol");
    if (!symbol) return json({ error: "symbol required" }, 400);
    try { return json(await getQuote(symbol)); }
    catch (e) { return json({ symbol, error: String(e.message || e) }, 502); }
  },
};

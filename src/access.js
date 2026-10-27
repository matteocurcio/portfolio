// Cloudflare Access verification. Same rules as inventory.matteocurcio.com/worker/lib/access.ts.
//
// Access authenticates at the edge, but the Worker does not trust headers on their own:
// it verifies the signed JWT against the team's published keys. This fails closed:
// no configuration, no token, or a bad token all mean no data.
// DEV_OPEN=1 belongs in .dev.vars only, never in production.

const b64urlToBytes = (s) => {
  const b64 = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlToJson = (s) =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

// ACCESS_TEAM_DOMAIN is the team name ("throbbing-disk-e054"); a full hostname also works.
const teamHost = (team) =>
  team.includes(".") ? team : `${team}.cloudflareaccess.com`;

let keyCache = null; // { team, keys: Map<kid, CryptoKey>, fetchedAt }
const KEY_TTL_MS = 60 * 60 * 1000;

async function keysFor(team) {
  if (
    keyCache &&
    keyCache.team === team &&
    Date.now() - keyCache.fetchedAt < KEY_TTL_MS
  )
    return keyCache.keys;
  const res = await fetch(`https://${teamHost(team)}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Could not fetch Access keys (${res.status}).`);
  const { keys } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA") continue;
    map.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    );
  }
  keyCache = { team, keys: map, fetchedAt: Date.now() };
  return map;
}

export async function verifyAccess(request, env) {
  if (env.DEV_OPEN === "1") return { ok: true, email: "local-dev" };

  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud || /^REPLACE/.test(aud) || /^REPLACE/.test(team)) {
    return {
      ok: false,
      status: 503,
      message:
        "Access is not configured on this Worker. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD.",
    };
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(
      request.headers.get("Cookie") ?? "",
    )?.[1];
  if (!token)
    return {
      ok: false,
      status: 403,
      message: "No Access token on this request.",
    };

  const parts = token.split(".");
  if (parts.length !== 3)
    return { ok: false, status: 403, message: "Malformed Access token." };
  const [rawHeader, rawPayload, rawSig] = parts;

  try {
    const header = b64urlToJson(rawHeader);
    if (header.alg !== "RS256")
      return { ok: false, status: 403, message: "Unexpected token algorithm." };

    const key = (await keysFor(team)).get(header.kid ?? "");
    if (!key)
      return {
        ok: false,
        status: 403,
        message: "Access token signed with an unknown key.",
      };

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(rawSig),
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
    );
    if (!valid)
      return {
        ok: false,
        status: 403,
        message: "Access token signature does not verify.",
      };

    const p = b64urlToJson(rawPayload);
    const audiences = Array.isArray(p.aud) ? p.aud : p.aud ? [p.aud] : [];
    if (!audiences.includes(aud))
      return {
        ok: false,
        status: 403,
        message: "Access token is for a different application.",
      };
    if (p.iss !== `https://${teamHost(team)}`)
      return {
        ok: false,
        status: 403,
        message: "Access token from an unexpected issuer.",
      };

    const now = Math.floor(Date.now() / 1000);
    if (typeof p.exp !== "number" || p.exp <= now)
      return {
        ok: false,
        status: 403,
        message: "Access token has expired. Reload to sign in again.",
      };
    if (typeof p.nbf === "number" && p.nbf > now + 60)
      return {
        ok: false,
        status: 403,
        message: "Access token is not valid yet.",
      };

    return { ok: true, email: p.email ?? "unknown" };
  } catch (err) {
    console.error("Access verification failed", err);
    return {
      ok: false,
      status: 403,
      message: "Access token could not be verified.",
    };
  }
}

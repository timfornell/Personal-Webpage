// Träningsdata – prototyp (Cloudflare Worker)
// Hämtar Tims Garmin-data via Garmin Connect Personal API och visar den på en mobilsida.
//
// Hemligheter i Cloudflare (Settings → Variables and Secrets, typ Secret):
//   GARMIN_API_KEY  din Garmin Personal API-nyckel
//   POLICY_AUD      Application Audience (AUD) Tag från Cloudflare Access
//   TEAM_DOMAIN     t.ex. https://ditt-team.cloudflareaccess.com
//
// Valfritt: en D1-databas med bindningen DB (se wrangler.toml) sparar de senaste
// två månadernas pass och dina inställningar.
//
// Sidan släpper bara in förfrågningar med en giltig Cloudflare Access-token.
// Saknas inställningarna svarar den 403, så inget visas innan inloggningen är på.

const GARMIN = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

import PAGE_HTML from "./page.html";

// ---------- Cloudflare Access ----------
let certCache = { keys: null, at: 0 };

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function accessKeys(teamDomain, force) {
  if (!force && certCache.keys && Date.now() - certCache.at < 3600e3) return certCache.keys;
  const r = await fetch(teamDomain.replace(/\/+$/, "") + "/cdn-cgi/access/certs");
  if (!r.ok) throw new Error("Kunde inte hämta Access-nycklar (" + r.status + ")");
  const j = await r.json();
  certCache = { keys: j.keys || [], at: Date.now() };
  return certCache.keys;
}

async function checkAccess(req, env) {
  const aud = (env.POLICY_AUD || "").trim();
  const team = (env.TEAM_DOMAIN || "").trim().replace(/\/+$/, "");
  if (!aud || !team) return { ok: false, msg: "Inloggningen är inte konfigurerad än. Lägg in POLICY_AUD och TEAM_DOMAIN under Settings → Variables and Secrets." };
  const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return { ok: false, msg: "Ingen inloggning. Slå på Cloudflare Access för den här adressen." };
  try {
    const [h, p, s] = jwt.split(".");
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (header.alg !== "RS256") throw new Error("fel algoritm");
    let keys = await accessKeys(team, false);
    let jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) { keys = await accessKeys(team, true); jwk = keys.find(k => k.kid === header.kid); }
    if (!jwk) throw new Error("okänd nyckel");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(h + "." + p));
    if (!valid) throw new Error("ogiltig signatur");
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) throw new Error("fel audience");
    if (payload.iss !== team) throw new Error("fel utfärdare");
    const now = Date.now() / 1000;
    if (!payload.exp || payload.exp < now) throw new Error("utgången inloggning");
    return { ok: true, email: payload.email || "" };
  } catch (e) {
    return { ok: false, msg: "Inloggningen kunde inte verifieras: " + e.message };
  }
}

// ---------- Garmin ----------
let tokenCache = { token: null, exp: 0 };

async function garminToken(env, force) {
  const now = Date.now() / 1000;
  if (!force && tokenCache.token && tokenCache.exp - now > 3600) return tokenCache.token;
  if (!env.GARMIN_API_KEY) throw new HttpError(500, "GARMIN_API_KEY saknas. Lägg in den som Secret under Settings → Variables and Secrets.");
  const r = await fetch(GARMIN + TOKEN_PATH, { method: "POST", headers: { Accept: "*/*", Authorization: "ApiKey " + env.GARMIN_API_KEY.trim() } });
  const text = (await r.text()).trim();
  if (!r.ok) throw new HttpError(502, "Garmin godkände inte nyckeln (HTTP " + r.status + "). Kontrollera att den är rätt kopierad och inte har gått ut. " + text.slice(0, 200));
  let exp = now + 23 * 3600;
  try { exp = JSON.parse(new TextDecoder().decode(b64urlToBytes(text.split(".")[1]))).exp || exp; } catch (e) {}
  tokenCache = { token: text, exp };
  return text;
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function garmin(env, path, params, accept) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const t0 = Date.now();
  let token = await garminToken(env, false);
  let r = await fetch(GARMIN + path + qs, { headers: { Accept: accept || "application/json", Authorization: "Bearer " + token } });
  if (r.status === 401) {
    token = await garminToken(env, true);
    r = await fetch(GARMIN + path + qs, { headers: { Accept: accept || "application/json", Authorization: "Bearer " + token } });
  }
  const ms = Date.now() - t0;
  if (accept) { const buf = await r.arrayBuffer(); return { status: r.status, ms, bytes: buf.byteLength, data: null }; }
  const text = await r.text();
  let data = null, error = null;
  if (r.ok && text.trim()) { try { data = JSON.parse(text); } catch (e) { error = "Svaret var inte JSON"; } }
  if (!r.ok) error = text.slice(0, 300) || ("HTTP " + r.status);
  return { status: r.status, ms, bytes: text.length, data, error };
}

function isoDay(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400e3);
  return d.toISOString().slice(0, 10);
}

// Endpunkter som datakartan testar. Namnet används också för rådata.
function endpoints() {
  const t = isoDay(0), w2 = isoDay(13), d90 = isoDay(89);
  return {
    profil: ["Profilinställningar", "/userprofile-service/userprofile/settings"],
    pulszoner: ["Pulszoner", "/biometric-service/heartRateZones/v2"],
    fitnessalder: ["Fitnessålder", "/fitnessage-service/fitnessage/v2/" + t],
    dagssammanfattning: ["Dagssammanfattning 14 d", "/usersummary-service/v2/dailysummaries", { startDate: w2, endDate: t }],
    somn: ["Sömn 14 d", "/sleep-service/sleep/dailySleepSummariesByDate", { startDate: w2, endDate: t }],
    somn_natt: ["Sömn senaste natten", "/sleep-service/sleep/dailySleep", { date: t }],
    hrv: ["HRV 14 d", "/hrv-service/hrv/daily/" + w2 + "/" + t],
    body_battery: ["Body Battery 14 d", "/wellness-service/wellness/bodyBattery/reports/daily", { startDate: w2, endDate: t }],
    stress: ["Stress 14 d", "/usersummary-service/stats/stress/daily/" + w2 + "/" + t],
    steg: ["Steg 14 d", "/usersummary-service/stats/steps/daily/" + w2 + "/" + t],
    puls_idag: ["Puls i dag", "/wellness-service/wellness/dailyHeartRate", { date: t }],
    spo2: ["SpO2 i dag", "/wellness-service/wellness/daily/spo2acclimation/" + t],
    vikt: ["Vikt 90 d", "/weight-service/weight/range/" + d90 + "/" + t, { includeAll: "true" }],
    wellness_aktiviteter: ["Vardagsaktivitet 14 d", "/wellnessactivity-service/activity/summary/range/" + w2 + "/" + t],
  };
}

function inventory(value, prefix, out) {
  out = out || {};
  const add = (k, typ, filled) => {
    const e = out[k] || (out[k] = { types: [], filled: 0, seen: 0 });
    if (!e.types.includes(typ)) e.types.push(typ);
    e.seen++; if (filled) e.filled++;
  };
  if (Array.isArray(value)) {
    if (!value.length) add(prefix + "[]", "tom lista", false);
    else if (value.every(x => x === null || typeof x !== "object")) add(prefix + "[]", "lista", true);
    for (const x of value) if (x && typeof x === "object") inventory(x, prefix + "[]", out);
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) inventory(value[k], prefix ? prefix + "." + k : k, out);
  } else {
    add(prefix, value === null ? "null" : typeof value, value !== null && value !== "");
  }
  return out;
}

function countRecords(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    for (const k of ["data", "activities", "dailySleepSummaries", "hrvSummaries", "dateWeightList"]) if (Array.isArray(data[k])) return data[k].length;
    return 1;
  }
  return 0;
}

async function searchActivities(env, days) {
  const all = [];
  let last = null;
  for (let i = 0; i < 20; i++) {
    const r = await garmin(env, "/activitylist-service/activities/search/activities", { start: all.length, limit: 100, startDate: isoDay(days), endDate: isoDay(0) });
    last = r;
    if (r.status !== 200 || !Array.isArray(r.data) || !r.data.length) break;
    all.push(...r.data);
  }
  return { activities: all, last };
}

// Räknar objekten i en JSON-lista utan att tolka hela svaret.
function countTopLevel(text) {
  let depth = 0, n = 0, inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inStr) { if (c === 92) i++; else if (c === 34) inStr = false; continue; }
    if (c === 34) inStr = true;
    else if (c === 123 || c === 91) { depth++; if (c === 123 && depth === 2) n++; }
    else if (c === 125 || c === 93) depth--;
  }
  return n;
}

// Samma sökning, men svaren skickas vidare som text utan att tolkas.
// Gratisplanen ger bara några millisekunders CPU per anrop, och att tolka år av pass tar för lång tid.
async function searchActivitiesRaw(env, days) {
  const parts = [];
  let count = 0, status = 200, error = null;
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams({ start: count, limit: 100, startDate: isoDay(days), endDate: isoDay(0) });
    let token = await garminToken(env, false);
    let r = await fetch(GARMIN + "/activitylist-service/activities/search/activities?" + qs, { headers: { Accept: "application/json", Authorization: "Bearer " + token } });
    if (r.status === 401) { token = await garminToken(env, true); r = await fetch(GARMIN + "/activitylist-service/activities/search/activities?" + qs, { headers: { Accept: "application/json", Authorization: "Bearer " + token } }); }
    const text = (await r.text()).trim();
    if (!r.ok) { status = r.status; error = text.slice(0, 300); break; }
    const inner = text.replace(/^\[/, "").replace(/\]$/, "").trim();
    if (!inner) break;
    parts.push(inner);
    const n = countTopLevel(text);
    count += n;
    if (n < 100) break;
  }
  return { body: "[" + parts.join(",") + "]", status, error, count };
}

// ---------- Lagring (Cloudflare D1, bindningen DB) ----------
// Garmin-pass sparas för de senaste RETAIN_DAYS dagarna. Äldre pass hämtas från Garmin vid behov och sparas inte.
// Dina egna data (inställningar, och senare loggade pass) sparas utan tidsgräns.
// Utan bindningen DB fungerar allt som tidigare, direkt mot Garmin.
const RETAIN_DAYS = 62;             // 42 dagars kronisk belastning plus marginal
const SYNC_EVERY_MS = 10 * 60e3;    // fråga Garmin om nya pass högst var tionde minut
const FULL_SYNC_EVERY_MS = 24 * 3600e3; // läs om hela fönstret en gång per dygn, för ändrade och borttagna pass
const ROWS_PER_INSERT = 20;         // D1 tillåter 100 parametrar per fråga, 5 per rad
let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, start_local TEXT NOT NULL, type TEXT, raw TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS activities_start ON activities (start_local)"),
    db.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  ]);
  schemaReady = true;
}

async function metaGet(db, key) { return await db.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first("value"); }
function metaSet(db, key, value) { return db.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value)); }

// Hämtar nya pass från Garmin och sparar dem. Returnerar vad som gjordes.
async function syncRecent(env, force) {
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();
  const last = Number(await metaGet(db, "last_sync") || 0);
  const lastFull = Number(await metaGet(db, "last_full_sync") || 0);
  if (!force && now - last < SYNC_EVERY_MS) return { synced: false };
  const full = force || now - lastFull > FULL_SYNC_EVERY_MS;
  let fromDays = RETAIN_DAYS;
  if (!full) {
    const newest = await db.prepare("SELECT MAX(start_local) AS m FROM activities").first("m");
    if (newest) fromDays = Math.min(RETAIN_DAYS, Math.ceil((now - Date.parse(newest.slice(0, 10) + "T00:00:00Z")) / 86400e3) + 2);
  }
  const { activities, last: lr } = await searchActivities(env, fromDays);
  if (!activities.length && lr && lr.status !== 200) throw new HttpError(502, "Garmin svarade HTTP " + lr.status + ": " + (lr.error || ""));
  const stamp = new Date(now).toISOString();
  const stmts = [];
  if (full) stmts.push(db.prepare("DELETE FROM activities WHERE start_local >= ?1").bind(isoDay(fromDays)));
  for (let i = 0; i < activities.length; i += ROWS_PER_INSERT) {
    const chunk = activities.slice(i, i + ROWS_PER_INSERT);
    const values = chunk.map((_, j) => "(?" + (j * 5 + 1) + ", ?" + (j * 5 + 2) + ", ?" + (j * 5 + 3) + ", ?" + (j * 5 + 4) + ", ?" + (j * 5 + 5) + ")").join(", ");
    const params = chunk.flatMap(a => [a.activityId, String(a.startTimeLocal || ""), (a.activityType && a.activityType.typeKey) || null, JSON.stringify(a), stamp]);
    stmts.push(db.prepare("INSERT INTO activities (id, start_local, type, raw, updated_at) VALUES " + values +
      " ON CONFLICT(id) DO UPDATE SET start_local = excluded.start_local, type = excluded.type, raw = excluded.raw, updated_at = excluded.updated_at").bind(...params));
  }
  stmts.push(db.prepare("DELETE FROM activities WHERE start_local < ?1").bind(isoDay(RETAIN_DAYS)));
  stmts.push(metaSet(db, "last_sync", now));
  if (full) stmts.push(metaSet(db, "last_full_sync", now));
  await db.batch(stmts);
  return { synced: true, full, fetched: activities.length };
}

async function storedActivities(db, days) {
  const { results } = await db.prepare("SELECT raw FROM activities WHERE start_local >= ?1 ORDER BY start_local DESC").bind(isoDay(days)).all();
  return "[" + results.map(r => r.raw).join(",") + "]";
}

async function storageStatus(env) {
  if (!env.DB) return { db: false };
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(start_local) AS oldest, MAX(start_local) AS newest FROM activities").first();
  return { db: true, retainDays: RETAIN_DAYS, stored: row ? row.n : 0, oldest: row && row.oldest, newest: row && row.newest, lastSync: Number(await metaGet(env.DB, "last_sync") || 0) || null };
}

const SETTING_KEY = /^[a-z0-9_-]{1,64}$/;
const MAX_SETTING_BYTES = 64 * 1024;

// ---------- Routing ----------
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const auth = await checkAccess(req, env);
    if (!auth.ok) return new Response(auth.msg, { status: 403, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
    if (req.method !== "GET" && req.method !== "PUT" && req.method !== "POST") return json({ error: "Metoden stöds inte" }, 405);
    if (req.method !== "GET") {
      // Skrivningar bara från sidan själv
      const origin = req.headers.get("Origin");
      if (origin !== url.origin) return json({ error: "Fel ursprung" }, 403);
    }

    try {
      if (url.pathname === "/") {
        return new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS } });
      }
      if (url.pathname === "/manifest.json") {
        return new Response(JSON.stringify({ name: "Träningsdata", short_name: "Träning", start_url: "/", display: "standalone", background_color: "#f3f5f4", theme_color: "#1f3d36" }), { headers: { "content-type": "application/manifest+json" } });
      }
      if (url.pathname === "/api/status") {
        await garminToken(env, false);
        return json({ email: auth.email, garmin: true, tokenExpires: tokenCache.exp, storage: await storageStatus(env) });
      }
      if (url.pathname === "/api/sync" && req.method === "POST") {
        if (!env.DB) return json({ error: "Ingen databas kopplad" }, 400);
        const r = await syncRecent(env, true);
        return json({ ...r, storage: await storageStatus(env) });
      }
      if (url.pathname === "/api/settings") {
        if (!env.DB) return json({ db: false, settings: {} });
        await ensureSchema(env.DB);
        const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const settings = {};
        for (const r of results) { try { settings[r.key] = JSON.parse(r.value); } catch (e) {} }
        return json({ db: true, settings });
      }
      const sm = url.pathname.match(/^\/api\/settings\/([^/]+)$/);
      if (sm && req.method === "PUT") {
        if (!env.DB) return json({ error: "Ingen databas kopplad" }, 400);
        const key = decodeURIComponent(sm[1]);
        if (!SETTING_KEY.test(key)) return json({ error: "Ogiltigt namn" }, 400);
        const text = await req.text();
        if (text.length > MAX_SETTING_BYTES) return json({ error: "För stor inställning" }, 413);
        try { JSON.parse(text); } catch (e) { return json({ error: "Inställningen måste vara JSON" }, 400); }
        await ensureSchema(env.DB);
        await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, text, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (req.method !== "GET") return json({ error: "Metoden stöds inte här" }, 405);
      if (url.pathname === "/api/activities") {
        const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "90", 10) || 90, 1), 3650);
        if (env.DB && days <= RETAIN_DAYS) {
          let note = null;
          try { await syncRecent(env, false); } catch (e) { note = "Kunde inte hämta nya pass från Garmin: " + e.message; }
          const body = await storedActivities(env.DB, days);
          return new Response('{"days":' + days + ',"source":"db"' + (note ? ',"note":' + JSON.stringify(note) : "") + ',"activities":' + body + "}", { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
        }
        const r = await searchActivitiesRaw(env, days);
        if (!r.count && r.status !== 200) return json({ error: "Garmin svarade HTTP " + r.status + ": " + (r.error || "") }, 502);
        return new Response('{"days":' + days + ',"source":"garmin","activities":' + r.body + "}", { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      const m = url.pathname.match(/^\/api\/activity\/(\d+)$/);
      if (m) {
        const [details, workouts] = await Promise.all([
          garmin(env, "/activity-service/activity/" + m[1]),
          garmin(env, "/activity-service/activity/" + m[1] + "/workouts"),
        ]);
        return json({ details: details.data, detailsStatus: details.status, workouts: workouts.data, workoutsStatus: workouts.status });
      }
      if (url.pathname === "/api/probe") {
        const eps = endpoints();
        const results = [];
        const { activities, last } = await searchActivities(env, 90);
        results.push({ id: "aktiviteter", label: "Aktiviteter 90 d", path: "/activitylist-service/activities/search/activities", status: activities.length ? 200 : (last ? last.status : 0), ms: last ? last.ms : 0, records: activities.length, fields: inventory(activities.slice(0, 40), "", {}), error: activities.length ? null : (last && last.error) });
        const types = {};
        const firstOfType = {};
        for (const a of activities) {
          const t = (a.activityType && a.activityType.typeKey) || "okänd";
          types[t] = (types[t] || 0) + 1;
          if (!firstOfType[t] && Object.keys(firstOfType).length < 6) firstOfType[t] = a.activityId;
        }
        for (const [t, id] of Object.entries(firstOfType)) {
          for (const [suffix, label, path] of [["detaljer", "detaljer", "/activity-service/activity/" + id], ["workouts", "workouts (set/övningar)", "/activity-service/activity/" + id + "/workouts"]]) {
            const r = await garmin(env, path);
            results.push({ id: "pass_" + t + "_" + suffix, label: "Senaste " + t + ": " + label, path, status: r.status, ms: r.ms, records: countRecords(r.data), fields: r.data ? inventory(r.data, "", {}) : {}, error: r.error, raw: { activityId: id, kind: suffix } });
          }
        }
        if (activities.length) {
          const id = activities[0].activityId;
          const r = await garmin(env, "/download-service/files/activity/" + id, null, "application/zip, application/x-zip-compressed, application/octet-stream");
          results.push({ id: "fil", label: "Originalfil (FIT) för senaste passet", path: "/download-service/files/activity/" + id, status: r.status, ms: r.ms, records: r.status === 200 ? 1 : 0, bytes: r.bytes, fields: {}, error: r.status === 200 ? null : "HTTP " + r.status });
        }
        for (const [id, [label, path, params]] of Object.entries(eps)) {
          const r = await garmin(env, path, params);
          results.push({ id, label, path, status: r.status, ms: r.ms, records: countRecords(r.data), fields: r.data ? inventory(r.data, "", {}) : {}, error: r.error });
        }
        return json({ generated: new Date().toISOString(), activityCount: activities.length, types, results });
      }
      if (url.pathname === "/api/raw") {
        const ep = url.searchParams.get("ep") || "";
        const id = url.searchParams.get("id");
        const kind = url.searchParams.get("kind");
        if (id && /^\d+$/.test(id)) {
          const r = await garmin(env, "/activity-service/activity/" + id + (kind === "workouts" ? "/workouts" : ""));
          return json({ status: r.status, data: r.data, error: r.error });
        }
        const def = endpoints()[ep];
        if (!def) return json({ error: "Okänd endpunkt" }, 404);
        const r = await garmin(env, def[1], def[2]);
        return json({ status: r.status, data: r.data, error: r.error });
      }
      return json({ error: "Hittades inte" }, 404);
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500);
    }
  },
};

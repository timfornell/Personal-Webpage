// Träningsdata (Cloudflare Worker)
// Hämtar Tims Garmin-data via Garmin Connect Personal API och visar den på en mobilsida.
//
// Hemligheter i Cloudflare (Settings → Variables and Secrets, typ Secret):
//   GARMIN_API_KEY     din Garmin Personal API-nyckel
//   POLICY_AUD         Application Audience (AUD) Tag från Cloudflare Access
//   TEAM_DOMAIN        t.ex. https://ditt-team.cloudflareaccess.com
//   ANTHROPIC_API_KEY  valfri: läser CrossFit-pass från skärmdumpar och ger passförslag
//
// En D1-databas med bindningen DB (se wrangler.toml) sparar de senaste två
// månadernas pass och dygnsdata, och dina egna data utan tidsgräns.
//
// Sidan släpper bara in förfrågningar med en giltig Cloudflare Access-token.
// Saknas inställningarna svarar den 403, så inget visas innan inloggningen är på.

const GARMIN = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

import PAGE_HTML from "./page.html";
import C_CORE from "./client/core.client.js";
import C_CHARTS from "./client/charts.client.js";
import C_METRICS from "./client/metrics.client.js";
import C_FIT from "./client/fit.client.js";
import C_HRQ from "./client/hrq.client.js";
import C_VIEWS from "./client/views.client.js";
import C_ISSUES from "./client/besvar.client.js";
import C_PLAN from "./client/plan.client.js";
import C_CUSTOM from "./client/custom.client.js";
import C_EXTRA from "./client/extra.client.js";
import C_MAIN from "./client/main.client.js";

const PAGE = PAGE_HTML.replace("/*APP*/", () => [C_CORE, C_CHARTS, C_METRICS, C_FIT, C_HRQ, C_VIEWS, C_ISSUES, C_PLAN, C_CUSTOM, C_EXTRA, C_MAIN].join("\n"));

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

async function garminFetch(env, path, params, accept) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  let token = await garminToken(env, false);
  let r = await fetch(GARMIN + path + qs, { headers: { Accept: accept || "application/json", Authorization: "Bearer " + token } });
  if (r.status === 401) {
    token = await garminToken(env, true);
    r = await fetch(GARMIN + path + qs, { headers: { Accept: accept || "application/json", Authorization: "Bearer " + token } });
  }
  return r;
}

async function garmin(env, path, params, accept) {
  const t0 = Date.now();
  const r = await garminFetch(env, path, params, accept);
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
    if (r.data.length < 100) break;
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
    const r = await garminFetch(env, "/activitylist-service/activities/search/activities", { start: count, limit: 100, startDate: isoDay(days), endDate: isoDay(0) });
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

// ---------- Dygnsdata (HRV, vilopuls, sömn, Body Battery, stress) ----------
// Garmins svar är inte dokumenterade här, så tolkningen letar efter poster med ett datum
// och plockar kända fältnamn. Vad som hittades skickas med till sidan.
const DAILY_SOURCES = [
  ["summary", (s, e) => ["/usersummary-service/v2/dailysummaries", { startDate: s, endDate: e }]],
  ["hrv", (s, e) => ["/hrv-service/hrv/daily/" + s + "/" + e]],
  ["sleep", (s, e) => ["/sleep-service/sleep/dailySleepSummariesByDate", { startDate: s, endDate: e }]],
  ["bb", (s, e) => ["/wellness-service/wellness/bodyBattery/reports/daily", { startDate: s, endDate: e }]],
  ["stress", (s, e) => ["/usersummary-service/stats/stress/daily/" + s + "/" + e]],
];
const DAILY_PICKS = {
  summary: { rhr: ["restingHeartRate", "restingHeartRateValue", "restingHR", "rhr"], rhr7: ["lastSevenDaysAvgRestingHeartRate"], stress: ["averageStressLevel", "avgStressLevel", "overallStressLevel"], bbHigh: ["bodyBatteryHighestValue", "highestBodyBattery"], bbLow: ["bodyBatteryLowestValue", "lowestBodyBattery"], bbWake: ["bodyBatteryAtWakeTime", "bodyBatteryWakeValue"], bbCharged: ["bodyBatteryChargedValue"], bbDrained: ["bodyBatteryDrainedValue"], steps: ["totalSteps", "steps"], sleepSec: ["sleepingSeconds", "measurableAsleepDuration"], hrv: ["avgOvernightHrv", "lastNightAvg"] },
  hrv: { hrv: ["lastNightAvg", "lastNightAvgHrv", "avgOvernightHrv", "hrvValue"], hrvWeek: ["weeklyAvg"], hrvLow: ["baseline.balancedLow", "balancedLow"], hrvHigh: ["baseline.balancedUpper", "balancedUpper"], hrvStatus: ["status", "hrvStatus"] },
  sleep: { sleepSec: ["sleepTimeSeconds", "totalSleepSeconds", "sleepTimeInSeconds", "sleepDurationInSeconds", "durationInSeconds", "sleepingSeconds"], sleepScore: ["sleepScores.overall.value", "overallSleepScore", "sleepScore", "sleepScoreValue", "overall.value"], deepSec: ["deepSleepSeconds"], remSec: ["remSleepSeconds"], hrv: ["avgOvernightHrv"], rhr: ["restingHeartRate"] },
  bb: { bbCharged: ["charged"], bbDrained: ["drained"] },
  stress: { stress: ["values.overallStressLevel", "overallStressLevel", "averageStressLevel"] },
};
// Källornas företräde per fält: HRV från HRV-tjänsten först, vilopuls från dagssammanfattningen först.
const DAILY_ORDER = { hrv: ["hrv", "summary", "sleep"], rhr: ["summary", "sleep"], sleepSec: ["sleep", "summary"], stress: ["summary", "stress"] };
const DAILY_RANGE = { rhr: [25, 130], rhr7: [25, 130], hrv: [5, 300], hrvWeek: [5, 300], hrvLow: [5, 300], hrvHigh: [5, 300], sleepSec: [600, 72000], sleepScore: [0, 100], deepSec: [0, 40000], remSec: [0, 40000], stress: [0, 100], bbHigh: [0, 100], bbLow: [0, 100], bbWake: [0, 100], bbCharged: [0, 200], bbDrained: [0, 200], steps: [0, 300000] };
const DATE_KEYS = ["calendarDate", "date", "summaryDate", "calendarDay", "day", "sleepDate"];

function dateOf(o) {
  for (const k of DATE_KEYS) { const v = o[k]; if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10); }
  return null;
}

// Plattar ut alla poster med datum i ett svar till { "2026-10-20": { fält: värde } }.
function collectDaily(data) {
  const out = {};
  const flat = (o, prefix, into, depth) => {
    for (const [k, v] of Object.entries(o)) {
      const p = prefix ? prefix + "." + k : k;
      if (v !== null && typeof v === "object") { if (!Array.isArray(v) && depth < 3 && !dateOf(v)) flat(v, p, into, depth + 1); }
      else if (v !== null) { into[p] = v; if (!(k in into)) into[k] = v; }
    }
  };
  const walk = (node, depth) => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    const d = dateOf(node);
    if (d) flat(node, "", out[d] || (out[d] = {}), 0);
    else {
      const kids = Object.values(node).filter(v => v && typeof v === "object" && !Array.isArray(v) && dateOf(v));
      if (kids.length === 1) {
        const rec = out[dateOf(kids[0])] || (out[dateOf(kids[0])] = {});
        for (const [k, v] of Object.entries(node)) if (v !== null && typeof v !== "object" && !(k in rec)) rec[k] = v;
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, depth + 1);
  };
  walk(data, 0);
  return out;
}

function pickDaily(source, rec) {
  const picks = DAILY_PICKS[source] || {};
  const out = {};
  for (const [field, names] of Object.entries(picks)) {
    for (const n of names) {
      const v = rec[n];
      if (field === "hrvStatus") { if (typeof v === "string" && v) { out[field] = v; break; } continue; }
      const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      const rg = DAILY_RANGE[field];
      if (typeof x === "number" && isFinite(x) && (!rg || (x >= rg[0] && x <= rg[1]))) { out[field] = x; break; }
    }
  }
  return out;
}

function mergeDaily(perSource) {
  const days = {};
  for (const [src, byDate] of Object.entries(perSource)) for (const [d, vals] of Object.entries(byDate)) (days[d] || (days[d] = {}))[src] = vals;
  const out = [];
  for (const [date, bySrc] of Object.entries(days)) {
    const row = { date };
    const fields = new Set(Object.values(bySrc).flatMap(v => Object.keys(v)));
    for (const f of fields) {
      const order = DAILY_ORDER[f] || DAILY_SOURCES.map(s => s[0]);
      for (const s of order.concat(DAILY_SOURCES.map(x => x[0]))) { if (bySrc[s] && bySrc[s][f] != null) { row[f] = bySrc[s][f]; break; } }
    }
    if (Object.keys(row).length > 1) out.push(row);
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

function dayChunks(days, size) {
  const chunks = [];
  for (let from = days - 1; from >= 0; from -= size) chunks.push([isoDay(from), isoDay(Math.max(0, from - size + 1))]);
  return chunks;
}

// Hämtar dygnsdata för de senaste `days` dagarna. `sources` begränsar vilka tjänster som frågas.
async function fetchDaily(env, days, sources) {
  const perSource = {}, status = {};
  const use = DAILY_SOURCES.filter(s => !sources || sources.includes(s[0]));
  await garminToken(env, false);
  await Promise.all(use.map(async ([name, mk]) => {
    const st = status[name] = { status: 200, records: 0, fields: [] };
    const seen = new Set();
    perSource[name] = {};
    for (const [s, e] of dayChunks(days, 28)) {
      const [path, params] = mk(s, e);
      const r = await garmin(env, path, params);
      if (r.status !== 200) { st.status = r.status; st.error = (r.error || "").slice(0, 160); break; }
      if (!r.data) continue;
      const recs = collectDaily(r.data);
      for (const [d, rec] of Object.entries(recs)) {
        for (const k of Object.keys(rec)) if (seen.size < 80 && !k.includes(".")) seen.add(k);
        const vals = pickDaily(name, rec);
        if (Object.keys(vals).length) { perSource[name][d] = { ...(perSource[name][d] || {}), ...vals }; }
      }
    }
    st.records = Object.keys(perSource[name]).length;
    st.fields = [...seen];
    st.found = [...new Set(Object.values(perSource[name]).flatMap(v => Object.keys(v)))];
  }));
  return { days: mergeDaily(perSource), sources: status };
}

// ---------- Lagring (Cloudflare D1, bindningen DB) ----------
// Garmin-pass och dygnsdata sparas för de senaste RETAIN_DAYS dagarna. Äldre data hämtas från Garmin vid behov och sparas inte.
// Dina egna data (inställningar, loggade pass, Persist-arkivet) sparas utan tidsgräns.
// Utan bindningen DB fungerar allt utom det som bara finns i databasen, direkt mot Garmin.
const RETAIN_DAYS = 62;                  // 42 dagars kronisk belastning plus marginal
const SYNC_EVERY_MS = 10 * 60e3;         // fråga Garmin om nya pass högst var tionde minut
const FULL_SYNC_EVERY_MS = 24 * 3600e3;  // läs om hela fönstret en gång per dygn, för ändrade och borttagna pass
const DAILY_SYNC_EVERY_MS = 30 * 60e3;   // dygnsdata, t.ex. nattens HRV, högst varannan halvtimme
const ACT_COLS = 11;
const ROWS_PER_INSERT = 9;               // D1 tillåter 100 parametrar per fråga, 11 per rad
const SCHEMA_VERSION = 2;
let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, start_local TEXT NOT NULL, type TEXT, raw TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS activities_start ON activities (start_local)"),
    db.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS daily (date TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id INTEGER, date TEXT NOT NULL, name TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS logs_date ON logs (date)"),
    db.prepare("CREATE TABLE IF NOT EXISTS persist (id TEXT PRIMARY KEY, track TEXT, pt TEXT, dt TEXT, title TEXT, sort TEXT, data TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS persist_pt ON persist (pt, sort)"),
    db.prepare("CREATE TABLE IF NOT EXISTS items (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (kind, id))"),
  ]);
  const v = Number(await metaGet(db, "schema") || 1);
  if (v < 2) {
    // Färdiga kolumner bredvid rådatan, så att historiken går att söka i utan att tolka JSON
    for (const col of ["duration REAL", "distance REAL", "avg_hr REAL", "max_hr REAL", "calories REAL", "trimp REAL"]) {
      try { await db.prepare("ALTER TABLE activities ADD COLUMN " + col).run(); } catch (e) {}
    }
  }
  if (v < SCHEMA_VERSION) await metaSet(db, "schema", SCHEMA_VERSION).run();
  schemaReady = true;
}

async function metaGet(db, key) { return await db.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first("value"); }
function metaSet(db, key, value) { return db.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value)); }

function edwardsTrimp(a) {
  let t = 0, any = false;
  for (let i = 1; i <= 5; i++) { const v = a["hrTimeInZone_" + i]; if (v != null) { any = true; t += v / 60 * i; } }
  return any ? Math.round(t * 10) / 10 : null;
}
const numOrNull = v => typeof v === "number" && isFinite(v) ? v : null;

function placeholders(rows, cols) {
  return Array.from({ length: rows }, (_, j) => "(" + Array.from({ length: cols }, (_, c) => "?" + (j * cols + c + 1)).join(", ") + ")").join(", ");
}

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
    const params = chunk.flatMap(a => [a.activityId, String(a.startTimeLocal || ""), (a.activityType && a.activityType.typeKey) || null, JSON.stringify(a), stamp,
      numOrNull(a.duration), numOrNull(a.distance), numOrNull(a.averageHR), numOrNull(a.maxHR), numOrNull(a.calories), edwardsTrimp(a)]);
    stmts.push(db.prepare("INSERT INTO activities (id, start_local, type, raw, updated_at, duration, distance, avg_hr, max_hr, calories, trimp) VALUES " + placeholders(chunk.length, ACT_COLS) +
      " ON CONFLICT(id) DO UPDATE SET start_local = excluded.start_local, type = excluded.type, raw = excluded.raw, updated_at = excluded.updated_at, duration = excluded.duration, distance = excluded.distance, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, calories = excluded.calories, trimp = excluded.trimp").bind(...params));
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

async function syncDaily(env, force) {
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();
  const last = Number(await metaGet(db, "last_daily_sync") || 0);
  const lastFull = Number(await metaGet(db, "last_daily_full") || 0);
  if (!force && now - last < DAILY_SYNC_EVERY_MS) return { synced: false };
  const full = force || now - lastFull > FULL_SYNC_EVERY_MS;
  const days = full ? RETAIN_DAYS : 3;
  const r = await fetchDaily(env, days);
  const stamp = new Date(now).toISOString();
  const stmts = [];
  for (let i = 0; i < r.days.length; i += 30) {
    const chunk = r.days.slice(i, i + 30);
    stmts.push(db.prepare("INSERT INTO daily (date, data, updated_at) VALUES " + placeholders(chunk.length, 3) +
      " ON CONFLICT(date) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(...chunk.flatMap(d => [d.date, JSON.stringify(d), stamp])));
  }
  stmts.push(db.prepare("DELETE FROM daily WHERE date < ?1").bind(isoDay(RETAIN_DAYS)));
  stmts.push(metaSet(db, "last_daily_sync", now));
  if (full) { stmts.push(metaSet(db, "last_daily_full", now)); stmts.push(metaSet(db, "daily_sources", JSON.stringify(r.sources))); }
  await db.batch(stmts);
  return { synced: true, full, days: r.days.length, sources: r.sources };
}

async function storageStatus(env) {
  if (!env.DB) return { db: false };
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(start_local) AS oldest, MAX(start_local) AS newest FROM activities").first();
  const daily = await env.DB.prepare("SELECT COUNT(*) AS n FROM daily").first("n");
  const logs = await env.DB.prepare("SELECT COUNT(*) AS n FROM logs").first("n");
  const persist = await env.DB.prepare("SELECT COUNT(*) AS n FROM persist").first("n");
  const { results: kinds } = await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM items GROUP BY kind").all();
  const items = Object.fromEntries(kinds.map(k => [k.kind, k.n]));
  return { db: true, retainDays: RETAIN_DAYS, stored: row ? row.n : 0, oldest: row && row.oldest, newest: row && row.newest, daily, logs, persist, items,
    lastSync: Number(await metaGet(env.DB, "last_sync") || 0) || null, lastDailySync: Number(await metaGet(env.DB, "last_daily_sync") || 0) || null };
}

// Egna poster utan tidsgräns: pulskontroll per pass och besvär
const ITEM_KINDS = { hrcheck: 16 * 1024, issue: 64 * 1024, suggest: 32 * 1024 };
const ITEM_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SETTING_KEY = /^[a-z0-9_-]{1,64}$/;
const MAX_SETTING_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 32 * 1024;

// ---------- CrossFit-pass från screenshot (Claude) ----------
const PARSE_TOOL = {
  name: "spara_pass",
  description: "Spara passet som syns på bilden.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Passets namn eller rubrik, t.ex. 'Fight Gone Bad' eller dagens rubrik. Hitta inte på ett namn: använd rubriken som står." },
      date: { type: ["string", "null"], description: "Datum som syns på bilden, YYYY-MM-DD, annars null" },
      format: { type: "string", enum: ["For time", "AMRAP", "EMOM", "Intervaller", "Rundor", "Styrka", "Annat"] },
      timecap_min: { type: ["number", "null"] },
      parts: { type: "array", description: "Passets delar som de står på bilden", items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] } },
      movements: { type: "array", items: { type: "object", properties: { name: { type: "string" }, reps: { type: ["string", "null"] }, load: { type: ["string", "null"] } }, required: ["name"] } },
      result: {
        type: ["object", "null"], description: "Resultatet om det syns, annars null",
        properties: {
          kind: { type: "string", enum: ["tid", "rundor_reps", "reps", "vikt", "kalorier", "poäng", "annat"] },
          text: { type: "string", description: "Resultatet som det står, t.ex. '12:34' eller '5 + 12'" },
          seconds: { type: ["number", "null"] }, rounds: { type: ["number", "null"] }, reps: { type: ["number", "null"] },
          value: { type: ["number", "null"] }, unit: { type: ["string", "null"] },
        },
        required: ["kind", "text"],
      },
      scaled: { type: "string", enum: ["Rx", "Scaled", "Okänt"] },
      notes: { type: ["string", "null"] },
    },
    required: ["name", "format", "parts", "movements", "scaled"],
  },
};

async function parseScreenshot(env, image) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(400, "ANTHROPIC_API_KEY saknas. Lägg in den som Secret i Cloudflare för att läsa bilder, eller fyll i passet för hand.");
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image || "");
  if (!m) throw new HttpError(400, "Bilden måste vara JPEG, PNG, WebP eller GIF");
  if (m[2].length > 6.5e6) throw new HttpError(413, "Bilden är för stor");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: (env.ANTHROPIC_MODEL || "claude-sonnet-5-5").trim(),
      max_tokens: 2500,
      tools: [PARSE_TOOL],
      tool_choice: { type: "tool", name: "spara_pass" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
        { type: "text", text: "Bilden är en skärmdump av ett CrossFit- eller gympass. Skriv av passet med verktyget spara_pass. Ta bara med det som syns på bilden och gissa inte på resultat, vikter eller datum som inte står där. Behåll rörelsernas namn på originalspråket." },
      ] }],
    }),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  if (!r.ok) throw new HttpError(502, "Claude svarade HTTP " + r.status + ": " + ((j && j.error && j.error.message) || text.slice(0, 200)));
  const use = j && Array.isArray(j.content) && j.content.find(c => c.type === "tool_use");
  if (!use) throw new HttpError(502, "Claude gav inget pass tillbaka");
  return { parsed: use.input, model: j.model };
}

// ---------- Passförslag (Claude) ----------
// Sidan skickar en sammanfattning den själv räknat fram (nivå, belastning, besvär, veckans pass) och
// vilka kategorier som finns i Persist-arkivet. Claude svarar med en struktur och filter, inte med
// övningar. Sidan filtrerar sedan arkivet själv, och du väljer passet. Inga pass skickas till Claude.
const REGION_IDS = ["ben", "drag", "tryck", "bal"];
function suggestTool(cats) {
  const cat = cats.length ? { type: "string", enum: cats } : { type: "string" };
  return {
    name: "foreslag_struktur",
    description: "Ge en struktur för dagens pass och filter för att välja pass ur arkivet.",
    input_schema: {
      type: "object",
      properties: {
        rubrik: { type: "string", description: "Kort namn på passtypen, t.ex. 'Lugn överkroppsstyrka och kort metcon'" },
        bedomning: { type: "string", enum: ["passar", "passar med anpassning", "avråder"], description: "Hur väl önskemålet passar dagens läge" },
        varfor: { type: "string", description: "2–4 meningar om varför, med hänvisning till mätvärdena i underlaget" },
        intensitet: { type: "string", enum: ["lätt", "måttlig", "hård"] },
        puls: { type: ["string", "null"], description: "Pulsriktmärke i slag per minut om det är relevant, räknat ur maxpulsen i underlaget" },
        struktur: { type: "array", description: "Passets delar i ordning, utan specifika övningar", items: { type: "object", properties: { del: { type: "string" }, innehall: { type: "string", description: "Längd, fokus, intensitet och vad som ska undvikas" } }, required: ["del", "innehall"] } },
        filter: {
          type: "object",
          properties: {
            kategorier: { type: "array", items: cat, description: "Passkategorier ur arkivet som passar, tom lista om inget arkivpass passar (t.ex. löpning)" },
            langd_min: { type: ["number", "null"] }, langd_max: { type: ["number", "null"] },
            fokus_undvik: { type: "array", items: { type: "string", enum: REGION_IDS }, description: "Kroppsdelar som inte ska vara passets huvudfokus" },
            fokus_helst: { type: "array", items: { type: "string", enum: REGION_IDS }, description: "Kroppsdelar som gärna får vara huvudfokus" },
          },
          required: ["kategorier", "fokus_undvik", "fokus_helst"],
        },
        undvik: { type: "array", items: { type: "string" } },
      },
      required: ["rubrik", "bedomning", "varfor", "intensitet", "struktur", "filter", "undvik"],
    },
  };
}
const SUGGEST_SYSTEM = [
  "Du är en erfaren tränare som hjälper en person som tränar CrossFit, styrka och löpning att välja dagens pass.",
  "Du får ett underlag som sidan har räknat fram: dagens beredskapsnivå med skäl, sidans egna gör/undvik-regler, belastning, återhämtningsdata, besvär som personen själv graderat och passen de senaste sju dagarna.",
  "Du ska inte skriva ett pass med övningar. Svara med en struktur för passet och filter som sidan använder för att välja pass ur personens Persist-arkiv. Personen väljer själv passet.",
  "Regler:",
  "1. Använd bara uppgifterna i underlaget. Hitta inte på mätvärden, vikter, RPE eller historik.",
  "2. Kroppsdelarna är ben, drag (rygg och dragövningar), tryck (bröst, axlar, pressar) och bal (bålen). CrossFit använder hela kroppen, så en kroppsdel som belastats tungt nyligen ska inte vara huvudfokus, men behöver inte undvikas helt.",
  "3. Besvär på nivå 3 betyder att kroppsdelen inte ska vara huvudfokus och att övningar som gör ondare ska bytas. Nivå 4 betyder att den inte ska belastas. Är ett besvär värre dagen efter ett pass, minska den typen av belastning.",
  "4. Om önskemålet inte passar dagens läge, till exempel hårt på en Vila-dag, sätt bedomning till avråder, säg varför rakt och ge struktur och filter för en lättare variant. Lyd inte bara.",
  "5. Välj bara kategorier som finns i listan. Passar inget arkivpass, till exempel för löpning, lämna kategorier tom och beskriv passet i strukturen.",
  "6. Ställ inga diagnoser. Vid besvär som stoppar träning, föreslå att låta en fysioterapeut titta på det.",
  "7. Skriv på svenska, kort och konkret.",
].join("\n");

async function suggestSession(env, body) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(400, "ANTHROPIC_API_KEY saknas i Cloudflare.");
  const cats = (Array.isArray(body.categories) ? body.categories : []).filter(c => typeof c === "string" && c.length <= 60).slice(0, 30);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: (env.ANTHROPIC_MODEL || "claude-sonnet-5-5").trim(),
      max_tokens: 2000,
      system: SUGGEST_SYSTEM,
      tools: [suggestTool(cats)],
      tool_choice: { type: "tool", name: "foreslag_struktur" },
      messages: [{ role: "user", content: "Önskemål: " + JSON.stringify(body.request || {}) + "\n\nKategorier i arkivet: " + JSON.stringify(cats) + "\n\nUnderlag:\n" + JSON.stringify(body.context || {}) }],
    }),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  if (!r.ok) throw new HttpError(502, "Claude svarade HTTP " + r.status + ": " + ((j && j.error && j.error.message) || text.slice(0, 200)));
  const use = j && Array.isArray(j.content) && j.content.find(c => c.type === "tool_use");
  if (!use) throw new HttpError(502, "Claude gav inget förslag tillbaka");
  return { suggestion: use.input, model: j.model, usage: j.usage || null };
}

function logRow(r) {
  let data = {}; try { data = JSON.parse(r.data); } catch (e) {}
  return { id: r.id, activityId: r.activity_id, date: r.date, name: r.name, data, createdAt: r.created_at, updatedAt: r.updated_at };
}

function validLog(body) {
  if (!body || typeof body !== "object") return "Ogiltig post";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "")) return "Datum saknas";
  if (body.activityId != null && !/^\d{1,20}$/.test(String(body.activityId))) return "Ogiltigt pass-id";
  if (JSON.stringify(body.data || {}).length > MAX_LOG_BYTES) return "Posten är för stor";
  return null;
}

async function readJson(req, limit) {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "För stor förfrågan");
  try { return JSON.parse(text); } catch (e) { throw new HttpError(400, "Förfrågan måste vara JSON"); }
}

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

const needDb = env => { if (!env.DB) throw new HttpError(400, "Ingen databas kopplad"); };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const auth = await checkAccess(req, env);
    if (!auth.ok) return new Response(auth.msg, { status: 403, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
    if (!["GET", "PUT", "POST", "DELETE"].includes(req.method)) return json({ error: "Metoden stöds inte" }, 405);
    if (req.method !== "GET") {
      // Skrivningar bara från sidan själv
      const origin = req.headers.get("Origin");
      if (origin !== url.origin) return json({ error: "Fel ursprung" }, 403);
    }
    const path = url.pathname;

    try {
      if (path === "/") {
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS } });
      }
      if (path === "/manifest.json") {
        return new Response(JSON.stringify({ name: "Träningsdata", short_name: "Träning", start_url: "/", display: "standalone", background_color: "#f3f5f4", theme_color: "#1f3d36" }), { headers: { "content-type": "application/manifest+json" } });
      }
      if (path === "/api/status") {
        await garminToken(env, false);
        return json({ email: auth.email, garmin: true, tokenExpires: tokenCache.exp, claude: !!env.ANTHROPIC_API_KEY, storage: await storageStatus(env) });
      }
      if (path === "/api/sync" && req.method === "POST") {
        needDb(env);
        const r = await syncRecent(env, true);
        let daily = null;
        try { daily = await syncDaily(env, true); } catch (e) { daily = { error: e.message }; }
        return json({ ...r, daily, storage: await storageStatus(env) });
      }

      // Inställningar
      if (path === "/api/settings") {
        if (!env.DB) return json({ db: false, settings: {} });
        await ensureSchema(env.DB);
        const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const settings = {};
        for (const r of results) { try { settings[r.key] = JSON.parse(r.value); } catch (e) {} }
        return json({ db: true, settings });
      }
      const sm = path.match(/^\/api\/settings\/([^/]+)$/);
      if (sm && req.method === "PUT") {
        needDb(env);
        const key = decodeURIComponent(sm[1]);
        if (!SETTING_KEY.test(key)) return json({ error: "Ogiltigt namn" }, 400);
        const text = await req.text();
        if (text.length > MAX_SETTING_BYTES) return json({ error: "För stor inställning" }, 413);
        try { JSON.parse(text); } catch (e) { return json({ error: "Inställningen måste vara JSON" }, 400); }
        await ensureSchema(env.DB);
        await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, text, new Date().toISOString()).run();
        return json({ ok: true });
      }

      if (path === "/api/suggest" && req.method === "POST") {
        const body = await readJson(req, 40e3);
        return json(await suggestSession(env, body));
      }
      // Pulskontroll, besvär och sparade förslag
      const im = path.match(/^\/api\/items\/([a-z]+)(?:\/([^/]+))?$/);
      if (im && ITEM_KINDS[im[1]]) {
        const kind = im[1], id = im[2] ? decodeURIComponent(im[2]) : null;
        if (!id && req.method === "GET") {
          if (!env.DB) return json({ db: false, items: {} });
          await ensureSchema(env.DB);
          const { results } = await env.DB.prepare("SELECT id, data FROM items WHERE kind = ?1").bind(kind).all();
          // Skickas vidare utan att tolkas, för att spara CPU-tid
          return new Response('{"db":true,"items":{' + results.map(r => JSON.stringify(r.id) + ":" + r.data).join(",") + "}}", { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
        }
        if (id && (req.method === "PUT" || req.method === "DELETE")) {
          needDb(env); await ensureSchema(env.DB);
          if (!ITEM_ID.test(id)) return json({ error: "Ogiltigt id" }, 400);
          if (req.method === "DELETE") { await env.DB.prepare("DELETE FROM items WHERE kind = ?1 AND id = ?2").bind(kind, id).run(); return json({ ok: true }); }
          const text = await req.text();
          if (text.length > ITEM_KINDS[kind]) return json({ error: "Posten är för stor" }, 413);
          try { const v = JSON.parse(text); if (!v || typeof v !== "object" || Array.isArray(v)) throw 0; } catch (e) { return json({ error: "Posten måste vara ett JSON-objekt" }, 400); }
          await env.DB.prepare("INSERT INTO items (kind, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(kind, id, text, new Date().toISOString()).run();
          return json({ ok: true });
        }
        return json({ error: "Metoden stöds inte här" }, 405);
      }

      // Loggade pass
      if (path === "/api/logs/parse" && req.method === "POST") {
        const body = await readJson(req, 7e6);
        return json(await parseScreenshot(env, body.image));
      }
      if (path === "/api/logs" && req.method === "GET") {
        if (!env.DB) return json({ db: false, logs: [] });
        await ensureSchema(env.DB);
        const { results } = await env.DB.prepare("SELECT * FROM logs ORDER BY date DESC, id DESC").all();
        return json({ db: true, logs: results.map(logRow) });
      }
      if (path === "/api/logs" && req.method === "POST") {
        needDb(env); await ensureSchema(env.DB);
        const body = await readJson(req, MAX_LOG_BYTES * 2);
        const err = validLog(body); if (err) return json({ error: err }, 400);
        const stamp = new Date().toISOString();
        const name = String((body.data && body.data.name) || "").slice(0, 200);
        const row = await env.DB.prepare("INSERT INTO logs (activity_id, date, name, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) RETURNING *").bind(body.activityId != null ? Number(body.activityId) : null, body.date, name, JSON.stringify(body.data || {}), stamp).first();
        return json({ log: row ? logRow(row) : null });
      }
      const lm = path.match(/^\/api\/logs\/(\d+)$/);
      if (lm && (req.method === "PUT" || req.method === "DELETE")) {
        needDb(env); await ensureSchema(env.DB);
        const id = Number(lm[1]);
        if (req.method === "DELETE") { await env.DB.prepare("DELETE FROM logs WHERE id = ?1").bind(id).run(); return json({ ok: true }); }
        const body = await readJson(req, MAX_LOG_BYTES * 2);
        const err = validLog(body); if (err) return json({ error: err }, 400);
        const name = String((body.data && body.data.name) || "").slice(0, 200);
        await env.DB.prepare("UPDATE logs SET activity_id = ?1, date = ?2, name = ?3, data = ?4, updated_at = ?5 WHERE id = ?6").bind(body.activityId != null ? Number(body.activityId) : null, body.date, name, JSON.stringify(body.data || {}), new Date().toISOString(), id).run();
        const row = await env.DB.prepare("SELECT * FROM logs WHERE id = ?1").bind(id).first();
        if (!row) return json({ error: "Hittades inte" }, 404);
        return json({ log: logRow(row) });
      }

      // Persist-arkivet
      if (path === "/api/persist" && req.method === "POST") {
        needDb(env); await ensureSchema(env.DB);
        const body = await readJson(req, 3e6);
        const list = Array.isArray(body.sessions) ? body.sessions : [];
        if (list.length > 200) return json({ error: "Högst 200 pass per förfrågan" }, 400);
        const rows = [];
        for (const s of list) {
          if (!s || typeof s.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id)) return json({ error: "Ogiltigt pass-id" }, 400);
          const data = JSON.stringify(s);
          if (data.length > 200e3) return json({ error: "Ett pass är för stort" }, 400);
          const sort = (s.dt || "") + "|" + String(s.w || 0).padStart(3, "0") + "|" + String(s.dy || 0).padStart(2, "0");
          rows.push([s.id, String(s.track || "").slice(0, 80), String(s.pt || "").slice(0, 60), s.dt || null, String(s.title || "").slice(0, 200), sort, data]);
        }
        const stmts = [];
        if (body.replace) stmts.push(env.DB.prepare("DELETE FROM persist"));
        for (let i = 0; i < rows.length; i += 14) {
          const chunk = rows.slice(i, i + 14);
          stmts.push(env.DB.prepare("INSERT INTO persist (id, track, pt, dt, title, sort, data) VALUES " + placeholders(chunk.length, 7) +
            " ON CONFLICT(id) DO UPDATE SET track = excluded.track, pt = excluded.pt, dt = excluded.dt, title = excluded.title, sort = excluded.sort, data = excluded.data").bind(...chunk.flat()));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true, saved: rows.length });
      }
      if (path === "/api/persist/tracks") {
        if (!env.DB) return json({ db: false, tracks: [] });
        await ensureSchema(env.DB);
        const { results } = await env.DB.prepare("SELECT track, pt, COUNT(*) AS n, MAX(dt) AS latest FROM persist GROUP BY track, pt ORDER BY track, pt").all();
        return json({ db: true, tracks: results });
      }
      if (path === "/api/persist/suggest") {
        if (!env.DB) return json({ db: false, sessions: [] });
        await ensureSchema(env.DB);
        const pts = (url.searchParams.get("pt") || "").split(",").filter(Boolean).slice(0, 8);
        const tracks = (url.searchParams.get("track") || "").split(",").filter(Boolean).slice(0, 20);
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "30", 10) || 30, 1), 60);
        if (!pts.length) return json({ db: true, sessions: [] });
        let sql = "SELECT data FROM persist WHERE pt IN (" + pts.map((_, i) => "?" + (i + 1)).join(",") + ")";
        const params = [...pts];
        if (tracks.length) { sql += " AND track IN (" + tracks.map((_, i) => "?" + (pts.length + i + 1)).join(",") + ")"; params.push(...tracks); }
        sql += " ORDER BY sort DESC LIMIT " + limit;
        const { results } = await env.DB.prepare(sql).bind(...params).all();
        return json({ db: true, sessions: results.map(r => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean) });
      }
      const pm = path.match(/^\/api\/persist\/([A-Za-z0-9_-]{1,40})$/);
      if (pm) {
        needDb(env); await ensureSchema(env.DB);
        const row = await env.DB.prepare("SELECT data FROM persist WHERE id = ?1").bind(pm[1]).first();
        if (!row) return json({ error: "Hittades inte" }, 404);
        return new Response('{"session":' + row.data + "}", { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }

      if (req.method !== "GET") return json({ error: "Metoden stöds inte här" }, 405);

      if (path === "/api/activities") {
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
      if (path === "/api/daily") {
        const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "62", 10) || 62, 1), 365);
        if (env.DB && days <= RETAIN_DAYS) {
          let note = null;
          try { await syncDaily(env, false); } catch (e) { note = "Kunde inte hämta ny dygnsdata från Garmin: " + e.message; }
          const { results } = await env.DB.prepare("SELECT data FROM daily WHERE date >= ?1 ORDER BY date").bind(isoDay(days)).all();
          let sources = null; try { sources = JSON.parse(await metaGet(env.DB, "daily_sources") || "null"); } catch (e) {}
          return json({ days, source: "db", note, sources, daily: results.map(r => JSON.parse(r.data)) });
        }
        // Längre historik: bara HRV, dagssammanfattning och sömn, för att hålla antalet anrop till Garmin nere
        const r = await fetchDaily(env, days, days > RETAIN_DAYS ? ["summary", "hrv", "sleep"] : null);
        return json({ days, source: "garmin", sources: r.sources, daily: r.days });
      }
      const m = path.match(/^\/api\/activity\/(\d+)$/);
      if (m) {
        const [details, workouts] = await Promise.all([
          garmin(env, "/activity-service/activity/" + m[1]),
          garmin(env, "/activity-service/activity/" + m[1] + "/workouts"),
        ]);
        return json({ details: details.data, detailsStatus: details.status, workouts: workouts.data, workoutsStatus: workouts.status });
      }
      const fm = path.match(/^\/api\/fit\/(\d+)$/);
      if (fm) {
        // Originalfilen skickas vidare orörd. Sidan packar upp och läser den.
        const r = await garminFetch(env, "/download-service/files/activity/" + fm[1], null, "application/zip, application/x-zip-compressed, application/octet-stream");
        if (!r.ok) return json({ error: "Garmin skickade ingen fil (HTTP " + r.status + ")" }, r.status === 404 ? 404 : 502);
        return new Response(r.body, { headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=86400" } });
      }
      if (path === "/api/probe") {
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
          for (const [suffix, label, p] of [["detaljer", "detaljer", "/activity-service/activity/" + id], ["workouts", "workouts (set/övningar)", "/activity-service/activity/" + id + "/workouts"]]) {
            const r = await garmin(env, p);
            results.push({ id: "pass_" + t + "_" + suffix, label: "Senaste " + t + ": " + label, path: p, status: r.status, ms: r.ms, records: countRecords(r.data), fields: r.data ? inventory(r.data, "", {}) : {}, error: r.error, raw: { activityId: id, kind: suffix } });
          }
        }
        if (activities.length) {
          const id = activities[0].activityId;
          const r = await garmin(env, "/download-service/files/activity/" + id, null, "application/zip, application/x-zip-compressed, application/octet-stream");
          results.push({ id: "fil", label: "Originalfil (FIT) för senaste passet", path: "/download-service/files/activity/" + id, status: r.status, ms: r.ms, records: r.status === 200 ? 1 : 0, bytes: r.bytes, fields: {}, error: r.status === 200 ? null : "HTTP " + r.status });
        }
        for (const [id, [label, p, params]] of Object.entries(eps)) {
          const r = await garmin(env, p, params);
          results.push({ id, label, path: p, status: r.status, ms: r.ms, records: countRecords(r.data), fields: r.data ? inventory(r.data, "", {}) : {}, error: r.error });
        }
        return json({ generated: new Date().toISOString(), activityCount: activities.length, types, results });
      }
      if (path === "/api/raw") {
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

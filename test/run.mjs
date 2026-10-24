// Kör: npm test
// Testar Workern i Node mot låtsade Garmin- och Access-svar. Inga riktiga anrop görs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const dir = new URL("./.build/", import.meta.url);
mkdirSync(dir, { recursive: true });
const html = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
  .replace('import PAGE_HTML from "./page.html";', "const PAGE_HTML = " + JSON.stringify(html) + ";");
writeFileSync(new URL("worker.js", dir), src);
const { default: worker } = await import(new URL("worker.js", dir));
const enc = s => Buffer.from(s).toString("base64url");
const kp = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5", modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:"SHA-256"}, true, ["sign","verify"]);
const jwk = {...await crypto.subtle.exportKey("jwk", kp.publicKey), kid:"k1"};
const TEAM="https://tim.cloudflareaccess.com", AUD="aud123";
async function jwt(payload, key=kp.privateKey){ const h=enc(JSON.stringify({alg:"RS256",kid:"k1"})), p=enc(JSON.stringify(payload)); const s=Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h+"."+p))).toString("base64url"); return h+"."+p+"."+s; }
const now=Math.floor(Date.now()/1000);
const good = await jwt({aud:[AUD], iss:TEAM, exp:now+3600, email:"tim@example.com"});
const other = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5", modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:"SHA-256"}, true, ["sign","verify"]);
const forged = await jwt({aud:[AUD], iss:TEAM, exp:now+3600, email:"x"}, other.privateKey);
const wrongAud = await jwt({aud:["nope"], iss:TEAM, exp:now+3600});
const expired = await jwt({aud:[AUD], iss:TEAM, exp:now-10});
const garminTok = "h."+enc(JSON.stringify({exp:now+86400}))+".s";
const acts = Array.from({length:130},(_,i)=>({activityId:1000+i, activityName:"Pass "+i, startTimeLocal:new Date(Date.now()-i*86400e3).toISOString().slice(0,19).replace("T"," "), activityType:{typeKey:["running","strength_training","hiit"][i%3]}, duration:3000, distance:i%3===0?8000:null, averageHR:140}));
let calls=[];
globalThis.fetch = async (url, opt={}) => {
  url=String(url); calls.push(url);
  if(url.endsWith("/cdn-cgi/access/certs")) return new Response(JSON.stringify({keys:[jwk]}));
  if(url.includes("/personal-api-key/token")) return opt.headers.Authorization==="ApiKey KEY" ? new Response(garminTok) : new Response("bad key",{status:401});
  if(opt.headers?.Authorization!=="Bearer "+garminTok) return new Response("unauth",{status:401});
  const u=new URL(url);
  if(u.pathname.includes("search/activities")){ const s=+u.searchParams.get("start"), l=+u.searchParams.get("limit"), from=u.searchParams.get("startDate")||""; const list=acts.filter(a=>a.startTimeLocal.slice(0,10)>=from); return new Response(JSON.stringify(list.slice(s,s+l))); }
  if(u.pathname.startsWith("/download-service")) return new Response(new Uint8Array(5000));
  if(u.pathname.includes("/hrv-service")) return new Response("not found",{status:404});
  if(u.pathname.match(/activity\/\d+$/)) return new Response(JSON.stringify({activityId:1, summaryDTO:{duration:3000, averageHR:140, maxHR:null, nested:{x:1}}}));
  return new Response(JSON.stringify({data:[{a:1,b:null}]}));
};
const env={GARMIN_API_KEY:"KEY", POLICY_AUD:AUD, TEAM_DOMAIN:TEAM};
const req=(p,t)=>new Request("https://x.workers.dev"+p,{headers:t?{"Cf-Access-Jwt-Assertion":t}:{}});
const check = async (name, p, t, e=env, want=200) => { const r=await worker.fetch(req(p,t), e); const body=await r.text(); console.log(name.padEnd(22), r.status, body.slice(0,70).replace(/\n/g," ")); assert.equal(r.status, want, name); return {r,body}; };
await check("ingen konfig", "/", good, {GARMIN_API_KEY:"KEY"}, 403);
await check("ingen token", "/", null, env, 403);
await check("förfalskad", "/", forged, env, 403);
await check("fel aud", "/", wrongAud, env, 403);
await check("utgången", "/", expired, env, 403);
const page = await check("sida", "/", good);
console.log("  CSP:", page.r.headers.get("content-security-policy").slice(0,40));
await check("status", "/api/status", good);
const a = await check("aktiviteter 365", "/api/activities?days=365", good);
assert.equal(JSON.parse(a.body).activities.length, 130);
await check("detalj", "/api/activity/1001", good);
const pr = await check("probe", "/api/probe", good);
const pj = JSON.parse(pr.body); console.log("  ", pj.activityCount, pj.types, pj.results.map(r=>r.id+":"+r.status).join(" "));
await check("raw hrv", "/api/raw?ep=hrv", good);
await check("raw okänd", "/api/raw?ep=../x", good, env, 404);

// ---------- Med databas (SQLite i minnet som D1) ----------
const { DatabaseSync } = await import("node:sqlite");
function makeD1(){
  const raw = new DatabaseSync(":memory:");
  const mk = (sql, args=[]) => ({
    bind: (...a) => mk(sql, a),
    async first(col){ const r = raw.prepare(sql).get(...args); return r == null ? null : (col ? r[col] : r); },
    async all(){ return { results: raw.prepare(sql).all(...args) }; },
    async run(){ raw.prepare(sql).run(...args); return { success: true }; },
    exec(){ const s = raw.prepare(sql); return /^\s*select/i.test(sql) ? s.all(...args) : s.run(...args); },
  });
  return { raw, prepare: sql => mk(sql), async batch(stmts){ raw.exec("BEGIN"); try { const out = stmts.map(s => s.exec()); raw.exec("COMMIT"); return out; } catch(e){ raw.exec("ROLLBACK"); throw e; } } };
}
const DB = makeD1();
const envDb = { ...env, DB };
const garminCalls = () => calls.filter(c => c.includes("search/activities")).length;
const st0 = JSON.parse((await check("status med db", "/api/status", good, envDb)).body);
assert.equal(st0.storage.db, true); assert.equal(st0.storage.stored, 0);
let before = garminCalls();
const r62 = JSON.parse((await check("62 dagar, synk", "/api/activities?days=62", good, envDb)).body);
assert.equal(r62.source, "db"); assert.ok(r62.activities.length >= 60 && r62.activities.length <= 63, "antal " + r62.activities.length);
assert.ok(garminCalls() > before, "synkade inte");
before = garminCalls();
const r30 = JSON.parse((await check("30 dagar, ingen synk", "/api/activities?days=30", good, envDb)).body);
assert.equal(garminCalls(), before, "synkade igen för tidigt");
assert.ok(r30.activities.length >= 29 && r30.activities.length <= 31);
assert.ok(new Date(r30.activities[0].startTimeLocal) >= new Date(r30.activities.at(-1).startTimeLocal), "fel ordning");
const r365 = JSON.parse((await check("365 dagar från garmin", "/api/activities?days=365", good, envDb)).body);
assert.equal(r365.source, "garmin"); assert.equal(r365.activities.length, 130);
// Gamla rader rensas vid synk
DB.raw.prepare("INSERT INTO activities (id, start_local, type, raw, updated_at) VALUES (1, '2020-01-01 10:00:00', 'hiit', '{}', 'x')").run();
const req2 = (p, method, origin, body) => new Request("https://x.workers.dev" + p, { method, body, headers: { "Cf-Access-Jwt-Assertion": good, ...(origin ? { Origin: origin } : {}) } });
let r = await worker.fetch(req2("/api/sync", "POST", "https://x.workers.dev"), envDb); assert.equal(r.status, 200, "sync");
const sync = await r.json(); console.log("sync".padEnd(22), r.status, JSON.stringify(sync).slice(0, 70));
assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM activities WHERE id = 1").get().n, 0, "gammal rad finns kvar");
r = await worker.fetch(req2("/api/sync", "POST", "https://evil.example"), envDb); assert.equal(r.status, 403, "fel ursprung släpptes in");
r = await worker.fetch(req2("/api/settings/dashboard", "PUT", null, '{"cards":[1]}'), envDb); assert.equal(r.status, 403, "utan ursprung");
r = await worker.fetch(req2("/api/settings/dashboard", "PUT", "https://x.workers.dev", '{"cards":[1]}'), envDb); assert.equal(r.status, 200, "spara inställning");
r = await worker.fetch(req2("/api/settings/dashboard", "PUT", "https://x.workers.dev", 'inte json'), envDb); assert.equal(r.status, 400);
r = await worker.fetch(req2("/api/settings/..%2Fx", "PUT", "https://x.workers.dev", '{}'), envDb); assert.equal(r.status, 400);
// Delsynk: bara de senaste dagarna hämtas när hela fönstret nyligen lästs om
DB.raw.prepare("UPDATE meta SET value = '0' WHERE key = 'last_sync'").run();
calls.length = 0;
await check("delsynk", "/api/activities?days=62", good, envDb);
const sd = new URL(calls.find(c => c.includes("search/activities"))).searchParams.get("startDate");
assert.ok((Date.now() - Date.parse(sd)) / 864e5 <= 4, "delsynken hämtade från " + sd);
const sets = JSON.parse((await check("läs inställningar", "/api/settings", good, envDb)).body);
assert.deepEqual(sets.settings.dashboard, { cards: [1] });
console.log("\nAlla tester gick igenom.");

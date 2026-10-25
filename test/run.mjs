// Kör: npm test
// Testar Workern i Node mot låtsade Garmin- och Access-svar. Inga riktiga anrop görs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const dir = new URL("./.build/", import.meta.url);
mkdirSync(dir, { recursive: true });
// Textmoduler (sidan och klientkoden) blir vanliga strängar i testet, som i Cloudflare
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
  .replace(/^import (\w+) from "\.\/([^"]+\.(?:html|client\.js))";$/gm, (_, name, file) => "const " + name + " = " + JSON.stringify(readFileSync(new URL("../src/" + file, import.meta.url), "utf8")) + ";");
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
let dailyMode=false;
globalThis.fetch = async (url, opt={}) => {
  url=String(url); calls.push(url);
  if(url.endsWith("/cdn-cgi/access/certs")) return new Response(JSON.stringify({keys:[jwk]}));
  if(url.includes("/personal-api-key/token")) return opt.headers.Authorization==="ApiKey KEY" ? new Response(garminTok) : new Response("bad key",{status:401});
  if(opt.headers?.Authorization!=="Bearer "+garminTok) return new Response("unauth",{status:401});
  const u=new URL(url);
  if(u.pathname.includes("search/activities")){ const s=+u.searchParams.get("start"), l=+u.searchParams.get("limit"), from=u.searchParams.get("startDate")||""; const list=acts.filter(a=>a.startTimeLocal.slice(0,10)>=from); return new Response(JSON.stringify(list.slice(s,s+l))); }
  if(u.pathname.startsWith("/download-service")) return new Response(new Uint8Array(5000));
  if(dailyMode){
    const days = (s0, e0) => { const out=[]; for(let d=new Date(s0+"T12:00:00Z"); d<=new Date(e0+"T12:00:00Z"); d=new Date(+d+86400e3)) out.push(d.toISOString().slice(0,10)); return out; };
    const se = () => { const m = u.pathname.match(/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/); return m ? [m[1], m[2]] : [u.searchParams.get("startDate"), u.searchParams.get("endDate")]; };
    const h = d => 40 + (parseInt(d.slice(8,10)) % 7);
    if(u.pathname.includes("/hrv-service/hrv/daily/")){ const [a,b]=se(); return new Response(JSON.stringify({ userProfilePk: 1, hrvSummaries: days(a,b).map(d=>({ calendarDate:d, lastNightAvg:h(d), weeklyAvg:44, status:"BALANCED", baseline:{ balancedLow:38, balancedUpper:50 } })) })); }
    if(u.pathname.includes("/usersummary-service/v2/dailysummaries")){ const [a,b]=se(); return new Response(JSON.stringify(days(a,b).map(d=>({ calendarDate:d, restingHeartRate:52, averageStressLevel:-1, bodyBatteryHighestValue:88, totalSteps:9000 })))); }
    if(u.pathname.includes("dailySleepSummariesByDate")){ const [a,b]=se(); return new Response(JSON.stringify(days(a,b).map(d=>({ calendarDate:d, sleepTimeSeconds:27000, sleepScores:{ overall:{ value:81 } } })))); }
    if(u.pathname.includes("bodyBattery/reports/daily")){ const [a,b]=se(); return new Response(JSON.stringify(days(a,b).map(d=>({ date:d, charged:60, drained:55, bodyBatteryValuesArray:[[1,2]] })))); }
    if(u.pathname.includes("/stats/stress/daily/")){ const [a,b]=se(); return new Response(JSON.stringify(days(a,b).map(d=>({ calendarDate:d, values:{ overallStressLevel:31 } })))); }
  }
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

// ---------- Dygnsdata ----------
dailyMode = true;
DB.raw.prepare("DELETE FROM meta WHERE key LIKE 'last_daily%'").run();
let r2 = await worker.fetch(req("/api/daily?days=62", good), envDb); assert.equal(r2.status, 200);
const dj = await r2.json();
console.log("dygnsdata".padEnd(22), dj.source, dj.daily.length, JSON.stringify(dj.daily.at(-1)));
assert.equal(dj.source, "db"); assert.ok(dj.daily.length >= 60, "för få dagar " + dj.daily.length);
const last = dj.daily.at(-1);
assert.equal(last.rhr, 52); assert.ok(last.hrv >= 40); assert.equal(last.sleepSec, 27000); assert.equal(last.sleepScore, 81);
assert.equal(last.stress, 31, "stress -1 ska ignoreras och tas från stresstjänsten"); assert.equal(last.hrvLow, 38); assert.equal(last.bbCharged, 60);
assert.equal(dj.sources.hrv.status, 200); assert.ok(dj.sources.hrv.found.includes("hrv"));
r2 = await worker.fetch(req("/api/daily?days=200", good), envDb); const dl = await r2.json();
console.log("dygnsdata 200 d".padEnd(22), dl.source, dl.daily.length, Object.keys(dl.sources).join(","));
assert.equal(dl.source, "garmin"); assert.ok(dl.daily.length >= 199); assert.deepEqual(Object.keys(dl.sources).sort(), ["hrv","sleep","summary"]);
const garminCount = calls.filter(c => c.includes("personal.connectapi")).length; calls.length = 0;
await worker.fetch(req("/api/daily?days=365", good), envDb);
const n365 = calls.filter(c => c.includes("personal.connectapi")).length;
console.log("anrop för 365 d".padEnd(22), n365); assert.ok(n365 <= 48, "för många anrop till Garmin: " + n365);
dailyMode = false;

// ---------- Kolumner bredvid rådatan ----------
const colRow = DB.raw.prepare("SELECT duration, avg_hr, trimp FROM activities LIMIT 1").get();
console.log("kolumner".padEnd(22), JSON.stringify(colRow)); assert.equal(colRow.duration, 3000); assert.equal(colRow.avg_hr, 140);

// ---------- Loggade pass ----------
const post = (p, body, method="POST", origin="https://x.workers.dev") => worker.fetch(req2(p, method, origin, body == null ? undefined : JSON.stringify(body)), envDb);
let lr = await post("/api/logs", { date: "2026-10-20", activityId: 1004, data: { name: "Fight Gone Bad", result: { kind: "reps", text: "250", value: 250 } } });
assert.equal(lr.status, 200); const lj = await lr.json(); console.log("ny logg".padEnd(22), JSON.stringify(lj).slice(0, 90)); assert.ok(lj.log.id > 0); assert.equal(lj.log.activityId, 1004);
lr = await post("/api/logs/" + lj.log.id, { date: "2026-10-20", activityId: null, data: { name: "FGB" } }, "PUT"); assert.equal(lr.status, 200); assert.equal((await lr.json()).log.name, "FGB");
lr = await post("/api/logs", { date: "fel", data: {} }); assert.equal(lr.status, 400);
lr = await post("/api/logs", { date: "2026-10-20", data: {} }, "POST", "https://evil.example"); assert.equal(lr.status, 403);
lr = await worker.fetch(req("/api/logs", good), envDb); const ll = await lr.json(); assert.equal(ll.logs.length, 1);
lr = await post("/api/logs/" + lj.log.id, null, "DELETE"); assert.equal(lr.status, 200);
lr = await worker.fetch(req("/api/logs", good), envDb); assert.equal((await lr.json()).logs.length, 0);
lr = await post("/api/logs/parse", { image: "data:image/png;base64,AAAA" }); assert.equal(lr.status, 400, "utan nyckel");
console.log("logg uppdatera/ta bort".padEnd(22), "ok");

// Tolkning av skärmdump med låtsat svar från Claude
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt={}) => {
  if(String(url).startsWith("https://api.anthropic.com/")){
    const b = JSON.parse(opt.body); assert.equal(b.tool_choice.name, "spara_pass"); assert.equal(b.messages[0].content[0].source.media_type, "image/png"); assert.equal(opt.headers["x-api-key"], "sk-test");
    return new Response(JSON.stringify({ model: "claude-x", content: [{ type: "tool_use", name: "spara_pass", input: { name: "Cindy", format: "AMRAP", parts: [], movements: [{ name: "Pull-up" }], scaled: "Rx", result: { kind: "rundor_reps", text: "18 + 5", rounds: 18, reps: 5 } } }] }));
  }
  return realFetch(url, opt);
};
lr = await worker.fetch(req2("/api/logs/parse", "POST", "https://x.workers.dev", JSON.stringify({ image: "data:image/png;base64,AAAA" })), { ...envDb, ANTHROPIC_API_KEY: "sk-test" });
const pj2 = await lr.json(); console.log("tolka bild".padEnd(22), lr.status, JSON.stringify(pj2).slice(0, 80)); assert.equal(pj2.parsed.name, "Cindy");
globalThis.fetch = realFetch;

// ---------- Persist ----------
const sess = Array.from({ length: 30 }, (_, i) => ({ id: "p" + i, track: i % 2 ? "Pump Lift 5x" : "Pump Condition 5x", pt: i % 2 ? "Styrka" : "Styrka + metcon", dt: "2025-0" + (1 + i % 9) + "-1" + (i % 10), title: "Pass " + i, sec: [{ n: "A", text: "x" }] }));
lr = await post("/api/persist", { replace: true, sessions: sess.slice(0, 20) }); assert.equal(lr.status, 200);
lr = await post("/api/persist", { replace: false, sessions: sess.slice(20) }); assert.equal(lr.status, 200);
lr = await worker.fetch(req("/api/persist/tracks", good), envDb); const tj = await lr.json(); console.log("persist spår".padEnd(22), JSON.stringify(tj.tracks));
assert.equal(tj.tracks.reduce((a, t) => a + t.n, 0), 30);
lr = await worker.fetch(req("/api/persist/suggest?pt=" + encodeURIComponent("Styrka + metcon") + "&track=" + encodeURIComponent("Pump Condition 5x") + "&limit=5", good), envDb);
const sj = await lr.json(); console.log("persist förslag".padEnd(22), sj.sessions.map(s => s.id + ":" + s.dt).join(" "));
assert.equal(sj.sessions.length, 5); assert.ok(sj.sessions.every(s => s.pt === "Styrka + metcon")); assert.ok(sj.sessions[0].dt >= sj.sessions[4].dt);
lr = await worker.fetch(req("/api/persist/p3", good), envDb); assert.equal((await lr.json()).session.title, "Pass 3");
lr = await post("/api/persist", { sessions: [{ id: "../x" }] }); assert.equal(lr.status, 400);
const st2 = JSON.parse((await check("status efter allt", "/api/status", good, envDb)).body); assert.equal(st2.storage.persist, 30); assert.ok(st2.storage.daily >= 60);

// ---------- FIT-fil skickas vidare ----------
lr = await worker.fetch(req("/api/fit/1001", good), envDb); assert.equal(lr.status, 200); assert.equal((await lr.arrayBuffer()).byteLength, 5000);
console.log("fit".padEnd(22), lr.status);

// ---------- Egna poster: pulskontroll, besvär, förslag ----------
lr = await post("/api/items/issue/b1", { id: "b1", area: "kna", side: "h", r: [{ d: "2026-10-20", w: "efter", l: 1 }] }, "PUT"); assert.equal(lr.status, 200);
lr = await post("/api/items/issue/b1", { id: "b1", area: "kna", side: "h", r: [{ d: "2026-10-20", w: "efter", l: 1 }, { d: "2026-10-21", w: "dagen", l: 3 }] }, "PUT"); assert.equal(lr.status, 200);
lr = await post("/api/items/hrcheck/1001", { v: 1, act: 3600, h0: 100, h: [5, 6] }, "PUT"); assert.equal(lr.status, 200);
lr = await worker.fetch(req("/api/items/issue", good), envDb); const ij = await lr.json(); console.log("besvär".padEnd(22), JSON.stringify(ij).slice(0, 90));
assert.equal(Object.keys(ij.items).length, 1); assert.equal(ij.items.b1.r.length, 2);
lr = await post("/api/items/issue/../x", { a: 1 }, "PUT"); assert.notEqual(lr.status, 200);
lr = await post("/api/items/nope/x", { a: 1 }, "PUT"); assert.notEqual(lr.status, 200, "okänd sort");
lr = await post("/api/items/issue/b2", [1, 2], "PUT"); assert.equal(lr.status, 400, "inte ett objekt");
lr = await post("/api/items/issue/b2", { a: 1 }, "PUT", "https://evil.example"); assert.equal(lr.status, 403);
lr = await post("/api/items/hrcheck/x", { big: "x".repeat(20000) }, "PUT"); assert.equal(lr.status, 413);
lr = await post("/api/items/issue/b1", null, "DELETE"); assert.equal(lr.status, 200);
lr = await worker.fetch(req("/api/items/issue", good), envDb); assert.equal(Object.keys((await lr.json()).items).length, 0);
const st3 = JSON.parse((await check("status poster", "/api/status", good, envDb)).body); assert.equal(st3.storage.items.hrcheck, 1);

// Passförslag: Claude får kategorierna som enum och inga Persist-pass
globalThis.fetch = async (url, opt={}) => {
  if(String(url).startsWith("https://api.anthropic.com/")){
    const b = JSON.parse(opt.body); assert.equal(b.tool_choice.name, "foreslag_struktur");
    assert.deepEqual(b.tools[0].input_schema.properties.filter.properties.kategorier.items.enum, ["Styrka", "Metcon"]);
    assert.ok(b.system.includes("Hitta inte på")); assert.ok(b.messages[0].content.includes("Vila"));
    return new Response(JSON.stringify({ model: "claude-x", content: [{ type: "tool_use", name: "foreslag_struktur", input: { rubrik: "Lätt överkropp", bedomning: "passar med anpassning", varfor: "x", intensitet: "lätt", struktur: [], filter: { kategorier: ["Styrka"], fokus_undvik: ["ben"], fokus_helst: [] }, undvik: [] } }] }));
  }
  return realFetch(url, opt);
};
lr = await post("/api/suggest", { request: { typ: "CrossFit" }, categories: ["Styrka", "Metcon"], context: { niva: "Vila" } });
assert.equal(lr.status, 400, "utan nyckel");
lr = await worker.fetch(req2("/api/suggest", "POST", "https://x.workers.dev", JSON.stringify({ request: { typ: "CrossFit" }, categories: ["Styrka", "Metcon"], context: { niva: "Vila" } })), { ...envDb, ANTHROPIC_API_KEY: "sk-test" });
const sg = await lr.json(); console.log("passförslag".padEnd(22), lr.status, JSON.stringify(sg).slice(0, 80)); assert.equal(sg.suggestion.filter.fokus_undvik[0], "ben");
globalThis.fetch = realFetch;

console.log("\nAlla tester gick igenom.");

// ---------- Metriker: definieras på ett ställe och används i filter, profiler, kort och diagram ----------
// agg: hur värdet slås ihop per vecka (sum, avg, max). lower: lägre är bättre.
const METRICS = [
  { id:"dur", label:"Längd", unit:"min", get:x => x.dur/60, fmt:v => hmShort(v*60), agg:"sum" },
  { id:"moving", label:"Aktiv tid", unit:"min", get:x => x.moving ? x.moving/60 : null, fmt:v => hmShort(v*60), agg:"sum" },
  { id:"dist", label:"Distans", unit:"km", get:x => x.dist ? x.dist/1000 : null, dec:1, agg:"sum" },
  { id:"pace", label:"Tempo", unit:"min/km", get:x => x.grp === "run" && x.speed > 0 ? 1000/x.speed/60 : null, fmt:v => paceMin(v) + " /km", agg:"avg", lower:true },
  { id:"speed", label:"Fart", unit:"km/h", get:x => x.speed > 0 ? x.speed*3.6 : null, dec:1, agg:"avg" },
  { id:"avgHR", label:"Snittpuls", unit:"bpm", get:x => x.avgHR || null, agg:"avg" },
  { id:"maxHR", label:"Maxpuls", unit:"bpm", get:x => x.maxHR || null, agg:"max" },
  { id:"trimp", label:"Belastning (TRIMP)", unit:"", get:x => x.zp, agg:"sum", desc:"Edwards TRIMP: minuter i varje pulszon gånger zonens nummer" },
  { id:"trimph", label:"Belastning per timme", get:x => x.zp != null && x.dur > 0 ? x.zp/(x.dur/3600) : null, agg:"avg" },
  { id:"z45", label:"Andel zon 4–5", unit:"%", get:x => x.z45 != null ? x.z45*100 : null, agg:"avg" },
  { id:"z12", label:"Andel zon 1–2", unit:"%", get:x => x.z12 != null ? x.z12*100 : null, agg:"avg" },
  { id:"ef", label:"Effektivitetsfaktor", get:x => x.ef, dec:2, agg:"avg", desc:"Meter per minut delat med snittpuls, bara lugna löppass" },
  { id:"im", label:"Intensitetsminuter", get:x => x.im, agg:"sum" },
  { id:"kcal", label:"Kalorier", unit:"kcal", get:x => x.kcal || null, agg:"sum" },
  { id:"bb", label:"Body Battery", get:x => x.bb, agg:"avg", desc:"Förändring under passet enligt Garmin" },
  { id:"recov", label:"Vilotid", unit:"h", get:x => { const r = recoveryHours(x); return r ? r.h : null; }, agg:"avg" },
  { id:"vo2", label:"VO2max (Garmin)", get:x => x.vo2 || null, dec:1, agg:"avg" },
  { id:"elev", label:"Höjdmeter", unit:"m", get:x => x.elev || null, agg:"sum" },
  { id:"sets", label:"Set", get:x => x.totalSets || null, agg:"sum" },
  { id:"reps", label:"Reps", get:x => x.totalReps || null, agg:"sum" },
  { id:"steps", label:"Steg", get:x => x.steps || null, agg:"sum" },
  { id:"teA", label:"Aerob Training Effect", get:x => x.teA, dec:1, agg:"avg" },
  { id:"teAn", label:"Anaerob Training Effect", get:x => x.teAn, dec:1, agg:"avg" },
  { id:"load", label:"Garmins belastning", get:x => x.load, agg:"sum" },
  { id:"count", label:"Antal pass", get:() => 1, agg:"sum", noProfile:true },
];
const MET = Object.fromEntries(METRICS.map(m => [m.id, m]));
function fmtM(m, v){ if(v == null || isNaN(v)) return "–"; return m.fmt ? m.fmt(v) : num(v, m.dec) + (m.unit && m.unit !== "%" ? " " + m.unit : m.unit === "%" ? " %" : ""); }

// Dygnsmetriker från Garmin, och belastning räknad per dag
const DMETRICS = [
  { id:"hrv", label:"HRV (natt)", unit:"ms", get:d => d.hrv, agg:"avg" },
  { id:"rhr", label:"Vilopuls", unit:"bpm", get:d => d.rhr, agg:"avg", lower:true },
  { id:"sleep", label:"Sömn", unit:"h", get:d => d.sleepSec ? d.sleepSec/3600 : null, fmt:v => hmShort(v*3600), agg:"avg" },
  { id:"sleepScore", label:"Sömnpoäng", get:d => d.sleepScore, agg:"avg" },
  { id:"stress", label:"Stress, snitt", get:d => d.stress, agg:"avg", lower:true },
  { id:"bbHigh", label:"Body Battery, högsta", get:d => d.bbHigh, agg:"avg" },
  { id:"bbWake", label:"Body Battery vid uppvaknande", get:d => d.bbWake, agg:"avg" },
  { id:"steps", label:"Steg", get:d => d.steps, agg:"avg" },
  { id:"dload", label:"Belastning (TRIMP) per dag", get:d => d.load, agg:"sum" },
];
const DMET = Object.fromEntries(DMETRICS.map(m => [m.id, m]));

// ---------- Fält för filterbyggaren ----------
const WEEKDAYS = ["måndag","tisdag","onsdag","torsdag","fredag","lördag","söndag"];
function fieldDefs(){
  const types = [...new Set(S.all.map(x => x.type))].sort((a,b) => typeLabel(a).localeCompare(typeLabel(b), "sv"));
  return [
    { id:"type", label:"Typ", kind:"enum", options: GROUPS.map(g => ["g:"+g[0], g[1] + " (grupp)"]).concat(types.map(t => ["t:"+t, typeLabel(t)])),
      get:x => x, test:(x, op, v) => { const hit = v.startsWith("g:") ? x.grp === v.slice(2) : x.type === v.slice(2); return op === "ne" ? !hit : hit; } },
    { id:"name", label:"Namn", kind:"text", get:x => x.name + " " + (logFor(x) ? logFor(x).name || "" : "") },
    { id:"move", label:"Rörelse", kind:"text", get:x => x.sets.map(s => moveLabel(s.category)).join(" ") + " " + (logFor(x) ? ((logFor(x).data.movements || []).map(m => m.name).join(" ")) : "") },
    { id:"ago", label:"Dagar sedan", kind:"num", get:x => Math.floor((Date.now() - x.date)/DAY) },
    { id:"wd", label:"Veckodag", kind:"enum", options: WEEKDAYS.map((d, i) => [String(i), d]), get:x => x, test:(x, op, v) => { const hit = String((x.date.getDay()+6)%7) === v; return op === "ne" ? !hit : hit; } },
    { id:"hour", label:"Starttimme", kind:"num", get:x => x.date.getHours() },
    { id:"logged", label:"Loggat pass", kind:"enum", options:[["1","ja"],["0","nej"]], get:x => x, test:(x, op, v) => { const hit = !!logFor(x) === (v === "1"); return op === "ne" ? !hit : hit; } },
  ].concat(METRICS.filter(m => m.id !== "count").map(m => ({ id:m.id, label:m.label + (m.unit && m.id !== "dur" ? " (" + m.unit + ")" : m.id === "dur" ? " (min)" : ""), kind:"num", get:m.get })));
}
const OPS = { num:[["gt",">"],["ge","≥"],["lt","<"],["le","≤"],["eq","="]], text:[["has","innehåller"],["not","innehåller inte"]], enum:[["eq","är"],["ne","är inte"]] };
function testCond(x, c, fields){
  const f = fields.find(f => f.id === c.field); if(!f) return true;
  if(f.kind === "enum") return f.test(x, c.op, String(c.value));
  const v = f.get(x);
  if(f.kind === "text"){ const hit = String(v||"").toLowerCase().includes(String(c.value||"").toLowerCase()); return c.op === "not" ? !hit : hit; }
  if(v == null || isNaN(v)) return false;
  const t = parseFloat(String(c.value).replace(",", ".")); if(isNaN(t)) return true;
  return c.op === "gt" ? v > t : c.op === "ge" ? v >= t : c.op === "lt" ? v < t : c.op === "le" ? v <= t : Math.abs(v - t) < 1e-9;
}
function matchConds(x, conds, fields){ return (conds || []).every(c => testCond(x, c, fields)); }
function condText(c, fields){
  const f = fields.find(f => f.id === c.field); if(!f) return "";
  const op = (OPS[f.kind].find(o => o[0] === c.op) || ["",""])[1];
  const val = f.kind === "enum" ? ((f.options.find(o => o[0] === String(c.value)) || [0, c.value])[1]) : c.value;
  return f.label.replace(/ \(.*\)$/, "") + " " + op + " " + val;
}

// Urval för kort och vyer: "" alla, "page" sidans typval, "g:run", "t:running", "v:<vy-id>"
function applySelector(list, sel){
  if(!sel || sel === "all") return list;
  if(sel === "page") return S.tab === "trender" && S.ttype ? list.filter(x => x.type === S.ttype) : list;
  if(sel.startsWith("g:")) return list.filter(x => x.grp === sel.slice(2));
  if(sel.startsWith("t:")) return list.filter(x => x.type === sel.slice(2));
  if(sel.startsWith("v:")){ const v = (CFG.views || []).find(v => v.id === sel.slice(2)); if(v){ const f = fieldDefs(); return list.filter(x => matchConds(x, v.conds, f)); } }
  return list;
}
function selectorText(sel){
  if(!sel || sel === "all") return "alla pass";
  if(sel === "page") return "sidans typval";
  if(sel.startsWith("g:")) return GROUP_NAME[sel.slice(2)] || sel;
  if(sel.startsWith("t:")) return typeLabel(sel.slice(2));
  if(sel.startsWith("v:")){ const v = (CFG.views || []).find(v => v.id === sel.slice(2)); return v ? v.name : "borttagen vy"; }
  return sel;
}

// ---------- Belastning per dag: TRIMP, kronisk (42 d), akut (7 d), form ----------
let LOADC = null;
function dailyLoads(){
  if(LOADC) return LOADC;
  const map = {};
  S.all.forEach(x => { if(x.zp != null) map[x.day] = (map[x.day] || 0) + x.zp; });
  const today = sod(new Date());
  const start = S.all.length ? sod(S.all[S.all.length-1].date) : today;
  const rows = [];
  let ctl = 0, atl = 0;
  for(let d = new Date(start); d <= today; d = addDays(d, 1)){
    const k = dayKey(d), L = map[k] || 0;
    const form = ctl - atl;                     // på morgonen, före dagens pass
    rows.push({ date: new Date(d), key: k, load: L, ctlM: ctl, atlM: atl, form, formPct: ctl > 5 ? form/ctl*100 : null });
    ctl += (L - ctl)/42; atl += (L - atl)/7;
    rows[rows.length-1].ctl = ctl; rows[rows.length-1].atl = atl;
  }
  const days = rows.length;
  LOADC = { rows, map, byKey: Object.fromEntries(rows.map(r => [r.key, r])), warm: days >= 42 };
  return LOADC;
}

// Monotoni och strain per vecka (Foster 1998)
function weeklyStrain(nWeeks){
  const { map } = dailyLoads();
  const w0 = addDays(monday(new Date()), -7*(nWeeks-1));
  return Array.from({ length: nWeeks }, (_, i) => {
    const ws = addDays(w0, 7*i);
    const loads = Array.from({ length: 7 }, (_, j) => map[dayKey(addDays(ws, j))] || 0);
    const total = sum(loads), m = total/7, s = sd(loads);
    const mono = s && s > 0 ? m/s : null;
    return { week: ws, total, mono, strain: mono != null ? total*mono : null };
  });
}

// ---------- Dygnsdata: HRV-band, vilopuls, sömn ----------
function dmap(){ if(!S._dmap){ S._dmap = Object.fromEntries(S.daily.map(d => [d.date, d])); } return S._dmap; }
function dayVals(key, field, from, to){
  const D = parseLocal(key), m = dmap(), out = [];
  for(let i = from; i <= to; i++){ const r = m[dayKey(addDays(D, -i))]; if(r && r[field] > 0) out.push(r[field]); }
  return out;
}
// HRV: 7-dagarssnitt av ln(HRV) mot baslinjen 28 dagar innan, band = medel ± 0,5 SD
function hrvState(key){
  const cur = dayVals(key, "hrv", 0, 6).map(Math.log), base = dayVals(key, "hrv", 7, 34).map(Math.log);
  const today = (dmap()[key] || {}).hrv || null;
  if(cur.length < 3 || base.length < 14) return { ok:false, cur:cur.length, base:base.length, today };
  const m7 = mean(cur), bm = mean(base), bs = sd(base) || 0.0001;
  const lo = bm - 0.5*bs, hi = bm + 0.5*bs;
  return { ok:true, m7, lo, hi, state: m7 < lo ? "low" : m7 > hi ? "high" : "normal", ms7: Math.exp(m7), msLo: Math.exp(lo), msHi: Math.exp(hi), today, n7: cur.length };
}
// Vilopuls: 7-dagarssnitt mot baslinjen. Förhöjd = minst 5 % och 2 slag över (mitt startvärde)
function rhrState(key){
  const cur = dayVals(key, "rhr", 0, 6), base = dayVals(key, "rhr", 7, 34);
  if(cur.length < 3 || base.length < 10) return { ok:false };
  const m7 = mean(cur), bm = mean(base);
  return { ok:true, m7, bm, diff: m7 - bm, elevated: m7 >= bm*1.05 && m7 - bm >= 2 };
}
// Sömn: senaste natten och tre nätter mot medianen för 28 nätter. Kort = under 85 % eller under 6 h
function sleepState(key){
  const last = (dmap()[key] || {}).sleepSec || null;
  const three = dayVals(key, "sleepSec", 0, 2), base = dayVals(key, "sleepSec", 3, 30);
  const med = median(base);
  if(!last && !three.length) return { ok:false };
  const short = last ? (last < 6*3600 || (med && last < 0.85*med)) : false;
  const short3 = three.length >= 2 && med ? mean(three) < 0.9*med : false;
  return { ok:true, last, med, avg3: mean(three), short, short3, score: (dmap()[key] || {}).sleepScore };
}

// ---------- Pulsvärden ----------
function hrMax(){
  if(CFG && CFG.hr && CFG.hr.max) return { v: +CFG.hr.max, src:"inställt" };
  const v = Math.max(0, ...S.all.map(x => x.maxHR || 0));
  return v ? { v, src:"högsta i dina pass" } : { v: null, src:"saknas" };
}
function hrRest(){
  if(CFG && CFG.hr && CFG.hr.rest) return { v: +CFG.hr.rest, src:"inställt" };
  const v = median(S.daily.slice(-28).map(d => d.rhr));
  return v ? { v, src:"median vilopuls, 28 dagar" } : { v: null, src:"saknas" };
}

// ---------- Vilotid efter ett pass ----------
// Tumregel: passets TRIMP mot din median för samma grupp. Kalibreras mot hur många nätter din HRV
// behövt för att komma tillbaka i bandet efter liknande pass, när det finns minst fyra sådana pass.
let CALC = {};
function calibration(grp){
  if(CALC[grp] !== undefined) return CALC[grp];
  const peers = S.all.filter(p => p.grp === grp && p.zp != null);
  const med = median(peers.map(p => p.zp));
  const nights = [];
  peers.filter(p => p.zp >= med).forEach(p => {
    const st = hrvState(p.day); if(!st.ok) return;
    for(let n = 1; n <= 4; n++){
      const r = dmap()[dayKey(addDays(p.date, n))];
      if(!r || !r.hrv) return;
      if(Math.log(r.hrv) >= st.lo){ nights.push(n); return; }
    }
    nights.push(4);
  });
  CALC[grp] = nights.length >= 4 ? { nights: median(nights), n: nights.length } : null;
  return CALC[grp];
}
function recoveryHours(x){
  if(!x || x.zp == null) return null;
  const peers = S.all.filter(p => p.grp === x.grp && p.zp != null);
  const med = peers.length >= 3 ? median(peers.map(p => p.zp)) : median(S.all.map(p => p.zp));
  if(!med) return null;
  const r = x.zp/med;
  let h = r < 0.6 ? 12 : r < 1.0 ? 24 : r < 1.4 ? 36 : r < 1.8 ? 48 : 72, method = "tumregel";
  const cal = calibration(x.grp);
  if(cal && r >= 0.8){ h = Math.round(Math.min(96, cal.nights*24*Math.min(1.5, Math.max(0.75, r)))); method = "kalibrerad på " + cal.n + " pass"; }
  return { h, r, med, method };
}
function recoveryNow(){
  const now = Date.now();
  let best = null;
  S.all.filter(x => now - x.date < 5*DAY).forEach(x => {
    const r = recoveryHours(x); if(!r) return;
    const end = +x.date + x.dur*1000, left = (end + r.h*3600e3 - now)/3600e3;
    if(!best || left > best.left) best = { x, h: r.h, method: r.method, left };
  });
  return best;
}

// ---------- Beredskap och förslag ----------
const LEVELS = [
  { name:"Vila", cls:"bad", txt:"Vila eller rörlighet i dag.", pts:["Återhämtning"] },
  { name:"Lätt", cls:"warn", txt:"Lätt aerobt, puls i zon 1–2.", pts:["Engine (aerobt)"] },
  { name:"Medel", cls:"warn", txt:"Styrka utan hård kondition.", pts:["Styrka", "Skill/olympiskt + styrka"] },
  { name:"Hårt", cls:"good", txt:"Klar för ett hårt pass.", pts:["Styrka + metcon", "Metcon", "Sprint & plyo"] },
];
function readiness(){
  const key = dayKey(new Date()), yKey = dayKey(addDays(new Date(), -1));
  const hrv = hrvState(key), hrvY = hrvState(yKey), rhr = rhrState(key), sl = sleepState(key);
  const ld = (dailyLoads().byKey[key]) || null;
  const rec = recoveryNow();
  const why = [];
  let level = 3;
  const cap = (l, txt, sev) => { if(l < level) level = l; why.push({ txt, sev }); };
  if(hrv.ok){
    if(hrv.state === "low"){
      const two = hrvY.ok && hrvY.state === "low";
      if(two && (rhr.elevated || sl.short)) cap(0, "HRV under ditt band två dagar i rad, och " + (rhr.elevated ? "vilopulsen är förhöjd" : "kort sömn") + ".", 2);
      else cap(1, two ? "HRV under ditt band två dagar i rad." : "HRV:s 7-dagarssnitt under ditt band.", two ? 2 : 1);
    } else why.push({ txt: "HRV:s 7-dagarssnitt " + (hrv.state === "high" ? "över" : "inom") + " ditt band (" + num(hrv.ms7) + " ms, band " + num(hrv.msLo) + "–" + num(hrv.msHi) + ").", sev: 0 });
  } else why.push({ txt: hrv.base < 14 ? "HRV-bandet behöver 14 nätter baslinje, har " + hrv.base + ". Bedömningen bygger på belastning och sömn." : "För få HRV-mätningar senaste veckan (" + hrv.cur + " av minst 3).", sev: 1 });
  if(rhr.ok && rhr.elevated) cap(2, "Vilopulsen " + num(rhr.diff, 1) + " slag över din baslinje.", 1);
  else if(rhr.ok) why.push({ txt: "Vilopulsen normal (" + num(rhr.m7) + " bpm, 7 dagar).", sev: 0 });
  if(sl.ok && sl.short) cap(2, "Kort sömn i natt: " + hm(sl.last) + (sl.med ? ", du brukar sova " + hm(sl.med) : "") + ".", 1);
  else if(sl.ok && sl.short3) cap(2, "Tre nätter med mindre sömn än vanligt.", 1);
  else if(sl.ok && sl.last) why.push({ txt: "Sömn i natt: " + hm(sl.last) + ".", sev: 0 });
  if(ld && ld.formPct != null && dailyLoads().warm){
    if(ld.formPct < -30) cap(2, "Hög belastning: form " + num(ld.formPct) + " % av kronisk nivå.", 1);
    else why.push({ txt: "Form " + num(ld.formPct) + " % av kronisk nivå.", sev: 0 });
  }
  if(rec && rec.left > 0){
    if(rec.left > 48) cap(1, "Kvar av vilotiden efter " + rec.x.name + ": " + num(rec.left) + " h.", 1);
    else if(rec.left > 24) cap(2, "Kvar av vilotiden efter " + rec.x.name + ": " + num(rec.left) + " h.", 1);
    else why.push({ txt: "Kvar av vilotiden: " + num(rec.left) + " h.", sev: 0 });
  }
  // Lite lugn aerob tid senaste veckan: föreslå lugn löpning
  const week = S.all.filter(x => Date.now() - x.date < 7*DAY && x.zones);
  const easyMin = sum(week, x => (x.zones[0] + x.zones[1])/60);
  return { level, L: LEVELS[level], why, hrv, rhr, sl, ld, rec, easyMin, easyLow: easyMin < 60 };
}

// ---------- Löpning ----------
// Intensitetsfördelning: andel pulstid i zon 1–2, 3 och 4–5
function intensitySplit(list){
  const z = [0,0,0,0,0]; list.forEach(x => { if(x.zones) x.zones.forEach((v, i) => z[i] += v); });
  const t = sum(z); if(!t) return null;
  return { easy:(z[0]+z[1])/t, mid:z[2]/t, hard:(z[3]+z[4])/t, total:t };
}
// Puls vid fast tempo: snittpuls på löppass inom ±4 % av mediantempot för lugna pass
function hrAtPace(runs){
  const easy = runs.filter(x => x.easy && x.speed > 0);
  const ref = median((easy.length >= 3 ? easy : runs.filter(x => x.speed > 0)).map(x => x.speed));
  if(!ref) return null;
  const inBand = runs.filter(x => x.speed > 0 && x.avgHR && Math.abs(x.speed - ref)/ref <= 0.04);
  return { ref, lo: ref*0.96, hi: ref*1.04, list: inBand };
}

// ---------- Benchmarks från loggade pass ----------
const normName = s => String(s || "").toLowerCase().replace(/[^a-z0-9åäöé]+/g, " ").trim();
function scoreOf(log){
  const r = log.data && log.data.result; if(!r) return null;
  if(r.kind === "tid" && r.seconds > 0) return { v: r.seconds, lower: true, txt: clock(r.seconds) };
  if(r.kind === "rundor_reps" && r.rounds != null) return { v: r.rounds*1000 + (r.reps || 0), lower: false, txt: r.rounds + (r.reps ? " + " + r.reps : "") + " rundor" };
  if(r.value != null && !isNaN(r.value)) return { v: +r.value, lower: false, txt: num(r.value, 1) + (r.unit ? " " + r.unit : "") };
  return null;
}
function benchmarks(){
  const g = {};
  S.logs.forEach(l => { const k = normName(l.data.name || l.name); if(!k) return; (g[k] = g[k] || []).push(l); });
  return Object.values(g).map(list => {
    list.sort((a, b) => a.date < b.date ? -1 : 1);
    const scored = list.map(l => ({ l, s: scoreOf(l) })).filter(x => x.s);
    const lower = scored.length ? scored[0].s.lower : false;
    const best = scored.slice().sort((a, b) => lower ? a.s.v - b.s.v : b.s.v - a.s.v)[0] || null;
    return { name: list[list.length-1].data.name || list[list.length-1].name, list, scored, best, lower };
  }).filter(b => b.list.length >= 2).sort((a, b) => b.list.length - a.list.length);
}
function logFor(x){ return S.logsByAct[String(x.id)] || null; }

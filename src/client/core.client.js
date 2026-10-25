"use strict";
// ---------- Grunder: hjälpfunktioner, tillstånd, inställningar, typer ----------
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DAY = 864e5;
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- Format ----------
const pad = n => String(n).padStart(2, "0");
function clock(s){ if(s == null || isNaN(s)) return "–"; s = Math.round(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return h ? h + ":" + pad(m) + ":" + pad(x) : m + ":" + pad(x); }
function hm(sec){ const m = Math.round((sec||0)/60); const h = Math.floor(m/60); return h ? h + " h " + pad(m%60) + " min" : m + " min"; }
function hmShort(sec){ const m = Math.round((sec||0)/60); const h = Math.floor(m/60); return h ? h + "h" + pad(m%60) : m + "m"; }
function num(v, d){ return v == null || isNaN(v) ? "–" : Number(v).toLocaleString("sv-SE", {maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: 0}); }
function km(m){ return m ? (m/1000).toLocaleString("sv-SE", {maximumFractionDigits: 2}) + " km" : "–"; }
function paceMin(v){ if(v == null || !isFinite(v)) return "–"; const s = Math.round(v*60); return Math.floor(s/60) + ":" + pad(s%60); }
function paceTxt(mps){ return mps ? paceMin(1000/mps/60) + " /km" : "–"; }
function parseLocal(s){ const m = /(\d+)-(\d+)-(\d+)(?:[ T](\d+):(\d+))?/.exec(s||""); return m ? new Date(+m[1], m[2]-1, +m[3], +(m[4]||0), +(m[5]||0)) : new Date(NaN); }
function sod(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function monday(d){ const s = sod(d); s.setDate(s.getDate() - ((s.getDay()+6)%7)); return s; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoWeek(d){ const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = (t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day+3); const f = new Date(Date.UTC(t.getUTCFullYear(),0,4)); return 1 + Math.round(((t-f)/864e5 - 3 + ((f.getUTCDay()+6)%7))/7); }
function dayKey(d){ return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
function dateTxt(d, withYear){ return d.toLocaleDateString("sv-SE", {weekday:"short", day:"numeric", month:"short", year: withYear || d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined}); }
function shortDate(d){ return d.getDate() + "/" + (d.getMonth()+1); }
const MONTHS = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
const median = arr => { const a = arr.filter(v => v != null && !isNaN(v)).sort((x,y) => x-y); if(!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m-1]+a[m])/2; };
const mean = arr => { const a = arr.filter(v => v != null && !isNaN(v)); return a.length ? a.reduce((s,v) => s+v, 0)/a.length : null; };
const sd = arr => { const a = arr.filter(v => v != null && !isNaN(v)); if(a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s,v) => s+(v-m)*(v-m), 0)/(a.length-1)); };
const sum = (arr, f) => arr.reduce((s,x) => s + ((f ? f(x) : x) || 0), 0);
function toast(t){ const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2200); }

// ---------- Nätverk ----------
async function api(path, opt){
  opt = opt || {};
  const init = { method: opt.method || "GET", headers: { Accept: "application/json" } };
  if(opt.body !== undefined){ init.headers["Content-Type"] = "application/json"; init.body = typeof opt.body === "string" ? opt.body : JSON.stringify(opt.body); }
  const r = await fetch(path, init);
  let j = null; try{ j = await r.json(); }catch(e){}
  if(!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
  return j;
}

// ---------- Typer ----------
const TYPES = {
  running:["Löpning","run"], trail_running:["Terränglöpning","run"], treadmill_running:["Löpband","run"], track_running:["Bana","run"], indoor_running:["Löpning inne","run"],
  strength_training:["Styrka","str"], fitness_equipment:["Gym","str"],
  hiit:["HIIT","hiit"], indoor_cardio:["Kondition inne","hiit"], indoor_rowing:["Rodd inne","hiit"], rowing:["Rodd","hiit"], elliptical:["Crosstrainer","hiit"], stair_climbing:["Trappor","hiit"],
  cycling:["Cykling","cyc"], indoor_cycling:["Cykel inne","cyc"], road_biking:["Landsväg","cyc"], mountain_biking:["MTB","cyc"], virtual_ride:["Virtuell cykel","cyc"], lap_swimming:["Simning","cyc"], open_water_swimming:["Öppet vatten","cyc"],
  walking:["Promenad","oth"], hiking:["Vandring","oth"], yoga:["Yoga","oth"], pilates:["Pilates","oth"], mobility:["Rörlighet","oth"], breathwork:["Andning","oth"], other:["Övrigt","oth"]
};
const GROUPS = [["hiit","HIIT och CrossFit"],["str","Styrka"],["run","Löpning"],["cyc","Cykel och sim"],["oth","Övrigt"]];
const GROUP_NAME = Object.fromEntries(GROUPS);
const ZC = ["var(--z1)","var(--z2)","var(--z3)","var(--z4)","var(--z5)"];
const MOVES = { SIT_UP:"Situps", ROW:"Rodd", SQUAT:"Knäböj", DEADLIFT:"Marklyft", PUSH_UP:"Armhävningar", PULL_UP:"Pullups", LUNGE:"Utfall", PLANK:"Planka", BENCH_PRESS:"Bänkpress",
  SHOULDER_PRESS:"Axelpress", OLYMPIC_LIFT:"Olympiska lyft", CARRY:"Bärövningar", CORE:"Bål", HIP_RAISE:"Höftlyft", CARDIO:"Kondition", TOTAL_BODY:"Helkropp", RUN:"Löpning",
  SHRUG:"Shrugs", CURL:"Curls", TRICEPS_EXTENSION:"Triceps", LATERAL_RAISE:"Sidolyft", FLYE:"Flyes", CHOP:"Chops", CRUNCH:"Crunches", CALF_RAISE:"Vadpress", LEG_CURL:"Lårcurl",
  LEG_RAISE:"Benlyft", HYPEREXTENSION:"Ryggresningar", PLYO:"Plyometri", BIKE:"Cykel", HIP_STABILITY:"Höftstabilitet", HIP_SWING:"Kettlebell swing", WARM_UP:"Uppvärmning",
  BATTLE_ROPE:"Battle rope", SLED:"Släde", SANDBAG:"Sandsäck", SUSPENSION:"Slingträning", TIRE:"Däck", BOX_JUMP:"Boxhopp", BURPEE:"Burpees", UNKNOWN:"Okänd rörelse" };
const typeKey = a => (a.activityType && a.activityType.typeKey) || "other";
const typeLabel = k => TYPES[k] ? TYPES[k][0] : k.replace(/_/g," ").replace(/^./, c => c.toUpperCase());
const groupOf = k => TYPES[k] ? TYPES[k][1] : (/run/.test(k) ? "run" : /cycl|bik|swim/.test(k) ? "cyc" : /strength/.test(k) ? "str" : /hiit|cardio|crossfit/.test(k) ? "hiit" : "oth");
const gColor = g => "var(--" + g + ")";
const moveLabel = c => MOVES[c] || String(c||"").toLowerCase().replace(/_/g," ").replace(/^./, x => x.toUpperCase());

// ---------- Normalisering av ett pass ----------
// Zoner och allt som räknas ur dem. Anropas igen när pulskontrollen rensar ett pass.
function deriveHr(x, zones){
  const zt = zones ? sum(zones) : 0;
  x.zones = zones; x.zt = zt;
  x.zp = zones ? zones.reduce((s,v,i) => s + v/60*(i+1), 0) : null;      // Edwards TRIMP
  x.z12 = zt ? (zones[0]+zones[1])/zt : null; x.z3 = zt ? zones[2]/zt : null; x.z45 = zt ? (zones[3]+zones[4])/zt : null;
  // Lugnt löppass: under 10 % av pulstiden i zon 4–5 och minst 15 minuter
  x.easy = x.grp === "run" && zt > 0 && x.z45 < 0.10 && x.dur >= 900 && x.dist > 2000;
  // Effektivitetsfaktor: meter per minut delat med snittpuls, bara lugna löppass med pålitlig puls (TrainingPeaks)
  x.ef = x.easy && x.hrOk !== false && x.speed > 0 && x.avgHR > 0 ? (x.speed*60) / x.avgHR : null;
}
function norm(a){
  const zr = [1,2,3,4,5].map(i => a["hrTimeInZone_" + i]);
  const zones = zr.some(v => v != null) ? zr.map(v => v || 0) : null;
  const type = typeKey(a);
  const grp = groupOf(type);
  const date = parseLocal(a.startTimeLocal);
  const x = {
    id: a.activityId, name: a.activityName || typeLabel(type), type, grp, date, day: dayKey(date),
    dur: a.duration || 0, moving: a.movingDuration, dist: a.distance || 0, speed: a.averageSpeed, avgHR: a.averageHR, maxHR: a.maxHR, kcal: a.calories,
    im: (a.moderateIntensityMinutes||0) + 2*(a.vigorousIntensityMinutes||0),
    bb: a.differenceBodyBattery, sets: Array.isArray(a.summarizedExerciseSets) ? a.summarizedExerciseSets : [],
    totalSets: a.totalSets != null ? a.totalSets : a.activeSets, totalReps: a.totalReps, steps: a.steps,
    teA: a.aerobicTrainingEffect, teAn: a.anaerobicTrainingEffect, load: a.activityTrainingLoad, elev: a.elevationGain, vo2: a.vO2MaxValue, raw: a
  };
  // Garmins egna värden sparas, så att pulskontrollen alltid utgår från dem
  x.g = { zones, avgHR: x.avgHR, maxHR: x.maxHR };
  deriveHr(x, zones);
  return x;
}

// ---------- Tillstånd ----------
const S = {
  all: [], loadedDays: 365, source: "garmin", storage: { db: false }, claude: false,
  daily: [], dailyDays: 0, dailySources: null, dailyNote: null,
  logs: [], logsByAct: {},
  tab: store.get("tab", "oversikt"), period: store.get("period", 28), tperiod: store.get("tperiod", 84),
  ttype: "", q: "", type: "", sort: "date", view: "", editing: false
};
const byId = id => S.all.find(x => String(x.id) === String(id));

// ---------- Inställningar (sparas i D1, med kopia i webbläsaren) ----------
const CFG_KEY = "config";
let CFG = null;
let cfgTimer = null;
function saveCfg(){
  CFG.updated = Date.now();
  store.set("cfg", CFG);
  clearTimeout(cfgTimer);
  if(!S.storage.db) return;
  cfgTimer = setTimeout(() => {
    api("/api/settings/" + CFG_KEY, { method: "PUT", body: CFG }).catch(e => toast("Inställningarna sparades bara i webbläsaren: " + e.message));
  }, 600);
}

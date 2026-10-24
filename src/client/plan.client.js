// ---------- Dagens plan: gör och undvik, utifrån mätvärden och vad du tränat ----------
// Kroppsdelar som ett pass belastar räknas fram ur passtyp, klockans övningar och loggade rörelser.
const REGIONS = { ben: "benen", drag: "ryggen", tryck: "bröst och axlar", bal: "bålen" };
const CAT_REGION = {
  SQUAT:"ben", LUNGE:"ben", DEADLIFT:"ben", BOX_JUMP:"ben", CALF_RAISE:"ben", LEG_CURL:"ben", PLYO:"ben", HIP_RAISE:"ben", HIP_SWING:"ben", HIP_STABILITY:"ben", RUN:"ben", BIKE:"ben",
  PULL_UP:"drag", ROW:"drag", CURL:"drag", SHRUG:"drag",
  PUSH_UP:"tryck", BENCH_PRESS:"tryck", SHOULDER_PRESS:"tryck", TRICEPS_EXTENSION:"tryck", LATERAL_RAISE:"tryck", FLYE:"tryck",
  SIT_UP:"bal", CRUNCH:"bal", PLANK:"bal", CORE:"bal", LEG_RAISE:"bal", CHOP:"bal",
};
const CAT_ALL = ["BURPEE","TOTAL_BODY","OLYMPIC_LIFT","CARRY","SLED","SANDBAG","BATTLE_ROPE","TIRE"];
// Nyckelord för loggade rörelser och Persist-pass (engelska och svenska)
const KW = {
  ben: /squat|knäböj|lunge|utfall|deadlift|marklyft|\brdl\b|step.?up|box jump|jump|hopp|thruster|wall ?ball|clean|snatch|calf|vad|hip thrust|glute|split squat|bulgarian|swing|sled|släde|\brun\b|löp|bike|cykel|leg press|benpress|pistol/i,
  drag: /pull|chin|\brow\b|rodd|\blat\b|curl|shrug|rope climb|face pull|ring row|renegade/i,
  tryck: /push|press|bench|bänk|\bdip|handstand|hspu|burpee|tricep|jerk|thruster|wall ?ball|pike/i,
  bal: /sit.?up|crunch|plank|planka|core|toes.?to.?bar|t2b|ghd|hollow|v.?up|l.?sit|knee raise|leg raise|pallof|dead ?bug|ab ?wheel/i,
};
// Rörlighet som passar det du belastat, för Persists återhämtningspass
const MOB_KW = {
  ben: /hip|höft|calf|vad|ankle|fotled|hamstring|baksida|quad|lår|couch|pigeon|90.?90|adductor/i,
  drag: /thoracic|bröstrygg|\blat\b|hang|häng|child|cat.?cow/i,
  tryck: /shoulder|axel|pec|bröst|wall slide|thoracic/i,
  bal: /hip flexor|höftböj|cobra|spinal|rygg/i,
};

function sessionRegions(x){
  const w = { ben: 0, drag: 0, tryck: 0, bal: 0 };
  let known = false;
  if(x.grp === "run" || x.type === "hiking"){ w.ben = 1; known = true; }
  else if(x.grp === "cyc" && !/swim/.test(x.type)){ w.ben = 1; known = true; }
  else if(/swim/.test(x.type)){ w.drag = .6; w.tryck = .6; known = true; }
  else if(x.type === "walking"){ w.ben = .3; known = true; }
  if(/rowing/.test(x.type)){ w.ben = .7; w.drag = .7; known = true; }
  const reps = sum(x.sets, s => s.reps || 1) || 1;
  x.sets.forEach(s => {
    const share = (s.reps || 1)/reps;
    if(CAT_REGION[s.category]){ w[CAT_REGION[s.category]] += share*1.5; known = true; }
    else if(CAT_ALL.includes(s.category)){ Object.keys(w).forEach(r => w[r] += share); known = true; }
    if(s.category === "ROW"){ w.ben += share*0.7; }
  });
  const lg = logFor(x);
  if(lg){
    const moves = (lg.data.movements || []).map(m => m.name).concat((lg.data.parts || []).map(p => p.text)).join("\n");
    Object.keys(KW).forEach(r => { const n = (moves.match(new RegExp(KW[r].source, "gi")) || []).length; if(n){ w[r] += Math.min(1, n*0.35); known = true; } });
  }
  if(!known && (x.grp === "hiit" || x.grp === "str")){ w.ben = .6; w.drag = .5; w.tryck = .5; w.bal = .4; }
  Object.keys(w).forEach(r => w[r] = Math.min(1, w[r]));
  return { w, known };
}
// Ett pass är tungt för en kroppsdel om den belastas tydligt och passet var tungt för sin typ.
// Styrka räknas alltid som tungt för musklerna, eftersom pulsen underskattar styrkepass.
function heavyFor(x){
  const peers = S.all.filter(p => p.grp === x.grp && p.zp != null);
  const med = median(peers.map(p => p.zp));
  return x.grp === "str" || (x.grp === "hiit" && x.sets.length > 0) || (x.zp != null && med && x.zp >= 0.8*med) || (x.grp === "run" && (x.dist >= 8000 || x.dur >= 3600));
}
// Kroppsdelar som fortfarande återhämtar sig: tungt pass senaste 48 h (ACSM), måttligt senaste 24 h
function loadedRegions(){
  const now = Date.now(), out = {};
  S.all.filter(x => now - x.date < 3*DAY).forEach(x => {
    const { w } = sessionRegions(x), heavy = heavyFor(x), end = +x.date + x.dur*1000;
    Object.keys(w).forEach(r => {
      if(w[r] < 0.4) return;
      const until = end + (heavy ? 48 : 24)*3600e3;
      if(until <= now) return;
      if(!out[r] || until > out[r].until) out[r] = { r, x, heavy, until };
    });
  });
  return out;
}
function whenTxt(t){
  const d = new Date(t), dd = Math.round((sod(d) - sod(new Date()))/DAY), h = d.getHours();
  const part = h < 12 ? "förmiddag" : h < 17 ? "eftermiddag" : "kväll";
  if(dd === 0) return "i " + part;
  return (dd === 1 ? "i morgon" : WEEKDAYS[(d.getDay()+6)%7]) + " " + part;
}
function relDay(d){
  const dd = Math.round((sod(new Date()) - sod(d))/DAY);
  return dd === 0 ? "i dag" : dd === 1 ? "i går" : dd === 2 ? "i förrgår" : "i " + WEEKDAYS[(d.getDay()+6)%7] + "s";
}
const listJoin = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " och " + a[a.length-1];
// Kroppsdelar i läsbar form: rygg plus bröst och axlar blir överkroppen
function regionText(regs){
  let r = regs.slice();
  const words = [];
  if(r.includes("drag") && r.includes("tryck")){ words.push("överkroppen"); r = r.filter(x => x !== "drag" && x !== "tryck"); }
  return listJoin(words.concat(r.map(x => REGIONS[x])));
}

function dayPlan(){
  const R = readiness(), loaded = loadedRegions();
  const doL = [], avoid = [];
  const heavyRegs = Object.values(loaded).filter(l => l.heavy);
  const allRegs = Object.values(loaded);
  const free = Object.keys(REGIONS).filter(r => !loaded[r] || !loaded[r].heavy);
  const mx = hrMax();
  const z2 = mx.v ? Math.round(mx.v*0.7) : null;
  const reason = R.why.filter(w => w.sev > 0).map(w => w.txt)[0] || "";

  // Huvudpasset efter dagens nivå
  if(R.level === 0){
    doL.push({ t: "Vila, promenad eller rörlighet", why: reason });
    avoid.push({ t: "Allt hårt i dag, både styrka och kondition", why: reason });
  } else if(R.level === 1){
    doL.push({ t: "Lugnt aerobt pass" + (z2 ? ", puls under " + z2 + " bpm" : ", puls i zon 1–2"), why: (reason ? reason + " " : "") + (z2 ? "Zon 2 slutar vid 70 % av maxpuls i Garmins standardzoner." : "") });
    avoid.push({ t: "Intervaller och tunga lyft", why: reason });
  } else if(R.level === 2){
    doL.push({ t: free.length ? "Styrka för " + regionText(free) : "Lätt teknik- eller rörlighetspass", why: (reason ? reason + " " : "") + (heavyRegs.length ? "Det som belastades nyligen får vila." : "") });
    avoid.push({ t: "Hård kondition med puls i zon 4–5", why: reason || "Dagens nivå är Medel." });
  } else {
    doL.push({ t: heavyRegs.length ? "Hårt pass, men skona " + regionText(heavyRegs.map(l => l.r)) : "Hårt pass, kroppen är redo", why: R.why.filter(w => w.sev === 0).map(w => w.txt).slice(0, 2).join(" ") });
  }
  // Kroppsdelar som återhämtar sig
  heavyRegs.forEach(l => avoid.push({ t: "Tungt för " + REGIONS[l.r] + " till " + whenTxt(l.until), why: "Efter " + l.x.name + " " + relDay(l.x.date) + ". ACSM:s riktlinje är minst 48 timmar mellan tunga pass för samma muskelgrupp." }));
  // Rörlighet för det som belastats
  if(allRegs.length){
    const regs = [...new Set(allRegs.map(l => l.r))];
    doL.push({ t: "Rörlighet för " + regionText(regs), why: "De belastades av " + listJoin([...new Set(allRegs.map(l => l.x.name + " " + relDay(l.x.date)))]) + ". Bra för rörligheten, men stretching minskar knappt träningsvärk enligt en Cochrane-översikt.", mob: regs });
  }
  // Lugn aerob tid
  if(R.easyLow && R.level >= 2) doL.push({ t: "Lägg in lugn aerob tid i veckan", why: "Bara " + num(R.easyMin) + " minuter i zon 1–2 senaste sju dagarna." });
  // Sömn
  if(R.sl.ok && (R.sl.short || R.sl.short3)) doL.push({ t: "Prioritera sömnen i natt" + (R.sl.med ? ", sikta på " + hm(R.sl.med) : ""), why: R.sl.short ? "Du sov " + hm(R.sl.last) + " i natt." : "Tre nätter med mindre sömn än vanligt." });
  // Variation: hög monotoni
  const wk = weeklyStrain(1)[0];
  if(wk.mono != null && wk.mono > 2 && R.level >= 1) avoid.push({ t: "Ännu ett pass som liknar veckans andra", why: "Monotonin är " + num(wk.mono, 1) + " den här veckan. Över 2 brukar nämnas som varningsnivå (Foster 1998)." });
  // Två hårda dagar i rad
  const hardDay = d => S.all.some(x => x.day === dayKey(addDays(new Date(), -d)) && x.z45 != null && x.z45 > 0.3 && x.dur > 1200);
  if(R.level >= 2 && hardDay(1) && hardDay(2)) avoid.push({ t: "Ett tredje hårt pass i rad", why: "I går och i förrgår hade båda över 30 % av pulstiden i zon 4–5. Det här är min tumregel." });
  return { R, doL: doL.slice(0, 4), avoid: avoid.slice(0, 4), loaded, heavyRegs };
}

CARDS.today = { title: "I dag", tabs: ["oversikt"], render(b){
  const P = dayPlan(), R = P.R;
  const item = (it, kind) => '<li class="pi ' + kind + '"><span class="pm">' + (kind === "do" ? "✓" : "✕") + '</span><span><b>' + esc(it.t) + '</b>' + (it.why ? '<span class="sub">' + esc(it.why) + '</span>' : '') + '</span></li>';
  let h = '<div class="verdict"><span class="pill ' + R.L.cls + '" style="font-size:15px;padding:4px 12px">' + R.L.name + '</span><span>' + esc(R.L.txt) + '</span></div>';
  h += '<div class="plan"><div><h3 class="h3">Gör i dag</h3><ul class="pl">' + P.doL.map(i => item(i, "do")).join("") + '</ul></div>';
  if(P.avoid.length) h += '<div><h3 class="h3">Undvik i dag</h3><ul class="pl">' + P.avoid.map(i => item(i, "avoid")).join("") + '</ul></div>';
  h += '</div><h3 class="h3">Pass från Persist</h3><div class="sugg"></div>';
  if(R.rec) h += '<div class="sub" style="margin-top:8px">Pulsbaserad vilotid efter <b>' + esc(R.rec.x.name) + '</b>: ' + R.rec.h + ' h (' + esc(R.rec.method) + '). ' + (R.rec.left > 0 ? 'Klar om cirka ' + num(R.rec.left) + ' h.' : 'Redan klar.') + '</div>';
  h += '<details class="how"><summary>Mätvärdena bakom</summary><ul class="why">' + R.why.map(w => '<li><span class="dot" style="background:' + (w.sev === 2 ? "var(--bad)" : w.sev === 1 ? "var(--warn)" : "var(--good)") + '"></span>' + esc(w.txt) + '</li>').join("") + '</ul></details>';
  h += '<details class="how"><summary>Så räknas det</summary><p>Nivån kommer från HRV:s 7-dagarssnitt mot ditt band (medel ± 0,5 standardavvikelser för 28 dagar), vilopuls, sömn, form och kvarvarande vilotid. Under bandet en dag ger Lätt, två dagar i rad med förhöjd vilopuls eller kort sömn ger Vila.</p><p>Vilka kroppsdelar ett pass belastat räknas ur passtypen, klockans övningar och dina loggade rörelser. Ett tungt pass spärrar kroppsdelen i 48 timmar, ett måttligt i 24. Gränserna för vilopuls (5 % och 2 slag), sömn (6 timmar eller 85 % av din median) och tre hårda dagar är mina startvärden, inte forskning.</p></details>';
  b.innerHTML = h;
  loadSuggestions(P, b.querySelector(".sugg"));
}};

// ---------- Persist: förslag som passar dagens nivå och skonar det som återhämtar sig ----------
function persistRegions(s){
  const txt = (s.sec || []).filter(sec => !/warm|cool|coach|note/i.test(sec.n + " " + (sec.c || ""))).map(sec => sec.text || "").join("\n");
  const hits = {}; Object.keys(KW).forEach(r => hits[r] = (txt.match(new RegExp(KW[r].source, "gi")) || []).length);
  return hits;
}
function mobilityScore(s, regs){
  const txt = (s.sec || []).map(sec => sec.text || "").join("\n");
  return sum(regs, r => (txt.match(new RegExp(MOB_KW[r].source, "gi")) || []).length);
}
async function loadSuggestions(P, el){
  if(!el) return;
  if(!S.storage.db || !S.storage.persist){ el.innerHTML = '<div class="sub">Importera Persist-arkivet under Data, så föreslår sidan konkreta pass här.</div>'; return; }
  el.innerHTML = '<div class="note"><span class="spin"></span></div>';
  const tracks = encodeURIComponent((CFG.persistTracks || []).join(","));
  const fetchPts = pts => api("/api/persist/suggest?pt=" + encodeURIComponent(pts.join(",")) + "&track=" + tracks + "&limit=60").then(j => j.sessions || []);
  try{
    const R = P.R, avoidRegs = P.heavyRegs.map(l => l.r);
    let main = await fetchPts(R.L.pts);
    // Skona kroppsdelar som återhämtar sig: välj bort pass där de är tydligt med i huvuddelen
    if(avoidRegs.length && R.level >= 2){
      const ok = main.filter(s => { const h = persistRegions(s); return avoidRegs.every(r => h[r] < 2); });
      if(ok.length) main = ok;
    }
    const pool = main.slice(0, 12);
    const day = Math.floor(Date.now()/DAY);
    const pick = pool.length ? [0, 1].map(i => pool[(day + i) % pool.length]).filter((s, i, a) => a.indexOf(s) === i) : [];
    let mob = [];
    const mobRegs = (P.doL.find(d => d.mob) || {}).mob;
    if(mobRegs && R.level < 3){
      const rec = await fetchPts(["Återhämtning"]);
      mob = rec.map(s => ({ s, n: mobilityScore(s, mobRegs) })).filter(o => o.n > 0).sort((a, b) => b.n - a.n).slice(0, 1).map(o => o.s);
    }
    S.persistPick = pick.concat(mob);
    if(!S.persistPick.length){ el.innerHTML = '<div class="sub">Inga Persist-pass passar i de valda spåren.</div>'; return; }
    el.innerHTML = '<div class="plist">' + S.persistPick.map((s, i) => '<button class="prow" data-persist="' + i + '"><b>' + esc(s.title || s.track) + (mob.includes(s) ? ' <span class="pill tiny">rörlighet</span>' : '') + '</b><span class="sub">' + esc(s.track) + (s.pt ? ' · ' + esc(s.pt) : '') + (s.dt ? ' · ' + esc(s.dt) : s.w ? ' · vecka ' + s.w + ' dag ' + s.dy : '') + (s.dur ? ' · ' + s.dur.join("–") + ' min' : '') + '</span></button>').join("") + '</div>' +
      '<div class="sub" style="margin-top:6px">Spår: ' + esc((CFG.persistTracks || []).length ? CFG.persistTracks.join(", ") : "alla") + '. Ändra under Data.' + (avoidRegs.length && R.level >= 2 ? ' Pass som tar ' + esc(regionText(avoidRegs)) + ' hårt är bortvalda.' : '') + '</div>';
  }catch(e){ el.innerHTML = '<div class="sub">Kunde inte hämta förslag: ' + esc(e.message) + '</div>'; }
}

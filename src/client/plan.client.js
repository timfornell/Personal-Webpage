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
  const R = readiness(), loaded = loadedRegions(), IP = issuePlan();
  const doL = [], avoid = [];
  const heavyRegs = Object.values(loaded).filter(l => l.heavy);
  const allRegs = Object.values(loaded);
  // Kroppsdelar med besvär som begränsar mycket räknas inte som lediga
  const free = Object.keys(REGIONS).filter(r => (!loaded[r] || !loaded[r].heavy) && !IP.regs.includes(r));
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
    doL.push({ t: free.length ? "Styrka för " + regionText(free) : "Lätt teknik- eller rörlighetspass", why: (reason ? reason + " " : "") + (heavyRegs.length ? "Det som belastades tungt nyligen ska inte vara huvudfokus." : "") });
    avoid.push({ t: "Hård kondition med puls i zon 4–5", why: reason || "Dagens nivå är Medel." });
  } else {
    doL.push({ t: heavyRegs.length ? "Hårt pass, men inte med fokus på " + regionText(heavyRegs.map(l => l.r)) : "Hårt pass, kroppen är redo", why: R.why.filter(w => w.sev === 0).map(w => w.txt).slice(0, 2).join(" ") });
  }
  // Kroppsdelar som återhämtar sig får användas, men ska inte vara passets huvudfokus
  heavyRegs.forEach(l => { const r = REGIONS[l.r]; avoid.push({ t: r.charAt(0).toUpperCase() + r.slice(1) + " som huvudfokus till " + whenTxt(l.until), why: "Efter " + l.x.name + " " + relDay(l.x.date) + ". ACSM rekommenderar minst 48 timmar innan samma muskelgrupp tränas tungt igen. Att använda dem i ett helkroppspass går bra." }); });
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
  // Besvär går före: de du själv har graderat väger tyngst
  doL.splice(1, 0, ...IP.doL);
  avoid.unshift(...IP.avoid);
  return { R, doL: doL.slice(0, 5), avoid: avoid.slice(0, 5), loaded, heavyRegs, IP };
}

CARDS.today = { title: "I dag", tabs: ["oversikt"], render(b){
  const P = dayPlan(), R = P.R;
  const item = (it, kind) => '<li class="pi ' + kind + '"><span class="pm">' + (kind === "do" ? "✓" : "✕") + '</span><span><b>' + esc(it.t) + '</b>' + (it.why ? '<span class="sub">' + esc(it.why) + '</span>' : '') + '</span></li>';
  let h = '<div class="verdict"><span class="pill ' + R.L.cls + '" style="font-size:15px;padding:4px 12px">' + R.L.name + '</span><span>' + esc(R.L.txt) + '</span></div>';
  h += '<div class="plan"><div><h3 class="h3">Gör i dag</h3><ul class="pl">' + P.doL.map(i => item(i, "do")).join("") + '</ul></div>';
  if(P.avoid.length) h += '<div><h3 class="h3">Undvik i dag</h3><ul class="pl">' + P.avoid.map(i => item(i, "avoid")).join("") + '</ul></div>';
  h += '</div>';
  const open = openIssues();
  if(open.length) h += '<h3 class="h3">Hur känns det?</h3><div class="issues-q">' + open.map(i => '<div class="issue"><button class="ihead" data-issue="' + i.id + '"><b>' + esc(issueLabel(i)) + '</b>' + (issueState(i).lvl ? lvlPill(issueState(i).lvl, true) : '') + '</button>' + quickRow(i) + '</div>').join("") + '</div>' + scaleLine();
  h += '<h3 class="h3">Pass från Persist</h3><div class="sugg"></div>';
  if(S.claude){
    const last = S.sugg.find(x => x.d === dayKey(new Date()));
    h += '<div class="btnrow" style="margin-top:8px"><button class="btn small" data-sugg="new">Föreslå ett pass med Claude</button>' + (last ? '<button class="btn ghost small" data-sugg="' + last.id + '">Dagens förslag: ' + esc(last.res.rubrik || "") + '</button>' : '') + '</div>';
  }
  if(R.rec) h += '<div class="sub" style="margin-top:8px">Pulsbaserad vilotid efter <b>' + esc(R.rec.x.name) + '</b>: ' + R.rec.h + ' h (' + esc(R.rec.method) + '). ' + (R.rec.left > 0 ? 'Klar om cirka ' + num(R.rec.left) + ' h.' : 'Redan klar.') + '</div>';
  h += '<details class="how"><summary>Mätvärdena bakom</summary><ul class="why">' + R.why.map(w => '<li><span class="dot" style="background:' + (w.sev === 2 ? "var(--bad)" : w.sev === 1 ? "var(--warn)" : "var(--good)") + '"></span>' + esc(w.txt) + '</li>').join("") + '</ul></details>';
  h += '<details class="how"><summary>Så räknas det</summary><p>Nivån kommer från HRV:s 7-dagarssnitt mot ditt band (medel ± 0,5 standardavvikelser för 28 dagar), vilopuls, sömn, form och kvarvarande vilotid. Under bandet en dag ger Lätt, två dagar i rad med förhöjd vilopuls eller kort sömn ger Vila. Utan HRV från klockan bygger nivån på vilopuls, sömn, form och vilotid.</p><p>Besvär du graderat senaste veckan går först. Begränsar det mycket väljs Persist-pass med fokus på kroppsdelen bort. Stoppar det, väljs alla pass där den förekommer tydligt bort. Är det värre dagen efter ett pass än direkt efter, eller ökar det mot förra veckan, hamnar det under Undvik.</p><p>Vilka kroppsdelar ett pass belastat räknas ur passtypen, klockans övningar och dina loggade rörelser. Efter ett tungt pass ska kroppsdelen inte vara huvudfokus på 48 timmar, efter ett måttligt 24. Den får användas i helkroppspass. Gränserna för vilopuls (5 % och 2 slag), sömn (6 timmar eller 85 % av din median) och tre hårda dagar är mina startvärden, inte forskning.</p></details>';
  b.innerHTML = h;
  loadSuggestions(P, b.querySelector(".sugg"));
}};

// ---------- Persist: förslag som passar dagens nivå och skonar det som återhämtar sig ----------
function persistRegions(s){
  const txt = (s.sec || []).filter(sec => !/warm|cool|coach|note/i.test(sec.n + " " + (sec.c || ""))).map(sec => sec.text || "").join("\n");
  const hits = {}; Object.keys(KW).forEach(r => hits[r] = (txt.match(new RegExp(KW[r].source, "gi")) || []).length);
  return hits;
}
// Passets huvudfokus: kroppsdelen med flest träffar, där styrkedelen väger dubbelt.
// Ingen kroppsdel över 40 % av träffarna betyder helkropp.
function persistFocus(s){
  const hits = { ben: 0, drag: 0, tryck: 0, bal: 0 };
  (s.sec || []).filter(sec => !/warm|cool|coach|note|uppvärm/i.test(sec.n + " " + (sec.c || ""))).forEach(sec => {
    const w = /styrka|strength|lift|skill|heavy/i.test(sec.n + " " + (sec.f || "")) ? 2 : 1;
    Object.keys(KW).forEach(r => hits[r] += w*(String(sec.text || "").match(new RegExp(KW[r].source, "gi")) || []).length);
  });
  const total = sum(Object.values(hits));
  const top = Object.keys(hits).sort((a, b) => hits[b] - hits[a])[0];
  return { focus: total && hits[top]/total >= 0.4 ? top : null, hits };
}
// Skona: kroppsdelen får inte vara huvudfokus. Strikt: den får knappt förekomma (besvär som stoppar).
function persistOk(s, spare, strict){
  const f = persistFocus(s), raw = persistRegions(s);
  return !spare.includes(f.focus) && strict.every(r => raw[r] < 2);
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
    const R = P.R;
    // Skona kroppsdelar som återhämtar sig och kroppsdelar med besvär: de ska inte vara passets huvudfokus
    const avoidRegs = [...new Set(P.heavyRegs.map(l => l.r).concat(P.IP ? P.IP.regs : []))];
    const strict = P.IP ? P.IP.strict : [];
    let main = await fetchPts(R.L.pts);
    if(avoidRegs.length || strict.length){
      const ok = main.filter(s => persistOk(s, avoidRegs, strict));
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
      '<div class="sub" style="margin-top:6px">Spår: ' + esc((CFG.persistTracks || []).length ? CFG.persistTracks.join(", ") : "alla") + '. Ändra under Data.' + (avoidRegs.length ? ' Pass med fokus på ' + esc(regionText(avoidRegs)) + ' är bortvalda.' : '') + '</div>';
  }catch(e){ el.innerHTML = '<div class="sub">Kunde inte hämta förslag: ' + esc(e.message) + '</div>'; }
}

// ---------- Passförslag från Claude ----------
// Claude får en sammanfattning som sidan räknat fram och svarar med struktur och filter.
// Sidan filtrerar Persist-arkivet själv, och du väljer passet. Inga pass skickas till Claude.
const SUG_TYPES = [["crossfit","CrossFit"],["styrka","Styrka"],["kondition","Kondition"],["lopning","Löpning"],["rorlighet","Rörlighet"]];
const SUG_EFFORT = [["latt","Lätt"],["medel","Medel"],["hard","Hårt"]];
const SUG_TIME = [["20","20 min"],["30","30 min"],["45","45 min"],["60","60 min"]];
const SUG_VERDICT = { "passar": "good", "passar med anpassning": "warn", "avråder": "bad" };
S.sugg = [];
async function suggLoad(){
  if(!S.storage.db) return;
  try{
    const j = await api("/api/items/suggest");
    const all = Object.values(j.items || {}).filter(x => x && x.at);
    // Förslag äldre än 30 dagar tas bort
    all.filter(x => Date.now() - x.at > 30*DAY).forEach(x => api("/api/items/suggest/" + encodeURIComponent(x.id), { method: "DELETE" }).catch(() => {}));
    S.sugg = all.filter(x => Date.now() - x.at <= 30*DAY).sort((a, b) => b.at - a.at);
  }catch(e){}
}
function suggContext(){
  const P = dayPlan(), R = P.R, L = dailyLoads(), today = L.rows[L.rows.length-1], wk = weeklyStrain(1)[0];
  const r0 = v => v == null || isNaN(v) ? undefined : Math.round(v);
  const sess = S.all.filter(x => Date.now() - x.date < 7*DAY).map(x => {
    const lg = logFor(x), w = sessionRegions(x).w;
    return { datum: x.day + " " + pad(x.date.getHours()) + ":" + pad(x.date.getMinutes()), typ: typeLabel(x.type), namn: (lg && lg.data.name) || x.name, min: Math.round(x.dur/60),
      km: x.dist ? +(x.dist/1000).toFixed(1) : undefined, belastning: r0(x.zp), uppskattad: x.zpEst || undefined, andel_zon45_procent: x.z45 != null ? r0(x.z45*100) : undefined,
      snittpuls: r0(x.avgHR), pulskvalitet: x.hrq && x.hrq.state !== "ok" && x.hrq.state !== "none" ? x.hrq.state : undefined,
      kroppsdelar: Object.keys(w).filter(r => w[r] >= 0.4), tungt: heavyFor(x), rorelser: lg ? (lg.data.movements || []).map(m => m.name).slice(0, 12) : undefined };
  });
  return {
    datum: dayKey(new Date()), veckodag: WEEKDAYS[(new Date().getDay()+6)%7],
    niva: R.L.name + ". " + R.L.txt, skal: R.why.map(w => w.txt),
    sidans_regler: { gor: P.doL.map(d => d.t), undvik: P.avoid.map(d => d.t) },
    aterhamtar: Object.values(P.loaded).map(l => ({ kroppsdel: l.r, tungt: l.heavy, till: dayKey(new Date(l.until)) + " " + whenTxt(l.until), efter: l.x.name })),
    belastning: today ? { kronisk_42d: r0(today.ctlM), akut_7d: r0(today.atlM), form_procent: r0(today.formPct) } : null,
    monotoni_vecka: wk.mono != null ? +wk.mono.toFixed(1) : null,
    maxpuls: hrMax().v, vilopuls: hrRest().v,
    pass_7_dagar: sess,
    dygn_14_dagar: S.daily.slice(-14).map(d => ({ datum: d.date, hrv: d.hrv || undefined, vilopuls: d.rhr || undefined, somn_h: d.sleepSec ? +(d.sleepSec/3600).toFixed(1) : undefined })),
    besvar_skala: "1 känns av, 2 begränsar lite, 3 begränsar mycket, 4 stoppar",
    besvar: openIssues().map(i => { const st = issueState(i); return { plats: issueLabel(i), kroppsdelar: (AREA[i.area] || AREA.annat).regs, niva: st.lvl, varre_dagen_efter: st.worse ? st.worse.from + " till " + st.worse.to : undefined, okar: st.rising || undefined, graderingar_14d: ratingsOf(i).filter(r => daysAgo(r.d) <= 14).map(r => r.d + " " + (WHEN_TXT[r.w] || r.w).toLowerCase() + ": " + r.l) }; }),
  };
}
function segHtml(id, opts, v){ return '<div class="seg" id="' + id + '">' + opts.map(o => '<button data-v="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(v)) + '">' + o[1] + '</button>').join("") + '</div>'; }
function openSuggest(showId){
  openSheet("Passförslag");
  const pick = Object.assign({ typ: "crossfit", insats: "medel", tid: "45" }, store.get("suggPick", {}));
  const recent = S.sugg.filter(x => Date.now() - x.at < 7*DAY);
  $("#sheet-body").innerHTML = '<section class="card"><h2>Vad vill du köra?</h2><div class="form">' +
    '<label>Typ</label>' + segHtml("sg-typ", SUG_TYPES, pick.typ) + '<label>Ansträngning</label>' + segHtml("sg-ins", SUG_EFFORT, pick.insats) + '<label>Tid</label>' + segHtml("sg-tid", SUG_TIME, pick.tid) +
    '<label>Önskemål, om du vill<input id="sg-txt" placeholder="t.ex. bara kettlebells, inget löpande"></label></div>' +
    '<div class="btnrow" style="margin-top:10px"><button class="btn" id="sg-go">Fråga Claude</button></div><p class="sub" style="margin:8px 0 0">Claude får en sammanfattning av dagens läge, veckans pass och dina besvär. Inga pass ur arkivet skickas. Varje fråga kostar någon krona på din API-nyckel.</p></section>' +
    '<div id="sg-out"></div>' +
    (recent.length ? '<section class="card"><h2>Senaste förslagen</h2><div class="btnrow">' + recent.map(x => '<button class="btn ghost small" data-sugg="' + x.id + '">' + esc(dateTxt(new Date(x.at))) + ' · ' + esc(x.res.rubrik || "") + '</button>').join("") + '</div></section>' : '');
  ["typ","ins","tid"].forEach(k => { const el = $("#sg-" + k); el.onclick = e => { const b = e.target.closest("button"); if(!b) return; el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); pick[k === "ins" ? "insats" : k] = b.dataset.v; store.set("suggPick", pick); }; });
  $("#sg-go").onclick = () => askClaude(pick);
  if(showId){ const it = S.sugg.find(x => x.id === showId); if(it) renderSuggestion(it, $("#sg-out")); }
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-sugg]"); if(!b) return;
  e.preventDefault();
  if(b.dataset.sugg === "new") openSuggest(); else openSuggest(b.dataset.sugg);
});
async function askClaude(pick){
  const out = $("#sg-out"), btn = $("#sg-go");
  btn.disabled = true; out.innerHTML = '<section class="card"><div class="note"><span class="spin"></span>Claude tänker …</div></section>';
  try{
    let cats = [];
    if(S.storage.db && S.storage.persist){
      const t = await api("/api/persist/tracks"), chosen = CFG.persistTracks || [];
      cats = [...new Set((t.tracks || []).filter(x => !chosen.length || chosen.includes(x.track)).map(x => x.pt).filter(Boolean))];
    }
    const request = { typ: (SUG_TYPES.find(t => t[0] === pick.typ) || [0, pick.typ])[1], anstrangning: (SUG_EFFORT.find(t => t[0] === pick.insats) || [0, pick.insats])[1], tid_min: +pick.tid, onskemal: $("#sg-txt").value.trim() || undefined };
    const j = await api("/api/suggest", { method: "POST", body: { request, categories: cats, context: suggContext() } });
    const item = { id: "s" + Date.now().toString(36), at: Date.now(), d: dayKey(new Date()), req: request, res: j.suggestion, model: j.model };
    S.sugg.unshift(item);
    if(S.storage.db) api("/api/items/suggest/" + item.id, { method: "PUT", body: item }).catch(() => {});
    S.sheetDirty = true;
    renderSuggestion(item, out);
  }catch(e){ out.innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; }
  btn.disabled = false;
}
async function renderSuggestion(item, el){
  const r = item.res || {}, f = r.filter || {};
  let h = '<section class="card"><h2>' + esc(r.rubrik || "Förslag") + ' <small>' + esc(item.req.typ + ", " + item.req.anstrangning.toLowerCase() + ", " + item.req.tid_min + " min") + '</small></h2>';
  h += '<div class="verdict"><span class="pill ' + (SUG_VERDICT[r.bedomning] || "") + '">' + esc(r.bedomning || "") + '</span><span class="sub">' + esc([r.intensitet, r.puls].filter(Boolean).join(" · ")) + '</span></div>';
  if(r.varfor) h += '<p style="margin:0 0 8px">' + esc(r.varfor) + '</p>';
  if((r.struktur || []).length) h += '<h3 class="h3">Struktur</h3><ul class="pl">' + r.struktur.map(s => '<li class="pi do"><span class="pm">✓</span><span><b>' + esc(s.del) + '</b><span class="sub">' + esc(s.innehall) + '</span></span></li>').join("") + '</ul>';
  if((r.undvik || []).length) h += '<h3 class="h3">Undvik</h3><ul class="pl">' + r.undvik.map(t => '<li class="pi avoid"><span class="pm">✕</span><span><b>' + esc(t) + '</b></span></li>').join("") + '</ul>';
  const ftxt = [(f.kategorier || []).length ? f.kategorier.join(", ") : null, f.langd_min || f.langd_max ? (f.langd_min || "?") + "–" + (f.langd_max || "?") + " min" : null, (f.fokus_undvik || []).length ? "inte fokus på " + regionText(f.fokus_undvik) : null, (f.fokus_helst || []).length ? "gärna fokus på " + regionText(f.fokus_helst) : null].filter(Boolean).join(" · ");
  h += '<h3 class="h3">Pass ur Persist</h3>' + (ftxt ? '<div class="sub" style="margin-bottom:6px">Filter: ' + esc(ftxt) + '</div>' : '') + '<div class="sg-list"><div class="note"><span class="spin"></span></div></div>';
  h += '<p class="sub" style="margin:10px 0 0">' + esc(dateTxt(new Date(item.at))) + ' kl ' + pad(new Date(item.at).getHours()) + ':' + pad(new Date(item.at).getMinutes()) + (item.model ? ' · ' + esc(item.model) : '') + '. Claude såg bara sammanfattningen, inga pass ur arkivet.</p></section>';
  el.innerHTML = h;
  const box = el.querySelector(".sg-list");
  if(!(f.kategorier || []).length){ box.innerHTML = '<div class="sub">Inget arkivpass behövs. Kör strukturen ovan.</div>'; return; }
  if(!S.storage.db || !S.storage.persist){ box.innerHTML = '<div class="sub">Importera Persist-arkivet under Data för att få pass här.</div>'; return; }
  try{
    const tracks = encodeURIComponent((CFG.persistTracks || []).join(","));
    const j = await api("/api/persist/suggest?pt=" + encodeURIComponent(f.kategorier.join(",")) + "&track=" + tracks + "&limit=60");
    const strict = issuePlan().strict, lo = f.langd_min || 0, hi = f.langd_max || 999;
    let list = (j.sessions || []).filter(s => !s.dur || (s.dur[1] >= lo - 5 && s.dur[0] <= hi + 5)).filter(s => persistOk(s, f.fokus_undvik || [], strict));
    const pref = f.fokus_helst || [];
    list = list.map((s, i) => ({ s, i, p: pref.includes(persistFocus(s).focus) ? 0 : 1 })).sort((a, b) => a.p - b.p || a.i - b.i).map(o => o.s).slice(0, 6);
    S.persistPick = list;
    box.innerHTML = list.length ? '<div class="plist">' + list.map((s, i) => { const fo = persistFocus(s).focus; return '<button class="prow" data-persist="' + i + '"><b>' + esc(s.title || s.track) + (fo ? ' <span class="pill tiny">fokus ' + esc(REGIONS[fo]) + '</span>' : ' <span class="pill tiny">helkropp</span>') + '</b><span class="sub">' + esc(s.track) + (s.pt ? ' · ' + esc(s.pt) : '') + (s.dur ? ' · ' + s.dur.join("–") + ' min' : '') + '</span></button>'; }).join("") + '</div>'
      : '<div class="sub">Inga pass i de valda spåren matchar filtret. Strukturen ovan går att köra som den är.</div>';
  }catch(e){ box.innerHTML = '<div class="sub">Kunde inte hämta pass: ' + esc(e.message) + '</div>'; }
}

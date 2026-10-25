// ---------- Pulskvalitet: pulstoppar och tappad puls ----------
// Två saker kan förstöra det sidan räknar ur pulsen (zoner, belastning, snittpuls, maxpuls):
//  1. Korta toppar långt över maxpulsen som inte kommer från träningen.
//  2. Pulsbandet tappar kontakten: luckor i pulsen, plötsliga fall eller orimligt låg puls fast du springer.
// Sidan läser originalfilen (FIT) för varje pass, räknar ett histogram över de sekunder som ser rimliga ut
// och sparar det i databasen. Zoner, snittpuls och belastning räknas sedan om ur histogrammet.
// Gränserna här är mina tumregler, inte forskning.
const HRQ = { items: {}, gz: null, gzErr: null, scan: { running: false, done: 0, todo: 0, fails: 0, stopped: null } };
const HRQ_VER = 1;
const HRQ_RULES = {
  jump: 30,          // slag upp eller ned ...
  win: 8000,         // ... inom 8 sekunder räknas som en störning, inte som kroppen
  back: 15,          // störningen pågår tills pulsen är inom 15 slag från nivån före
  maxSeg: 15*60e3,   // kommer pulsen inte tillbaka inom 15 minuter räknas den som verklig
  hold: 5000,        // ett mätvärde gäller i högst 5 sekunder om nästa saknar puls
  pause: 30,         // längre luckor mellan mätpunkter är pauser, inte tappad puls
  over: 5,           // slag över maxpulsen som räknas som pulstopp
};

// ---------- Garmins pulszoner ----------
function parseGarminZones(d){
  const list = (Array.isArray(d) ? d : d ? [d] : []).filter(o => o && typeof o === "object");
  const has = o => o.zone1Floor != null;
  const pick = list.find(o => has(o) && /default/i.test(o.sport || "")) || list.find(has);
  if(!pick) return null;
  const floors = [1,2,3,4,5].map(i => +pick["zone" + i + "Floor"]);
  if(floors.some(v => !(v > 30 && v < 260))) return null;
  return { floors, max: +(pick.maxHeartRateUsed || pick.maxHeartRate || 0) || null, method: pick.trainingMethod || null };
}
async function loadGarminZones(){
  const c = store.get("gz", null);
  if(c && Date.now() - c.at < DAY){ HRQ.gz = c.z; return; }
  try{
    const j = await api("/api/raw?ep=pulszoner");
    HRQ.gz = parseGarminZones(j.data); HRQ.gzErr = HRQ.gz ? null : "Svaret innehöll inga zongränser";
    store.set("gz", { at: Date.now(), z: HRQ.gz });
  }catch(e){ HRQ.gz = null; HRQ.gzErr = e.message; }
}
// Zongränser för omräkning: Garmins egna om de bygger på samma maxpuls, annars 50–90 % av maxpulsen (Garmins standard)
function zoneFloors(){
  const mx = hrMax().v, gz = HRQ.gz;
  if(gz && gz.max && mx && Math.abs(gz.max - mx) <= HRQ_RULES.over) return { f: gz.floors, src: "Garmins zoner" };
  if(!mx) return null;
  return { f: [0.5,0.6,0.7,0.8,0.9].map(p => Math.round(p*mx)), src: "50, 60, 70, 80 och 90 % av maxpuls " + mx };
}

// ---------- Analys av en FIT-fil ----------
// Returnerar posten som sparas, och en flagga per mätpunkt för diagrammet:
// 0 rimlig, 1 plötslig topp, 2 plötsligt fall, 3 låg puls i rörelse, 4 saknas
function analyzeFit(recs, mx, rest){
  const Rr = recs.filter(r => r.t != null).sort((a, b) => a.t - b.t), n = Rr.length;
  const item = { v: HRQ_VER, at: Date.now(), mx: mx || null, act: 0, miss: 0, low: 0, drop: 0, jump: 0, h0: 0, h: [], top: null, raw: null };
  const flag = new Array(n).fill(0), hr = new Array(n).fill(null);
  // Pulsen i varje punkt. Saknas den gäller förra värdet i högst fem sekunder.
  let lastHr = null, lastT = -Infinity;
  for(let i = 0; i < n; i++){
    const v = Rr[i].hr;
    if(v > 0){ hr[i] = v; lastHr = v; lastT = Rr[i].t; }
    else if(lastHr != null && Rr[i].t - lastT <= HRQ_RULES.hold) hr[i] = lastHr;
    else flag[i] = 4;
  }
  const idx = []; for(let i = 0; i < n; i++) if(Rr[i].hr > 0) idx.push(i);
  if(idx.length < 2) return { item, flag, recs: Rr };
  item.raw = Math.max(...idx.map(i => Rr[i].hr));
  // Plötsliga hopp: minst 30 slag på 8 sekunder. Uppåt räknas bara om pulsen hamnar över 85 % av maxpulsen.
  const topLvl = mx ? 0.85*mx : 170, dropFrom = mx && rest ? rest + 0.4*(mx - rest) : 110;
  let k = 0;
  for(let a = 0; a < idx.length; a++){
    const i = idx[a];
    while(Rr[idx[k]].t < Rr[i].t - HRQ_RULES.win) k++;
    let lo = Infinity, hi = -Infinity;
    for(let b = k; b < a; b++){ const v = Rr[idx[b]].hr; if(v < lo) lo = v; if(v > hi) hi = v; }
    if(lo === Infinity) continue;
    const v = Rr[i].hr;
    let kind = 0, base = 0;
    if(v - lo >= HRQ_RULES.jump && v >= topLvl){ kind = 1; base = lo; }
    else if(hi - v >= HRQ_RULES.jump && hi >= dropFrom){ kind = 2; base = hi; }
    if(!kind) continue;
    let end = -1;
    for(let b = a; b < idx.length; b++){
      const j = idx[b]; if(Rr[j].t - Rr[i].t > HRQ_RULES.maxSeg) break;
      const w = Rr[j].hr;
      if(kind === 1 ? w <= base + HRQ_RULES.back : w >= base - HRQ_RULES.back){ end = b; break; }
    }
    if(end < 0) continue;
    for(let b = a; b < end; b++){ const s = idx[b]; flag[s] = kind; for(let q = s + 1; q < n && Rr[q].hr == null; q++) if(flag[q] !== 4) flag[q] = kind; }
    a = end - 1;
  }
  // Låg puls fast du rör dig: över 1,8 m/s (cirka 9:15 per km) med puls under 30 % av pulsreserven, efter tre minuter
  const lowLvl = mx && rest ? rest + 0.3*(mx - rest) : null, t0 = Rr[0].t;
  const hist = {};
  for(let i = 0; i < n - 1; i++){
    const dt = (Rr[i+1].t - Rr[i].t)/1000;
    if(dt <= 0 || dt > HRQ_RULES.pause) continue;
    item.act += dt;
    if(flag[i] === 4){ item.miss += dt; continue; }
    if(flag[i] === 1){ item.jump += dt; continue; }
    if(flag[i] === 2){ item.drop += dt; continue; }
    if(lowLvl && Rr[i].spd > 1.8 && hr[i] < lowLvl && Rr[i].t - t0 > 180e3){ flag[i] = 3; item.low += dt; continue; }
    const b = Math.round(hr[i]); hist[b] = (hist[b] || 0) + dt;
  }
  const keys = Object.keys(hist).map(Number);
  if(keys.length){
    const lo = Math.min(...keys), hiK = Math.max(...keys);
    item.h0 = lo; item.h = Array.from({ length: hiK - lo + 1 }, (_, i) => Math.round(hist[lo + i] || 0));
    item.top = hiK;
  }
  ["act","miss","low","drop","jump"].forEach(k => item[k] = Math.round(item[k]));
  return { item, flag, recs: Rr };
}

// ---------- Bedömning per pass ----------
// state: ok, rensad (toppar eller luckor borttagna), osaker (bara Garmins sammanfattning, något ser fel ut), opalitlig
function hrqAssess(x, mx, rest, floors){
  const g = x.g, mark = ((CFG && CFG.hrMarks) || {})[x.id] || null;
  const it = HRQ.items[x.id];
  const fit = it && it.v === HRQ_VER && !it.err && it.act > 0 && it.h && it.h.length ? it : null;
  const lim = mx ? mx + HRQ_RULES.over : null;
  const q = { state: "ok", why: [], mark, src: fit ? "fil" : "garmin", fit, zones: g.zones, avgHR: g.avgHR, maxHR: g.maxHR, ok: true };
  const has = !!(g.zones || g.avgHR);
  if(!has){ q.state = "none"; return q; }
  if(mark === "bad"){ q.state = "opalitlig"; q.ok = false; q.why.push("Du har markerat pulsen som opålitlig."); return q; }
  if(fit){
    let valid = 0, s = 0, top = 0, epi = fit.jump || 0;
    const z = [0,0,0,0,0];
    fit.h.forEach((sec, i) => {
      if(!sec) return;
      const bpm = fit.h0 + i;
      if(lim && bpm > lim){ epi += sec; return; }
      valid += sec; s += bpm*sec; if(bpm > top) top = bpm;
      if(floors){ for(let zi = 4; zi >= 0; zi--) if(bpm >= floors[zi]){ z[zi] += sec; break; } }
    });
    const art = (fit.miss || 0) + (fit.low || 0) + (fit.drop || 0);
    const artShare = art/fit.act, usable = valid/fit.act;
    q.epi = epi; q.art = art; q.usable = usable;
    if(epi >= 10) q.why.push(hm(epi) + " pulstopp" + (lim ? " över " + lim + " slag" : "") + " eller plötsliga hopp uppåt, borttaget.");
    if(fit.miss >= 30) q.why.push(hm(fit.miss) + " utan puls.");
    if(fit.drop >= 30) q.why.push(hm(fit.drop) + " med plötsliga fall i pulsen.");
    if(fit.low >= 30) q.why.push(hm(fit.low) + " med orimligt låg puls fast du rörde dig.");
    if(mark !== "ok" && usable < 0.6){
      q.state = "opalitlig"; q.ok = false;
      q.why.push("Bara " + num(usable*100) + " % av passet har rimlig puls.");
      return q;
    }
    if(mark === "ok"){
      // Du säger att pulsen stämmer: Garmins zoner gäller, bara toppar över maxpulsen tas bort
      q.state = epi >= 10 ? "rensad" : "ok";
      if(g.zones && epi >= 10){ q.zones = g.zones.slice(); q.zones[4] = Math.max(0, q.zones[4] - epi); }
      q.maxHR = lim && g.maxHR > lim ? top || null : g.maxHR;
      return q;
    }
    // Luckorna fylls med passets egen fördelning, så att belastningen inte blir för låg
    const scale = valid > 0 ? fit.act/valid : 1;
    if(floors) q.zones = z.map(v => Math.round(v*scale));
    q.avgHR = valid ? s/valid : g.avgHR;
    q.maxHR = top || null;
    q.ok = !(artShare > 0.08 && art >= 60);
    q.state = epi >= 10 || art >= 60 ? "rensad" : "ok";
    if(q.state === "rensad" && scale > 1.02) q.why.push("Tiden utan rimlig puls fylls med passets egen fördelning.");
    return q;
  }
  // Bara Garmins sammanfattning
  if(lim && g.maxHR > lim){ q.maxHR = null; q.why.push("Maxpuls " + num(g.maxHR) + " i passet, över din maxpuls " + mx + ". Räknas som pulstopp och visas inte som maxpuls. Zon 5 kan innehålla tid från toppen."); }
  if(mark !== "ok"){
    if(x.grp === "run" && x.speed > 2.0 && g.avgHR && mx && rest && g.avgHR < rest + 0.35*(mx - rest)){ q.state = "osaker"; q.ok = false; q.why.push("Snittpulsen " + num(g.avgHR) + " är låg för farten " + paceTxt(x.speed) + "."); }
    if((x.grp === "run" || x.grp === "cyc") && x.dur >= 900 && g.zones && sum(g.zones)/x.dur < 0.5){ q.state = "osaker"; q.ok = false; q.why.push("Puls i zon 1–5 bara under " + num(sum(g.zones)/x.dur*100) + " % av passet."); }
  }
  if(q.state === "ok" && q.why.length) q.state = "rensad";
  return q;
}

// Lägger bedömningen på alla pass. Anropas från invalidate().
function applyHrq(){
  if(!S.all.length) return;
  const mx = hrMax().v, rest = hrRest().v, zf = zoneFloors(), floors = zf ? zf.f : null;
  const bad = [];
  S.all.forEach(x => {
    if(!x.g) return;
    const q = hrqAssess(x, mx, rest, floors);
    x.hrq = q; x.hrOk = q.ok; x.zpEst = false;
    if(q.state === "opalitlig"){ x.avgHR = null; x.maxHR = null; deriveHr(x, null); bad.push(x); return; }
    x.avgHR = q.avgHR; x.maxHR = q.maxHR;
    deriveHr(x, q.zones);
  });
  // Opålitliga pass får en uppskattad belastning: passets längd gånger din median per minut för samma typ
  if(bad.length){
    const rate = list => median(list.filter(p => p.zp != null && p.dur > 300 && p.hrq && p.hrq.state !== "opalitlig").map(p => p.zp/(p.dur/60)));
    const byType = {}, byGrp = {};
    bad.forEach(x => {
      if(!(x.type in byType)){ const l = S.all.filter(p => p.type === x.type); byType[x.type] = l.filter(p => p.zp != null && p.hrq && p.hrq.state !== "opalitlig").length >= 3 ? rate(l) : null; }
      if(!(x.grp in byGrp)) byGrp[x.grp] = rate(S.all.filter(p => p.grp === x.grp));
      const r = byType[x.type] != null ? byType[x.type] : byGrp[x.grp];
      if(r && x.dur > 0){ x.zp = r*x.dur/60; x.zpEst = true; }
    });
  }
}

// ---------- Lagring och kontroll i bakgrunden ----------
async function hrqLoad(){
  if(S.storage.db){ try{ const j = await api("/api/items/hrcheck"); HRQ.items = j.items || {}; }catch(e){} }
}
async function hrqSave(id, item){
  HRQ.items[id] = item;
  if(S.storage.db){ try{ await api("/api/items/hrcheck/" + encodeURIComponent(id), { method: "PUT", body: item }); }catch(e){} }
}
function hrqNeeds(x, mx){
  if(!x.g || !(x.g.zones || x.g.avgHR)) return false;
  const it = HRQ.items[x.id];
  if(!it || it.v !== HRQ_VER) return true;
  if(it.err) return Date.now() - it.at > 7*DAY;
  return !!(mx && it.mx && Math.abs(it.mx - mx) > 8);
}
async function hrqScan(list){
  if(HRQ.scan.running || !list.length) return;
  HRQ.scan = { running: true, done: 0, todo: list.length, fails: 0, stopped: null };
  hrqStatus();
  let inRow = 0;
  for(const x of list){
    if(HRQ.scan.cancel) break;
    try{
      const { item } = analyzeFit(await fetchFit(x.id), hrMax().v, hrRest().v);
      await hrqSave(x.id, item); inRow = 0;
    }catch(e){
      HRQ.scan.fails++; inRow++;
      await hrqSave(x.id, { v: HRQ_VER, at: Date.now(), err: String(e.message || e).slice(0, 120) });
      if(inRow >= 3){ HRQ.scan.stopped = e.message; break; }
    }
    HRQ.scan.done++;
    if(HRQ.scan.done % 10 === 0){ invalidate(); if(S.tab !== "data") rerender(); }
    hrqStatus();
  }
  HRQ.scan.running = false; HRQ.scan.cancel = false;
  invalidate(); rerender(); hrqStatus();
}
// De senaste 62 dagarna kontrolleras av sig själva. De styr formen och dagens plan.
async function hrqInit(){
  await Promise.all([hrqLoad(), loadGarminZones()]);
  invalidate(); rerender();
  const mx = hrMax().v, from = Date.now() - 62*DAY;
  hrqScan(S.all.filter(x => +x.date >= from && hrqNeeds(x, mx)));
}
function hrqStatus(){
  const el = $("#hrq-scan"); if(!el) return;
  const s = HRQ.scan;
  if(s.running) el.innerHTML = '<div class="note"><span class="spin"></span>Kontrollerar pulsen i pass ' + (s.done + 1) + ' av ' + s.todo + ' …</div>';
  else if(s.stopped) el.innerHTML = '<div class="banner">Kontrollen stoppades: Garmin skickade inte originalfilen tre gånger i rad (' + esc(s.stopped) + '). Pass utan fil bedöms ur Garmins sammanfattning.</div>';
  else el.innerHTML = s.todo ? '<div class="sub">Klart: ' + s.done + ' pass kontrollerade' + (s.fails ? ', ' + s.fails + ' utan fil' : '') + '.</div>' : '';
}

// ---------- Visning ----------
const HRQ_LABEL = { ok: ["Pulsen ser rimlig ut", "good"], rensad: ["Rensad", "warn"], osaker: ["Osäker puls", "warn"], opalitlig: ["Opålitlig puls", "bad"], none: ["Ingen puls", ""] };
function hrqPill(x, small){
  const q = x.hrq; if(!q || q.state === "ok" || q.state === "none") return "";
  const L = HRQ_LABEL[q.state];
  return '<span class="pill ' + L[1] + (small ? ' tiny' : '') + '">' + L[0] + '</span>';
}
function hrqCardHtml(x){
  const q = x.hrq; if(!q || q.state === "none") return "";
  const L = HRQ_LABEL[q.state];
  let h = '<h2>Pulsdata <small>' + (q.src === "fil" ? "kontrollerad i originalfilen" : "bara Garmins sammanfattning") + '</small></h2>';
  h += '<div class="verdict"><span class="pill ' + L[1] + '">' + L[0] + '</span>' + (q.mark ? '<span class="sub">ditt val</span>' : '') + '</div>';
  if(q.why.length) h += '<ul class="why">' + q.why.map(w => '<li>' + esc(w) + '</li>').join("") + '</ul>';
  if(q.state === "opalitlig") h += '<p class="sub">Passet räknas inte med i snittpuls, zoner, effektivitet eller puls vid tempo.' + (x.zpEst ? ' Belastningen är uppskattad till ' + num(x.zp) + ' ur passets längd och din median per minut för ' + esc(typeLabel(x.type).toLowerCase()) + '.' : '') + '</p>';
  else if(q.ok === false) h += '<p class="sub">Passet räknas inte med i effektivitet, puls vid tempo och intensitetsfördelning.</p>';
  const b = (v, t) => '<button class="btn ghost small" data-hrmark="' + v + '">' + t + '</button>';
  h += '<div class="btnrow">' + (q.mark !== "bad" ? b("bad", "Markera som opålitlig") : "") + (q.mark !== "ok" && q.state !== "ok" ? b("ok", "Pulsen stämmer") : "") + (q.mark ? b("", "Låt sidan bedöma") : "") + '</div>';
  return h;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-hrmark]"); if(!b || S.openId == null) return;
  CFG.hrMarks = CFG.hrMarks || {};
  if(b.dataset.hrmark) CFG.hrMarks[S.openId] = b.dataset.hrmark; else delete CFG.hrMarks[S.openId];
  saveCfg(); invalidate(); S.sheetDirty = true; openSession(S.openId); toast("Sparat");
});

// ---------- Data-fliken ----------
function renderHrqBox(){
  const el = $("#hrq-box"); if(!el) return;
  const mx = hrMax(), lim = mx.v ? mx.v + HRQ_RULES.over : null, zf = zoneFloors(), gz = HRQ.gz;
  let h = '';
  const over = lim ? S.all.filter(x => x.g && x.g.maxHR > lim) : [];
  if(over.length) h += '<p class="sub">' + over.length + ' pass har en maxpuls över ' + lim + ' enligt Garmin, högst ' + num(Math.max(...over.map(x => x.g.maxHR))) + '. Sidan räknar det som pulstoppar och tar bort dem ur zoner, snittpuls och maxpuls.</p>';
  if(gz && gz.max && mx.v && Math.abs(gz.max - mx.v) > HRQ_RULES.over){
    h += '<div class="banner">Garmin räknar dina pulszoner med maxpuls ' + num(gz.max) + ', men sidan använder ' + num(mx.v) + '. Då hamnar klockans zoner, och allt Garmin räknar ur dem, fel. Ändra maxpulsen under pulszoner i Garmin Connect, och stäng av automatisk identifiering av maxpuls om den är på, annars kan klockan sätta tillbaka en topp som maxpuls. Pass som sidan har kontrollerat räknas om med ' + esc(zf ? zf.src : "din maxpuls") + '.</div>';
  } else if(gz && gz.max) h += '<p class="sub">Garmin räknar zonerna med maxpuls ' + num(gz.max) + (gz.method ? ' (' + esc(gz.method) + ')' : '') + ', samma som här.</p>';
  else if(HRQ.gzErr) h += '<p class="sub">Kunde inte läsa Garmins pulszoner: ' + esc(HRQ.gzErr) + '.</p>';
  // Kontrollen
  const withHr = S.all.filter(x => x.g && (x.g.zones || x.g.avgHR));
  const recent = withHr.filter(x => Date.now() - x.date < 62*DAY);
  const isChecked = x => { const it = HRQ.items[x.id]; return it && it.v === HRQ_VER && !it.err; };
  const noFile = withHr.filter(x => { const it = HRQ.items[x.id]; return it && it.err; }).length;
  h += '<h3 class="h3">Kontroll av pulsen</h3><p class="sub">Sidan läser originalfilen för varje pass och letar efter luckor, plötsliga hopp på minst 30 slag inom 8 sekunder, låg puls fast du springer och värden över din maxpuls. Det som ser fel ut tas bort, och resten av passet får räknas. De senaste 62 dagarna kontrolleras av sig själva.</p>';
  h += '<p class="sub">Kontrollerade: ' + recent.filter(isChecked).length + ' av ' + recent.length + ' pass senaste 62 dagarna, ' + withHr.filter(isChecked).length + ' av ' + withHr.length + ' totalt' + (noFile ? '. ' + noFile + ' pass saknade fil hos Garmin' : '') + '.</p>';
  const mxv = mx.v, todo = withHr.filter(x => hrqNeeds(x, mxv));
  h += '<div class="btnrow">' + (HRQ.scan.running ? '<button class="btn ghost small" id="hrq-stop">Avbryt</button>' : (todo.length ? '<button class="btn small" id="hrq-all">Kontrollera ' + todo.length + ' pass till</button>' : '') + (S.storage.db ? '<button class="btn ghost small" id="hrq-redo">Kontrollera om alla</button>' : '')) + '</div>';
  // Pass med anmärkning
  const flagged = S.all.filter(x => x.hrq && ["rensad","osaker","opalitlig"].includes(x.hrq.state));
  if(flagged.length){
    const cnt = s => flagged.filter(x => x.hrq.state === s).length;
    h += '<h3 class="h3">Pass med anmärkning</h3><p class="sub">' + [["opalitlig","opålitligt","opålitliga"],["osaker","osäkert","osäkra"],["rensad","rensat","rensade"]].filter(s => cnt(s[0])).map(s => cnt(s[0]) + ' ' + (cnt(s[0]) === 1 ? s[1] : s[2])).join(", ") + '. Tryck på ett pass för att se varför, eller för att ändra bedömningen.</p>';
    h += '<div class="list hrq-list">' + flagged.slice(0, 20).map(rowHtml).join("") + '</div>';
  }
  el.innerHTML = h;
  if($("#hrq-all")) $("#hrq-all").onclick = () => { hrqScan(todo).then(renderData); renderData(); };
  if($("#hrq-redo")) $("#hrq-redo").onclick = () => { if(!confirmTwice($("#hrq-redo"))) return; hrqScan(withHr.slice()).then(renderData); renderData(); };
  if($("#hrq-stop")) $("#hrq-stop").onclick = () => { HRQ.scan.cancel = true; };
  hrqStatus();
}

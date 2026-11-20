// ---------- Fråga Claude om ett pass ----------
// Kortet i passvyn skickar en fråga och ett underlag som sidan räknar fram: passets mått, en
// nedsamplad tidsserie ur FIT-filen (puls efter pulskontrollen, höjd, fart, kadens, effekt),
// splittar och liknande pass. Position skickas inte. Samtalet sparas per pass i tabellen items.
const ASK = { conv: {}, loaded: false, busy: false };
const ASK_MAX_TURNS = 10;

async function askLoad(){
  if(ASK.loaded) return;
  ASK.loaded = true;
  if(S.storage.db){ try{ const j = await api("/api/items/ask"); ASK.conv = j.items || {}; }catch(e){} }
}
async function askSave(id){
  const c = ASK.conv[id]; if(!c || !S.storage.db) return;
  try{ await api("/api/items/ask/" + encodeURIComponent(id), { method: "PUT", body: c }); }
  catch(e){ toast("Svaret sparades inte: " + e.message); }
}

// Snabbfrågor efter vad passet har för data
function askPresets(x, has){
  const p = [];
  if(has.alt) p.push(["Puls mot höjd", "Analysera hur pulsen följde höjdkurvan. Hur reagerade pulsen i backarna, med vilken fördröjning, och hur snabbt återhämtade jag mig efteråt?"]);
  if(x.grp === "run" || x.grp === "cyc") p.push(["Tempo och puls", "Hur jämnt höll jag tempot, och hur förändrades pulsen mot farten under passet? Syns tecken på trötthet eller pulsdrift?"]);
  if(x.grp === "hiit" || x.grp === "str") p.push(["Intensitet", "Hur fördelade sig intensiteten under passet? Hitta arbets- och vilofaserna i pulsen och beskriv hur hårt varje del var."]);
  p.push(["Mot liknande pass", "Hur står sig det här passet mot mina liknande pass i underlaget? Vad var bättre eller sämre?"]);
  p.push(["Vad säger passet?", "Sammanfatta vad passet säger om min form och vad jag kan tänka på till nästa gång."]);
  return p;
}

function renderAskCard(x){
  const el = $("#askcard"); if(!el) return;
  if(!S.claude){
    el.innerHTML = '<h2>Fråga Claude</h2><div class="sub">Lägg in ANTHROPIC_API_KEY som Secret i Cloudflare för att kunna ställa frågor om passet, se Data-fliken.</div>';
    return;
  }
  const draw = () => {
    if(S.openId !== x.id || !$("#askcard")) return;
    const c = ASK.conv[x.id];
    const turns = (c && c.turns) || [];
    const has = { alt: (FITC[x.id] || []).some(r => r.alt != null) };
    let h = '<h2>Fråga Claude <small>om det här passet</small></h2>';
    h += '<div class="thread">' + turns.map(t => '<div class="q">' + esc(t.q) + '</div><div class="a">' + mdLite(t.a) + '</div>').join("") + '</div>';
    if(!turns.length) h += '<div class="chips" id="ask-presets">' + askPresets(x, has).map((p, i) => '<button class="chip" data-i="' + i + '">' + esc(p[0]) + '</button>').join("") + '</div>';
    h += '<div id="ask-pending"></div>';
    // Ett formulär, så att Skicka-knappen och tangentbordets Skicka fungerar även när tangentbordet är uppe på telefonen
    h += '<form id="ask-form" novalidate><textarea id="ask-q" rows="2" maxlength="1500" enterkeyhint="send" placeholder="' + (turns.length ? 'Följdfråga …' : 'Fråga något om passet, t.ex. hur pulsen följde höjdkurvan') + '"></textarea>';
    h += '<div class="btnrow" style="margin-top:8px"><button type="submit" class="btn small" id="ask-go">Skicka</button>' + (turns.length ? '<button type="button" class="btn ghost small" id="ask-new">Nytt samtal</button>' : '') + '</div></form><div id="ask-status"></div>';
    if(turns.length) h += '<div class="sub" style="margin-top:6px">' + esc([turns[turns.length-1].model, c.at ? dateTxt(new Date(c.at)) : ""].filter(Boolean).join(" · ")) + '<br>Svaren bygger på underlaget sidan räknar fram: passets mått, en nedsamplad tidsserie, splittar och liknande pass.</div>';
    el.innerHTML = h;
    const presets = askPresets(x, has);
    $$("#ask-presets .chip").forEach(b => b.onclick = () => send(presets[+b.dataset.i][1]));
    $("#ask-form").onsubmit = e => { e.preventDefault(); send($("#ask-q").value); };
    // Enter skickar, Skift+Enter ger ny rad
    $("#ask-q").onkeydown = e => { if(e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); send($("#ask-q").value); } };
    if($("#ask-new")) $("#ask-new").onclick = async () => {
      delete ASK.conv[x.id]; draw();
      if(S.storage.db) api("/api/items/ask/" + encodeURIComponent(x.id), { method: "DELETE" }).catch(() => {});
    };
  };
  const send = async q => {
    q = String(q || "").trim();
    if(!q) return;
    if(ASK.busy){ toast("Väntar fortfarande på förra svaret"); return; }
    ASK.busy = true;
    const go = $("#ask-go"), ta = $("#ask-q");
    if(go) go.disabled = true;
    if(ta){ ta.value = ""; ta.blur(); }
    // Frågan syns direkt, med en räknare medan Claude svarar
    const t0 = Date.now();
    const pend = $("#ask-pending");
    if(pend) pend.innerHTML = '<div class="thread"><div class="q">' + esc(q) + '</div></div>';
    const tick = () => { const st = $("#ask-status"); if(st && S.openId === x.id) st.innerHTML = '<div class="note"><span class="spin"></span>Claude tittar på passet … ' + Math.round((Date.now() - t0)/1000) + ' s</div>'; };
    tick();
    const timer = setInterval(tick, 1000);
    if(pend) pend.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const limit = setTimeout(() => ctl && ctl.abort(), 150e3);
    try{
      const context = await askContext(x);
      const prev = ((ASK.conv[x.id] && ASK.conv[x.id].turns) || []).slice(-6).map(t => ({ q: t.q, a: t.a }));
      const r = await fetch("/api/ask", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history: prev, context }), signal: ctl ? ctl.signal : undefined });
      let j = null; try{ j = await r.json(); }catch(e){}
      if(!r.ok) throw new Error((j && j.error) || (r.status === 524 || r.status === 504 ? "Claude svarade inte i tid (HTTP " + r.status + "). Försök igen." : "HTTP " + r.status));
      if(!j || !j.answer) throw new Error("Tomt svar från servern");
      const c = ASK.conv[x.id] || (ASK.conv[x.id] = { id: String(x.id), turns: [] });
      c.turns.push({ q, a: j.answer, model: j.model || "", at: Date.now() });
      c.turns = c.turns.slice(-ASK_MAX_TURNS); c.at = Date.now();
      askSave(String(x.id));
      clearInterval(timer);
      draw();
      // Visa början av det nya svaret
      const as = $$("#askcard .a"); if(as.length) as[as.length-1].scrollIntoView({ block: "start", behavior: "smooth" });
    }catch(e){
      clearInterval(timer);
      const msg = e.name === "AbortError" ? "Inget svar på två och en halv minut. Försök igen." : e.message;
      if($("#ask-pending")) $("#ask-pending").innerHTML = "";
      if($("#ask-q") && !$("#ask-q").value) $("#ask-q").value = q;
      if($("#ask-status")) $("#ask-status").innerHTML = '<div class="banner" style="margin-top:8px">' + esc(msg) + '</div>';
    }finally{
      clearInterval(timer); clearTimeout(limit);
      ASK.busy = false;
      if($("#ask-go")) $("#ask-go").disabled = false;
    }
  };
  el.innerHTML = '<h2>Fråga Claude</h2><div class="note"><span class="spin"></span></div>';
  askLoad().then(draw);
  // Rita om när FIT-filen är läst, så att snabbfrågan om höjd dyker upp
  loadFit(x.id).then(() => { const c = ASK.conv[x.id]; if(!ASK.busy && !(c && c.turns && c.turns.length)) draw(); }).catch(() => {});
}

// ---------- Underlaget ----------
const r1 = v => v == null || !isFinite(v) ? null : Math.round(v*10)/10;
const r0 = v => v == null || !isFinite(v) ? null : Math.round(v);

// Medelvärden per tidsfönster, högst ~360 rader. Kolumner utan data tas bort.
function askSeries(recs, run){
  const pts = recs.filter(r => r.t != null);
  if(pts.length < 10) return null;
  const t0 = pts[0].t, durS = (pts[pts.length-1].t - t0)/1000;
  const step = Math.max(5, Math.ceil(durS/360/5)*5);
  const cols = ["sek", "puls", "hojd_m", "fart_m_s", "kadens", "effekt_w", "temp_c", "distans_m"];
  const rows = [];
  let bucket = [], bStart = 0;
  const flush = () => {
    if(!bucket.length) return;
    const avg = k => mean(bucket.map(r => r[k]));
    const lastDist = bucket.map(r => r.dist).filter(v => v != null).pop();
    rows.push([bStart, r0(avg("hr")), r1(avg("alt")), r1(avg("spd") != null ? avg("spd") : null), r0(avg("cad") != null && run ? avg("cad")*2 : avg("cad")), r0(avg("pwr")), r0(avg("temp")), r0(lastDist)]);
    bucket = [];
  };
  pts.forEach(r => {
    const s = Math.floor((r.t - t0)/1000/step)*step;
    if(s !== bStart){ flush(); bStart = s; }
    bucket.push(r);
  });
  flush();
  const keep = cols.map((c, i) => i === 0 || rows.some(row => row[i] != null));
  return {
    steg_sek: step,
    kolumner: cols.filter((c, i) => keep[i]),
    rader: rows.map(row => row.filter((v, i) => keep[i])),
  };
}

// Splittar per kilometer (löpning, gång) eller per 5 km (cykel)
function askSplits(recs, size){
  const pts = recs.filter(r => r.t != null && r.dist != null);
  if(pts.length < 20 || pts[pts.length-1].dist - pts[0].dist < size*0.8) return null;
  const out = [];
  let from = 0;
  for(let mark = pts[0].dist + size; ; mark += size){
    let to = pts.findIndex((r, i) => i > from && r.dist >= mark);
    const last = to < 0;
    if(last) to = pts.length - 1;
    const seg = pts.slice(from, to + 1);
    const d = seg[seg.length-1].dist - seg[0].dist, t = (seg[seg.length-1].t - seg[0].t)/1000;
    if(d < size*0.25) break;
    // Höjdmeter med 2 m hysteres, så att brus i barometern inte räknas
    let up = 0, down = 0;
    const alts = seg.map(r => r.alt).filter(v => v != null);
    let ref = alts[0];
    for(let i = 1; i < alts.length; i++){ const dd = alts[i] - ref; if(dd >= 2){ up += dd; ref = alts[i]; } else if(dd <= -2){ down -= dd; ref = alts[i]; } }
    out.push({
      nr: out.length + 1, meter: r0(d), sek: r0(t),
      tempo_min_km: d > 0 ? r1(t/60/(d/1000)) : null,
      puls: r0(mean(seg.map(r => r.hr))), puls_max: r0(Math.max(...seg.map(r => r.hr || 0)) || null),
      hojd_upp_m: alts.length > 1 ? r0(up) : null, hojd_ned_m: alts.length > 1 ? r0(down) : null,
    });
    if(last || out.length >= 60) break;
    from = to;
  }
  return out;
}

function askSummary(x){
  const o = {
    namn: x.name, typ: typeLabel(x.type), grupp: GROUP_NAME[x.grp], datum: dayKey(x.date), start: pad(x.date.getHours()) + ":" + pad(x.date.getMinutes()),
    tid_min: r1(x.dur/60), rorelsetid_min: x.moving ? r1(x.moving/60) : null,
    distans_km: x.dist ? r1(x.dist/1000) : null, snittfart_m_s: x.speed ? r1(x.speed) : null,
    snittpuls: r0(x.avgHR), maxpuls: r0(x.maxHR),
    pulszoner_min: x.zones ? x.zones.map(v => r1(v/60)) : null, andel_zon45: x.z45 != null ? r1(x.z45*100) : null,
    trimp_edwards: r0(x.zp), trimp_uppskattad: !!x.zpEst,
    hojdmeter_upp: r0(x.elev), kcal: r0(x.kcal), traningseffekt_aerob: x.teA, traningseffekt_anaerob: x.teAn,
    garmin_belastning: r0(x.load), vo2max: x.vo2 || null, effektivitetsfaktor: x.ef != null ? Math.round(x.ef*1000)/1000 : null,
    pulskvalitet: x.hrq ? x.hrq.state : null,
  };
  if(x.sets && x.sets.length) o.ovningar_enligt_klockan = x.sets.slice(0, 20).map(s => ({ rorelse: moveLabel(s.category), reps: s.reps, set: s.sets }));
  const lg = logFor(x);
  if(lg && lg.data){ const t = JSON.stringify(lg.data); o.loggat_pass = t.length < 6000 ? lg.data : t.slice(0, 6000); }
  Object.keys(o).forEach(k => { if(o[k] == null) delete o[k]; });
  return o;
}

function askPeers(x){
  return S.all.filter(p => p.type === x.type && p.id !== x.id).sort((a, b) => b.date - a.date).slice(0, 10).map(p => {
    const o = { datum: dayKey(p.date), tid_min: r1(p.dur/60), distans_km: p.dist ? r1(p.dist/1000) : null, snittpuls: r0(p.avgHR), maxpuls: r0(p.maxHR),
      tempo_min_km: p.speed && (p.grp === "run" || p.type === "walking" || p.type === "hiking") ? r1(1000/p.speed/60) : null,
      snittfart_m_s: p.speed && p.grp === "cyc" ? r1(p.speed) : null, hojdmeter_upp: r0(p.elev), trimp: r0(p.zp), andel_zon45: p.z45 != null ? r1(p.z45*100) : null };
    Object.keys(o).forEach(k => { if(o[k] == null) delete o[k]; });
    return o;
  });
}

async function askContext(x){
  const rest = hrRest(), max = hrMax();
  const ctx = { pass: askSummary(x), atlet: { maxpuls: r0(max.v), maxpuls_kalla: max.src, vilopuls: r0(rest.v), vilopuls_kalla: rest.src }, liknande_pass: askPeers(x) };
  try{
    const raw = await loadFit(x.id);
    const A = analyzeFit(raw, max.v, rest.v);
    const { recs } = fitClean(x, A, max.v);
    const run = x.grp === "run" || x.type === "walking" || x.type === "hiking";
    ctx.tidsserie = askSeries(recs, run);
    const sp = x.dist > 1500 ? askSplits(recs, x.grp === "cyc" ? 5000 : 1000) : null;
    if(sp) ctx.splittar = sp;
    const ban = x.hrq && x.hrq.state === "opalitlig" ? null : banister(recs, rest.v, max.v);
    if(ban != null) ctx.pass.trimp_banister = r0(ban);
    const dec = x.grp === "run" && x.hrOk !== false ? decoupling(recs) : null;
    if(dec) ctx.pass.aerob_avkoppling_procent = r1(dec.pct);
  }catch(e){ ctx.tidsserie = null; ctx.fil_saknas = "Originalfilen kunde inte läsas: " + e.message; }
  return ctx;
}

// ---------- Enkel, säker markdown för svaren ----------
// Texten escapas först. Sedan: rubriker (#), punktlistor (- eller *), numrerade listor, **fet**, *kursiv*, `kod`.
function mdLite(t){
  const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = String(t || "").replace(/\r/g, "").split("\n");
  let h = "", list = null, para = [];
  const endPara = () => { if(para.length){ h += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } };
  const endList = () => { if(list){ h += "</" + list + ">"; list = null; } };
  lines.forEach(raw => {
    const l = raw.trim();
    let m;
    if(!l){ endPara(); endList(); return; }
    if((m = /^#{1,4}\s+(.*)$/.exec(l))){ endPara(); endList(); h += "<h3>" + inline(m[1]) + "</h3>"; return; }
    if((m = /^[-*•]\s+(.*)$/.exec(l))){ endPara(); if(list !== "ul"){ endList(); h += "<ul>"; list = "ul"; } h += "<li>" + inline(m[1]) + "</li>"; return; }
    if((m = /^\d+[.)]\s+(.*)$/.exec(l))){ endPara(); if(list !== "ol"){ endList(); h += "<ol>"; list = "ol"; } h += "<li>" + inline(m[1]) + "</li>"; return; }
    if(/^\|.*\|$/.test(l)){ endList(); const row = l.replace(/^\||\|$/g, "").split("|").map(c => c.trim()).filter(c => c && !/^:?-+:?$/.test(c)).join(" · "); if(row) para.push(row); return; }
    endList(); para.push(l);
  });
  endPara(); endList();
  return h;
}

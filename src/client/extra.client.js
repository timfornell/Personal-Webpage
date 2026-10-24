// ---------- Dygnsdata och loggade pass ----------
async function loadDaily(days, rerenderAfter){
  try{
    const j = await api("/api/daily?days=" + days);
    S.daily = (j.daily || []).filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date));
    S.dailyDays = days; S.dailySources = j.sources || S.dailySources; S.dailyNote = j.note || null;
  }catch(e){ S.dailyNote = "Kunde inte hämta dygnsdata: " + e.message; }
  invalidate();
  if(rerenderAfter !== false) rerender();
}
async function loadLogs(){
  try{ const j = await api("/api/logs"); setLogs(j.logs || []); }catch(e){ setLogs([]); }
}
function setLogs(list){
  S.logs = list;
  S.logsByAct = {};
  list.slice().sort((a, b) => a.id - b.id).forEach(l => { if(l.activityId != null) S.logsByAct[String(l.activityId)] = l; });
}

// ---------- Loggade CrossFit-pass ----------
async function imageToDataUrl(file){
  try{
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000/Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width*scale); cv.height = Math.round(bmp.height*scale);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.85);
  }catch(e){
    if(!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Bildformatet stöds inte");
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("Kunde inte läsa bilden")); fr.readAsDataURL(file); });
  }
}
function pickImage(){
  return new Promise(res => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => res(inp.files && inp.files[0] || null);
    inp.click();
  });
}
// Läser en skärmdump med Claude och sparar passet direkt. Returnerar den sparade posten.
async function logFromImage(x, statusEl){
  if(!S.storage.db){ toast("Loggade pass kräver databasen"); return null; }
  const file = await pickImage(); if(!file) return null;
  const say = t => { if(statusEl) statusEl.innerHTML = '<div class="note"><span class="spin"></span>' + esc(t) + '</div>'; };
  try{
    say("Förbereder bilden …");
    const image = await imageToDataUrl(file);
    say("Claude läser passet …");
    const j = await api("/api/logs/parse", { method: "POST", body: { image } });
    const p = j.parsed || {};
    const date = x ? x.day : (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : dayKey(new Date()));
    const act = x || bestActivityFor(date);
    say("Sparar …");
    const r = await api("/api/logs", { method: "POST", body: { date, activityId: act ? act.id : null, data: Object.assign({ source: "bild" }, p) } });
    setLogs(S.logs.concat([r.log]));
    toast("Passet är sparat");
    return r.log;
  }catch(e){
    if(statusEl) statusEl.innerHTML = '<div class="banner">' + esc(e.message) + '</div>';
    else toast(e.message);
    return null;
  }
}
function bestActivityFor(date){
  const same = S.all.filter(x => x.day === date);
  return same.find(x => x.grp === "hiit") || same.find(x => x.grp === "str") || same[0] || null;
}

function renderLogCard(x){
  const el = $("#logcard"); if(!el) return;
  const lg = logFor(x);
  if(!S.storage.db){ el.innerHTML = '<h2>Loggat pass</h2>' + note("Loggade pass sparas i databasen, som inte är kopplad."); return; }
  if(!lg){
    el.innerHTML = '<h2>Loggat pass</h2><p class="sub" style="margin:0 0 8px">Spara vad du körde, från en skärmdump eller för hand. Då går passet att jämföra nästa gång du gör det.</p><div class="btnrow"><button class="btn small" id="lg-img">Från skärmdump</button><button class="btn ghost small" id="lg-hand">För hand</button></div><div id="lg-status"></div>' + (S.claude ? '' : '<div class="sub" style="margin-top:6px">För att läsa bilder behövs ANTHROPIC_API_KEY i Cloudflare, se Data-fliken.</div>');
    $("#lg-img").onclick = async () => { const l = await logFromImage(x, $("#lg-status")); if(l){ S.sheetDirty = true; renderLogCard(x); } };
    $("#lg-hand").onclick = () => openLogEditor(null, x);
    return;
  }
  el.innerHTML = '<h2>Loggat pass <small>' + esc(lg.data.source === "bild" ? "från skärmdump" : "för hand") + '</small></h2>' + logHtml(lg) + '<div class="btnrow" style="margin-top:10px"><button class="btn ghost small" id="lg-edit">Ändra</button></div>';
  $("#lg-edit").onclick = () => openLogEditor(lg, x);
}
function logHtml(lg){
  const d = lg.data || {}, sc = scoreOf(lg);
  let h = '<div class="verdict"><b style="font:700 18px var(--f-display)">' + esc(d.name || lg.name || "Namnlöst pass") + '</b>' + (d.format ? '<span class="pill">' + esc(d.format) + (d.timecap_min ? ' ' + num(d.timecap_min) + ' min' : '') + '</span>' : '') + (d.scaled && d.scaled !== "Okänt" ? '<span class="pill">' + esc(d.scaled) + '</span>' : '') + '</div>';
  if(d.result) h += '<div class="metrics" style="margin-bottom:8px"><div class="metric"><b>' + esc(d.result.text || (sc ? sc.txt : "–")) + '</b><span>Resultat</span></div></div>';
  if((d.movements || []).length) h += '<div class="ex">' + d.movements.map(m => '<div class="r"><span>' + esc(m.name) + '</span><em>' + esc([m.reps, m.load].filter(Boolean).join(" · ")) + '</em></div>').join("") + '</div>';
  if((d.parts || []).length) h += '<details class="raw" style="margin-top:8px"><summary>Passet som det stod</summary>' + d.parts.map(p => '<p style="margin:8px 0 0"><b>' + esc(p.title) + '</b><br>' + esc(p.text).replace(/\n/g, "<br>") + '</p>').join("") + '</details>';
  if(d.notes) h += '<p class="sub" style="margin:8px 0 0">' + esc(d.notes) + '</p>';
  const k = normName(d.name || lg.name);
  const same = S.logs.filter(l => l.id !== lg.id && normName(l.data.name || l.name) === k).sort((a, b) => a.date < b.date ? 1 : -1);
  if(same.length){
    h += '<h3 class="h3">Tidigare gånger</h3><div class="btnrow">' + same.map(l => '<button class="btn ghost small" data-log="' + l.id + '">' + esc(l.date) + (scoreOf(l) ? ' · ' + esc(scoreOf(l).txt) : '') + '</button>').join("") + '</div>';
  }
  return h;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-log]"); if(!b) return;
  const l = S.logs.find(l => String(l.id) === b.dataset.log); if(!l) return;
  const x = l.activityId != null ? byId(l.activityId) : null;
  if(x) openSession(x.id); else openLogEditor(l, null);
});

function parseClock(s){
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(s || "");
  if(!m) return null;
  return (+(m[1] || 0))*3600 + (+m[2])*60 + (+m[3]);
}
function openLogEditor(lg, x){
  const isNew = !lg;
  const d = isNew ? { name: "", format: "For time", scaled: "Okänt", movements: [], parts: [], result: null, notes: "", source: "hand" } : clone(lg.data);
  let date = isNew ? (x ? x.day : dayKey(new Date())) : lg.date;
  let actId = isNew ? (x ? x.id : (bestActivityFor(date) || {}).id) : lg.activityId;
  openSheet(isNew ? "Logga pass" : "Ändra loggat pass");
  const body = $("#sheet-body");
  const r = d.result || { kind: "tid", text: "" };
  const actOpts = () => {
    const near = S.all.filter(a => Math.abs(parseLocal(a.day) - parseLocal(date)) <= 2*DAY);
    return '<option value="">Inget Garmin-pass</option>' + near.map(a => '<option value="' + a.id + '"' + (String(a.id) === String(actId) ? " selected" : "") + '>' + esc(a.day + " " + pad(a.date.getHours()) + ":" + pad(a.date.getMinutes()) + " " + a.name) + '</option>').join("");
  };
  body.innerHTML = (isNew && S.claude ? '<div class="btnrow"><button class="btn ghost" id="le-img">Läs från skärmdump</button></div><div id="le-status"></div>' : '') +
    '<div class="form">' +
    '<label>Namn<input id="le-name" value="' + esc(d.name || "") + '" placeholder="t.ex. Fight Gone Bad"></label>' +
    '<label>Datum<input id="le-date" type="date" value="' + esc(date) + '"></label>' +
    '<label>Garmin-pass<select id="le-act">' + actOpts() + '</select></label>' +
    '<label>Format<select id="le-format">' + ["For time","AMRAP","EMOM","Intervaller","Rundor","Styrka","Annat"].map(f => '<option' + (f === d.format ? " selected" : "") + '>' + f + '</option>').join("") + '</select></label>' +
    '<label>Tidstak, minuter<input id="le-cap" inputmode="decimal" value="' + esc(d.timecap_min == null ? "" : d.timecap_min) + '"></label>' +
    '<label>Resultattyp<select id="le-rkind">' + [["tid","Tid"],["rundor_reps","Rundor + reps"],["reps","Reps"],["vikt","Vikt"],["kalorier","Kalorier"],["poäng","Poäng"],["annat","Annat"]].map(k => '<option value="' + k[0] + '"' + (k[0] === r.kind ? " selected" : "") + '>' + k[1] + '</option>').join("") + '</select></label>' +
    '<label>Resultat<input id="le-res" value="' + esc(r.text || "") + '" placeholder="t.ex. 12:34, 5 + 12 eller 80"></label>' +
    '<label>Rx eller skalat<select id="le-scaled">' + ["Rx","Scaled","Okänt"].map(f => '<option' + (f === d.scaled ? " selected" : "") + '>' + f + '</option>').join("") + '</select></label>' +
    '<label>Rörelser, en per rad: rörelse; reps; vikt<textarea id="le-moves" rows="5">' + esc((d.movements || []).map(m => [m.name, m.reps || "", m.load || ""].join("; ").replace(/(; )+$/, "")).join("\n")) + '</textarea></label>' +
    '<label>Passet som det stod<textarea id="le-parts" rows="6">' + esc((d.parts || []).map(p => p.title + "\n" + p.text).join("\n\n")) + '</textarea></label>' +
    '<label>Anteckningar<textarea id="le-notes" rows="2">' + esc(d.notes || "") + '</textarea></label>' +
    '</div><div class="btnrow"><button class="btn" id="le-save">Spara</button>' + (isNew ? '' : '<button class="btn ghost" id="le-del">Ta bort</button>') + '<button class="btn ghost" id="le-cancel">Avbryt</button></div><div id="le-err"></div>';
  $("#le-date").onchange = e => { date = e.target.value; $("#le-act").innerHTML = actOpts(); };
  $("#le-cancel").onclick = () => { if(x) openSession(x.id); else closeSheet(); };
  if($("#le-img")) $("#le-img").onclick = async () => { const l = await logFromImage(x, $("#le-status")); if(l){ S.sheetDirty = true; if(x) openSession(x.id); else openLogEditor(l, null); } };
  if($("#le-del")) $("#le-del").onclick = async () => {
    try{ await api("/api/logs/" + lg.id, { method: "DELETE" }); setLogs(S.logs.filter(l => l.id !== lg.id)); S.sheetDirty = true; if(x) openSession(x.id); else closeSheet(); }
    catch(e){ $("#le-err").innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; }
  };
  $("#le-save").onclick = async () => {
    const kind = $("#le-rkind").value, text = $("#le-res").value.trim();
    const res = text ? { kind, text, seconds: null, rounds: null, reps: null, value: null, unit: null } : null;
    if(res){
      if(kind === "tid") res.seconds = parseClock(text);
      else if(kind === "rundor_reps"){ const m = /(\d+)\s*(?:\+\s*(\d+))?/.exec(text); if(m){ res.rounds = +m[1]; res.reps = m[2] ? +m[2] : 0; } }
      else { const m = /(-?\d+(?:[.,]\d+)?)\s*([a-zA-ZåäöÅÄÖ]+)?/.exec(text); if(m){ res.value = parseFloat(m[1].replace(",", ".")); res.unit = m[2] || null; } }
    }
    const parts = $("#le-parts").value.trim() ? $("#le-parts").value.trim().split(/\n\s*\n/).map(b => { const lines = b.split("\n"); return { title: lines[0].trim(), text: lines.slice(1).join("\n").trim() }; }) : [];
    const data = Object.assign({}, d, {
      name: $("#le-name").value.trim(), format: $("#le-format").value, scaled: $("#le-scaled").value,
      timecap_min: $("#le-cap").value.trim() ? parseFloat($("#le-cap").value.replace(",", ".")) : null,
      result: res, notes: $("#le-notes").value.trim() || null, parts,
      movements: $("#le-moves").value.split("\n").map(l => l.split(";").map(s => s.trim())).filter(a => a[0]).map(a => ({ name: a[0], reps: a[1] || null, load: a[2] || null })),
    });
    const payload = { date: $("#le-date").value, activityId: $("#le-act").value || null, data };
    try{
      const j = isNew ? await api("/api/logs", { method: "POST", body: payload }) : await api("/api/logs/" + lg.id, { method: "PUT", body: payload });
      setLogs(isNew ? S.logs.concat([j.log]) : S.logs.map(l => l.id === lg.id ? j.log : l));
      S.sheetDirty = true; toast("Sparat");
      const target = j.log.activityId != null ? byId(j.log.activityId) : null;
      if(target) openSession(target.id); else closeSheet();
    }catch(e){ $("#le-err").innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; }
  };
}

// ---------- Persist: förslag och import ----------
async function loadSuggestions(R, el){
  if(!el) return;
  let h = '';
  if(!S.storage.db || !S.storage.persist){ el.innerHTML = '<div class="sub">Importera Persist-arkivet under Data, så föreslår sidan konkreta pass på den här nivån.</div>'; return; }
  el.innerHTML = '<div class="note"><span class="spin"></span></div>';
  try{
    const j = await api("/api/persist/suggest?pt=" + encodeURIComponent(R.L.pts.join(",")) + "&track=" + encodeURIComponent((CFG.persistTracks || []).join(",")) + "&limit=30");
    const pool = (j.sessions || []).slice(0, 12);
    if(!pool.length){ el.innerHTML = '<div class="sub">Inga Persist-pass av typen ' + esc(R.L.pts.join(", ")) + ' i de valda spåren.</div>'; return; }
    const start = Math.floor(Date.now()/DAY) % pool.length;
    const pick = [0, 1, 2].map(i => pool[(start + i) % pool.length]).filter((s, i, a) => a.indexOf(s) === i);
    S.persistPick = pick;
    h += '<div class="plist">' + pick.map((s, i) => '<button class="prow" data-persist="' + i + '"><b>' + esc(s.title || s.track) + '</b><span class="sub">' + esc(s.track) + (s.pt ? ' · ' + esc(s.pt) : '') + (s.dt ? ' · ' + esc(s.dt) : s.w ? ' · vecka ' + s.w + ' dag ' + s.dy : '') + (s.dur ? ' · ' + s.dur.join("–") + ' min' : '') + '</span></button>').join("") + '</div>';
    h += '<div class="sub" style="margin-top:6px">Spår: ' + esc((CFG.persistTracks || []).length ? CFG.persistTracks.join(", ") : "alla") + '. Ändra under Data.</div>';
    el.innerHTML = h;
  }catch(e){ el.innerHTML = '<div class="sub">Kunde inte hämta förslag: ' + esc(e.message) + '</div>'; }
}
document.addEventListener("click", e => { const b = e.target.closest("[data-persist]"); if(b && S.persistPick) openPersist(S.persistPick[+b.dataset.persist]); });
function openPersist(s){
  if(!s) return;
  openSheet(s.title || s.track);
  $("#sheet-body").innerHTML = '<div class="sub">' + esc([s.track, s.pt, s.dt, s.cycle, s.dur ? s.dur.join("–") + " min" : ""].filter(Boolean).join(" · ")) + '</div>' +
    ((s.eq || []).length ? '<div class="sub">Utrustning: ' + esc(s.eq.join(", ")) + '</div>' : '') +
    (s.sec || []).map(sec => '<section class="card"><h2>' + esc(sec.n) + (sec.f ? ' <small>' + esc(sec.f) + (sec.in ? ' · ' + esc(sec.in) : '') + '</small>' : '') + '</h2><div class="ptext">' + esc(sec.text || "").replace(/\n/g, "<br>") + '</div></section>').join("");
}
async function importPersist(file, statusEl){
  const say = t => statusEl.innerHTML = '<div class="note"><span class="spin"></span>' + esc(t) + '</div>';
  try{
    say("Läser filen …");
    const j = JSON.parse(await file.text());
    if(j.format !== "persist-katalog" || !Array.isArray(j.sessions)) throw new Error("Filen är inte en Persist-katalog");
    const list = j.sessions, n = 100;
    for(let i = 0; i < list.length; i += n){
      say("Sparar " + Math.min(list.length, i + n) + " av " + list.length + " pass …");
      await api("/api/persist", { method: "POST", body: { replace: i === 0, sessions: list.slice(i, i + n) } });
    }
    statusEl.innerHTML = '<div class="sub">' + list.length + ' pass importerade.</div>';
    const st = await api("/api/status"); S.storage = st.storage || S.storage;
    renderData();
  }catch(e){ statusEl.innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; }
}

// ---------- Data-fliken ----------
function renderData(){
  const st = S.storage || {};
  const oldest = S.all.length ? S.all[S.all.length-1].date : null;
  $("#hist-note").textContent = S.all.length ? S.all.length + " pass hämtade, från " + dateTxt(oldest, true) + ". Sidan hämtar ditt senaste år när den öppnas." : "Inga pass hämtade än.";
  $("#load3").hidden = S.loadedDays >= 1095;
  const when = t => t ? new Date(t).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "aldrig";
  if(!st.db){ $("#store-note").textContent = "Ingen databas är kopplad. Allt hämtas direkt från Garmin varje gång sidan öppnas, och inställningar sparas bara i den här webbläsaren."; $("#sync-now").hidden = true; }
  else {
    $("#store-note").textContent = st.stored + " pass och " + (st.daily || 0) + " dagar dygnsdata sparade, de senaste " + st.retainDays + " dagarna. Pass synkade " + when(st.lastSync) + ", dygnsdata " + when(st.lastDailySync) + ". " + (st.logs || 0) + " loggade pass och " + (st.persist || 0) + " Persist-pass sparas utan tidsgräns.";
    $("#sync-now").hidden = false;
  }
  // Dygnsdata: vad Garmin svarade
  const src = S.dailySources;
  const NAMES = { summary: "Dagssammanfattning", hrv: "HRV", sleep: "Sömn", bb: "Body Battery", stress: "Stress" };
  const FN = { rhr: "vilopuls", hrv: "HRV", sleepSec: "sömn", sleepScore: "sömnpoäng", stress: "stress", bbHigh: "Body Battery", bbLow: "Body Battery lägst", bbWake: "Body Battery morgon", steps: "steg", hrvLow: "HRV-baslinje", hrvHigh: "HRV-baslinje", hrvWeek: "HRV vecka", hrvStatus: "HRV-status", deepSec: "djupsömn", remSec: "REM", bbCharged: "laddning", bbDrained: "förbrukning", rhr7: "vilopuls 7 d" };
  if(!src) $("#daily-diag").innerHTML = note(S.dailyNote ? esc(S.dailyNote) : "Ingen dygnsdata hämtad än.");
  else $("#daily-diag").innerHTML = '<div class="ftable"><table>' + Object.entries(src).map(([k, v]) => '<tr><td>' + esc(NAMES[k] || k) + '</td><td class="v"><span class="code ' + (v.status === 200 ? "ok" : "err") + '">' + v.status + '</span></td><td class="v">' + (v.records || 0) + ' dagar</td><td>' + esc([...new Set((v.found || []).map(f => FN[f] || f))].join(", ") || (v.status === 200 ? "inga kända fält" : (v.error || ""))) + '</td></tr>').join("") + '</table></div>' +
    '<p class="sub" style="margin:8px 0 0">' + S.daily.length + ' dagar laddade' + (S.daily.length ? ', ' + S.daily.filter(d => d.hrv).length + ' med HRV, ' + S.daily.filter(d => d.rhr).length + ' med vilopuls och ' + S.daily.filter(d => d.sleepSec).length + ' med sömn' : '') + '.</p>' +
    '<details class="raw"><summary>Fältnamn som Garmin skickade</summary><pre>' + esc(Object.entries(src).map(([k, v]) => k + ": " + (v.fields || []).join(", ")).join("\n")) + '</pre></details>';
  // Puls
  const mx = hrMax(), rs = hrRest();
  $("#hr-max").placeholder = mx.v && mx.src !== "inställt" ? num(mx.v) + " (" + mx.src + ")" : "t.ex. 190";
  $("#hr-rest").placeholder = rs.v && rs.src !== "inställt" ? num(rs.v) + " (" + rs.src + ")" : "t.ex. 50";
  $("#hr-max").value = CFG.hr.max || ""; $("#hr-rest").value = CFG.hr.rest || "";
  // Claude
  $("#claude-note").innerHTML = S.claude ? "Claude läser skärmdumpar. Nyckeln finns i Cloudflare." : "Lägg in <b>ANTHROPIC_API_KEY</b> som Secret i Cloudflare (Settings → Variables and Secrets) för att läsa CrossFit-pass från skärmdumpar. Nyckeln skapas på console.anthropic.com och betalas per anrop, separat från ett Claude-abonnemang. Utan nyckel går pass att logga för hand.";
  // Persist
  $("#persist-note").textContent = !st.db ? "Kräver databasen." : st.persist ? st.persist + " Persist-pass importerade. Förslagen på Översikt hämtas från de valda spåren." : "Inget Persist-arkiv importerat. Välj filen persist-katalog.json.";
  $("#persist-file").disabled = !st.db;
  if(st.db && st.persist) api("/api/persist/tracks").then(j => {
    const tracks = {}; (j.tracks || []).forEach(t => { (tracks[t.track] = tracks[t.track] || []).push(t); });
    const chosen = CFG.persistTracks || [];
    $("#persist-tracks").innerHTML = '<div class="sub" style="margin:8px 0 4px">Spår att föreslå pass från (inga valda = alla)</div><div class="checks">' + Object.keys(tracks).sort().map(t => '<label><input type="checkbox" value="' + esc(t) + '"' + (chosen.includes(t) ? " checked" : "") + '> ' + esc(t) + ' <span class="sub">' + sum(tracks[t], x => x.n) + '</span></label>').join("") + '</div>';
    $("#persist-tracks .checks").onchange = () => { CFG.persistTracks = $$("#persist-tracks input:checked").map(i => i.value); saveCfg(); };
  }).catch(() => {}); else $("#persist-tracks").innerHTML = "";
  $("#cfg-note").textContent = st.db ? "Layout, egna kort, vyer och mått sparas i databasen och följer med mellan mobil och iPad." : "Utan databas sparas inställningarna bara i den här webbläsaren.";
}
$("#sync-now").onclick = async () => {
  const b = $("#sync-now"); b.disabled = true; b.innerHTML = '<span class="spin"></span>Synkar …';
  try{
    const j = await api("/api/sync", { method: "POST" });
    S.storage = j.storage; toast(j.fetched + " pass och " + ((j.daily && j.daily.days) || 0) + " dagar dygnsdata hämtade");
    if(j.daily && j.daily.sources) S.dailySources = j.daily.sources;
    await loadDaily(62, false); renderData();
  }catch(e){ toast("Synken misslyckades: " + e.message); }
  b.disabled = false; b.textContent = "Synka nu";
};
$("#load3").onclick = () => load(1095);
["#hr-max", "#hr-rest"].forEach(sel => $(sel).onchange = () => {
  const v = parseInt($(sel).value, 10);
  CFG.hr[sel === "#hr-max" ? "max" : "rest"] = v > 20 && v < 260 ? v : undefined;
  saveCfg(); invalidate(); toast("Sparat");
});
$("#persist-file").onchange = e => { const f = e.target.files && e.target.files[0]; if(f) importPersist(f, $("#persist-status")); e.target.value = ""; };
$("#cfg-json").onclick = openJsonEditor;
$("#cfg-reset").onclick = () => { if(!confirmTwice($("#cfg-reset"))) return; CFG = defaultCfg(); saveCfg(); invalidate(); toast("Inställningarna är återställda"); };
function confirmTwice(btn){
  if(btn.dataset.armed){ delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = "Tryck igen för att bekräfta";
  setTimeout(() => { if(btn.dataset.armed){ delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
  return false;
}

// ---------- Datakartan ----------
let PROBE = null;
$("#run-probe").onclick = async () => {
  const b = $("#run-probe"); b.disabled = true; b.innerHTML = '<span class="spin"></span>Kör …'; $("#probe-summary").innerHTML = "";
  try{ PROBE = await api("/api/probe"); renderProbe(); $("#copy-report").disabled = false; }
  catch(e){ $("#probe-summary").innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; }
  b.disabled = false; b.textContent = "Kör igen";
};
function renderProbe(){
  const ok = PROBE.results.filter(r => r.status === 200).length;
  $("#probe-summary").innerHTML = '<div class="kpis"><div class="kpi"><span>Delar som svarade</span><b>' + ok + '/' + PROBE.results.length + '</b></div><div class="kpi"><span>Pass senaste 90 d</span><b>' + PROBE.activityCount + '</b></div></div>';
  const el = $("#probe"); el.hidden = false;
  el.innerHTML = PROBE.results.map((r, i) => {
    const fields = Object.entries(r.fields || {}), filled = fields.filter(f => f[1].filled > 0).length, good = r.status === 200;
    return '<details data-i="' + i + '"><summary><span class="code ' + (good ? "ok" : "err") + '">' + r.status + '</span><span class="lbl">' + esc(r.label) + '<small>' + esc(r.path) + '</small></span><span class="cnt">' +
      (good ? (r.bytes && !fields.length ? Math.round(r.bytes/1024) + " kB" : r.records + " st<br>" + filled + "/" + fields.length + " fält") : "fel") + '</span></summary><div class="fields">' +
      (r.error ? '<div class="banner">' + esc(r.error) + '</div>' : "") +
      (fields.length ? '<div class="ftable"><table>' + fields.map(f => '<tr><td class="k' + (f[1].filled ? "" : " empty-field") + '">' + esc(f[0]) + '</td><td class="v">' + esc(f[1].types.join("/")) + '</td><td class="v">' + f[1].filled + '/' + f[1].seen + '</td></tr>').join("") + '</table></div>' : "") +
      ((good && fields.length && r.id !== "aktiviteter") ? '<div class="btnrow"><button class="btn ghost small rawbtn">Visa rådata</button></div><div class="rawbox"></div>' : "") + '</div></details>';
  }).join("");
}
$("#probe").onclick = async e => {
  const b = e.target.closest(".rawbtn"); if(!b) return;
  const d = b.closest("details"), r = PROBE.results[+d.dataset.i], box = d.querySelector(".rawbox");
  b.disabled = true; box.innerHTML = '<div class="note"><span class="spin"></span>Hämtar …</div>';
  try{ const path = r.raw ? "/api/raw?id=" + r.raw.activityId + "&kind=" + r.raw.kind : "/api/raw?ep=" + encodeURIComponent(r.id); const j = await api(path); box.innerHTML = '<pre>' + esc(JSON.stringify(j.data, null, 1)) + '</pre>'; }
  catch(err){ box.innerHTML = '<div class="banner">' + esc(err.message) + '</div>'; }
};
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); toast("Kopierat"); }
  catch(e){ const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); toast("Kopierat"); }catch(e2){ toast("Kunde inte kopiera"); } ta.remove(); }
}
$("#copy-report").onclick = () => {
  const lines = ["DATAKARTA " + PROBE.generated.slice(0,10), "Pass senaste 90 d: " + PROBE.activityCount, "Typer: " + Object.entries(PROBE.types).sort((a,b) => b[1]-a[1]).map(t => t[0] + " " + t[1]).join(", "), ""];
  PROBE.results.forEach(r => { lines.push("== " + r.label + "  HTTP " + r.status + "  " + r.records + " poster  " + r.ms + " ms"); lines.push("   " + r.path); if(r.error) lines.push("   FEL: " + String(r.error).replace(/\s+/g, " ").slice(0, 200)); Object.entries(r.fields || {}).forEach(f => lines.push("   " + f[0] + ": " + f[1].types.join("/") + " (" + f[1].filled + "/" + f[1].seen + ")")); lines.push(""); });
  copyText(lines.join("\n"));
};
$("#copy-daily").onclick = () => copyText("DYGNSDATA\n" + JSON.stringify(S.dailySources, null, 1));

// ---------- Anpassning: kortlayout, egna kort, sparade vyer, inställningar ----------
const BUILTIN = {
  oversikt: ["today","kpis","recovery","form","weeks","strain","zones","heat","recent","bench"],
  trender: ["trimpw","hr","dur","pace","ef","hrpace","volume","dist","vo2","z45","bench","moves","bb","wd","recovery","form","strain","weeks","zones"],
};
const DEFAULT_ON = {
  "oversikt": ["today","kpis","recovery","form","weeks","zones","heat","recent"],
  "trender:all": ["trimpw","hr","dur","z45","dist","strain","moves","bench","wd"],
  "trender:run": ["pace","ef","hrpace","volume","dist","vo2","hr","trimpw"],
  "trender:hiit": ["trimpw","z45","hr","bench","moves","bb","dur"],
  "trender:str": ["trimpw","moves","hr","dur","bb"],
  "trender:cyc": ["hr","dur","trimpw","dist","z45"],
  "trender:oth": ["dur","trimpw","hr"],
};
function defaultCfg(){
  return {
    v: 2, layouts: {}, cards: {}, profiles: {}, hr: {}, persistTracks: [],
    // Exemplen från dokumentet, som startpunkt. Ändra eller ta bort dem fritt.
    views: [
      { id: "v_hiit150", name: "Hårda HIIT-pass", conds: [{ field:"type", op:"eq", value:"g:hiit" }, { field:"avgHR", op:"gt", value:"150" }], sort: "date", charts: ["avgHR","trimp"] },
      { id: "v_run10", name: "Långa löppass", conds: [{ field:"type", op:"eq", value:"g:run" }, { field:"dist", op:"gt", value:"10" }, { field:"ago", op:"le", value:"90" }], sort: "date", charts: ["pace","ef"] },
      { id: "v_row", name: "Rodd i zon 4–5", conds: [{ field:"move", op:"has", value:"rodd" }, { field:"z45", op:"gt", value:"50" }], sort: "date", charts: ["z45"] },
    ],
  };
}
function fixCfg(c){
  const d = defaultCfg();
  if(!c || typeof c !== "object") return d;
  for(const k of Object.keys(d)) if(c[k] == null || typeof c[k] !== typeof d[k] || Array.isArray(c[k]) !== Array.isArray(d[k])) c[k] = d[k];
  return c;
}
const scopeTab = scope => scope.split(":")[0];
function defaultLayout(scope){
  const tab = scopeTab(scope), on = DEFAULT_ON[scope] || DEFAULT_ON[tab] || [];
  return on.map(id => ({ id, on: true })).concat(BUILTIN[tab].filter(id => !on.includes(id)).map(id => ({ id, on: false })));
}
function layoutFor(scope){
  const L = (CFG.layouts[scope] || defaultLayout(scope)).filter(e => CARDS[e.id] || CFG.cards[e.id]);
  const ids = new Set(L.map(e => e.id));
  BUILTIN[scopeTab(scope)].forEach(id => { if(!ids.has(id)) L.push({ id, on: false }); });
  return L;
}
function ownLayout(scope){ CFG.layouts[scope] = layoutFor(scope).map(e => ({ id: e.id, on: e.on })); return CFG.layouts[scope]; }
const curScope = () => S.tab === "trender" ? trendScope() : "oversikt";

function cardTitle(id){ const d = CARDS[id]; if(d) return d.title; const c = CFG.cards[id]; return c ? (c.title || autoTitle(c)) : id; }
const VIEW_NAMES = { line: "per pass", week: "per vecka", number: "nyckeltal", top: "topplista", dline: "per dag" };
function autoTitle(c){
  const m = c.src === "dygn" ? DMET[c.metric] : MET[c.metric];
  return (m ? m.label : c.metric) + " " + (VIEW_NAMES[c.view] || "") + (c.src !== "dygn" && c.filter && c.filter !== "page" && c.filter !== "all" ? " · " + selectorText(c.filter) : "");
}

function renderCards(scope){
  const tab = scopeTab(scope), box = $("#cards-" + tab), ctx = ctxFor(tab), L = layoutFor(scope);
  box.innerHTML = "";
  if(S.editing){
    const what = tab === "oversikt" ? "Översikten" : S.ttype ? "Trender för gruppen " + GROUP_NAME[groupOf(S.ttype)] + " (gäller alla typer i gruppen)" : "Trender för alla pass. Välj en typ ovan för att ändra just den passtypens profil";
    box.insertAdjacentHTML("beforeend", '<div class="edithead">Du ändrar ' + esc(what) + '. Flytta, dölj och lägg till kort. Allt sparas direkt.</div>');
  }
  L.forEach((e, i) => {
    if(!e.on && !S.editing) return;
    const def = CARDS[e.id], cc = CFG.cards[e.id];
    const sec = document.createElement("section");
    sec.className = (def && def.bare ? "bare" : "card") + (e.on ? "" : " off");
    sec.dataset.card = e.id;
    const ed = S.editing ? '<div class="edbar"><span class="en">' + esc(cardTitle(e.id)) + (cc ? ' <span class="pill tiny">eget</span>' : '') + '</span><span class="eb">' +
      '<button class="ib" data-ed="up" data-i="' + i + '" aria-label="Flytta upp"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="ib" data-ed="down" data-i="' + i + '" aria-label="Flytta ner"' + (i === L.length-1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="ib wide" data-ed="toggle" data-i="' + i + '">' + (e.on ? "Dölj" : "Visa") + '</button>' +
      (cc ? '<button class="ib wide" data-ed="edit" data-id="' + esc(e.id) + '">Ändra</button>' : '') + '</span></div>' : "";
    sec.innerHTML = ed + (def && def.bare ? "" : '<h2>' + esc(cardTitle(e.id)) + '</h2>') + '<div class="cbody"></div>';
    box.appendChild(sec);
    if(!e.on){ sec.querySelector(".cbody").innerHTML = '<div class="note" style="padding:6px">Dolt</div>'; return; }
    const body = sec.querySelector(".cbody");
    try{ def ? def.render(body, ctx) : renderCustom(body, cc, ctx); }
    catch(err){ body.innerHTML = note("Kortet kunde inte ritas: " + esc(err.message)); console.error(err); }
  });
  if(S.editing) box.insertAdjacentHTML("beforeend", '<div class="btnrow editfoot"><button class="btn" data-ed="add">+ Nytt kort</button><button class="btn ghost" data-ed="reset">Återställ fliken</button><button class="btn ghost" data-ed="done">Klar</button></div>');
}

function onEditClick(e){
  const b = e.target.closest("[data-ed]"); if(!b) return;
  const scope = curScope(), act = b.dataset.ed;
  if(act === "done"){ setEditing(false); return; }
  if(act === "add"){ openCardEditor(null); return; }
  if(act === "edit"){ openCardEditor(b.dataset.id); return; }
  if(act === "reset"){ delete CFG.layouts[scope]; saveCfg(); rerender(); return; }
  const L = ownLayout(scope), i = +b.dataset.i;
  if(act === "up" && i > 0) [L[i-1], L[i]] = [L[i], L[i-1]];
  if(act === "down" && i < L.length-1) [L[i+1], L[i]] = [L[i], L[i+1]];
  if(act === "toggle") L[i].on = !L[i].on;
  saveCfg(); rerender();
  const el = $('[data-card="' + L[act === "up" ? i-1 : act === "down" ? i+1 : i].id + '"]'); if(el) el.scrollIntoView({ block: "nearest" });
}
$("#cards-oversikt").addEventListener("click", onEditClick);
$("#cards-trender").addEventListener("click", onEditClick);
function setEditing(on){
  S.editing = on;
  $("#edit-btn").textContent = on ? "Klar" : "Anpassa";
  $("#edit-btn").setAttribute("aria-pressed", on);
  document.body.classList.toggle("editing", on);
  rerender();
}
$("#edit-btn").onclick = () => setEditing(!S.editing);

// ---------- Egna kort ----------
function aggregate(vals, how){
  const v = vals.filter(x => x != null && !isNaN(x));
  if(how === "count") return v.length;
  if(!v.length) return null;
  return how === "sum" ? sum(v) : how === "max" ? Math.max(...v) : how === "min" ? Math.min(...v) : how === "median" ? median(v) : mean(v);
}
const AGGS = [["", "Standard för måttet"], ["sum","Summa"], ["avg","Snitt"], ["median","Median"], ["max","Högsta"], ["min","Lägsta"], ["count","Antal"]];
function dailyRows(){
  const L = dailyLoads(), m = dmap();
  const keys = new Set(L.rows.map(r => r.key).concat(S.daily.map(d => d.date)));
  return [...keys].sort().map(k => Object.assign({ date: k, load: (L.byKey[k] || {}).load }, m[k] || {}));
}
function renderCustom(b, c, ctx){
  if(!c){ b.innerHTML = note("Kortet finns inte längre."); return; }
  const days = c.period && c.period !== "page" ? +c.period : ctx.days;
  const from = addDays(sod(new Date()), -days+1), prevFrom = addDays(from, -days);
  const daily = c.src === "dygn";
  const m = daily ? DMET[c.metric] : MET[c.metric];
  if(!m){ b.innerHTML = note("Okänt mått."); return; }
  const how = c.agg || m.agg;
  const fmt = v => daily ? (m.fmt ? m.fmt(v) : num(v, m.dec) + (m.unit ? " " + m.unit : "")) : fmtM(m, v);
  let items, prev;
  if(daily){
    const rows = dailyRows();
    const pick = (a, z) => rows.filter(d => { const t = parseLocal(d.date); return t >= a && t < z; }).map(d => ({ x: parseLocal(d.date), y: m.get(d), d })).filter(p => p.y != null && !isNaN(p.y));
    items = pick(from, addDays(sod(new Date()), 1)); prev = pick(prevFrom, from);
  } else {
    const sel = c.filter || "page";
    const pick = (a, z) => applySelector(S.all.filter(x => x.date >= a && x.date < z), sel).map(x => ({ x: x.date, y: m.get(x), ref: x, color: gColor(x.grp) })).filter(p => p.y != null && !isNaN(p.y)).sort((p, q) => p.x - q.x);
    items = pick(from, addDays(sod(new Date()), 1)); prev = pick(prevFrom, from);
  }
  if(!items.length){ b.innerHTML = note("Inga värden i perioden."); return; }
  b.innerHTML = '<div class="chart"></div><div class="readout"></div>';
  const ch = b.querySelector(".chart"), ro = b.querySelector(".readout");
  if(c.view === "number"){
    const v = aggregate(items.map(p => p.y), how), pv = aggregate(prev.map(p => p.y), how);
    let d = "";
    if(pv && S.loadedDays >= days*2){ const pct = (v - pv)/Math.abs(pv)*100; d = '<span class="delta ' + (Math.abs(pct) < 5 ? "flat" : (pct > 0) !== !!m.lower ? "up" : "down") + '">' + (pct > 0 ? "▲ " : "▼ ") + num(Math.abs(pct)) + ' % mot perioden innan</span>'; }
    ch.innerHTML = '<div class="kpi" style="padding:0"><b style="font-size:30px">' + esc(how === "count" ? num(v) : fmt(v)) + '</b>' + d + '</div>';
    ro.textContent = (AGGS.find(a => a[0] === how) || ["", how])[1] + " för " + items.length + (daily ? " dagar" : " pass") + ", senaste " + days + " dagarna.";
    return;
  }
  if(c.view === "week"){
    const nW = Math.max(4, Math.round(days/7));
    const w0 = addDays(monday(new Date()), -7*(nW-1));
    const buckets = Array.from({ length: nW }, () => []);
    items.forEach(p => { const i = Math.floor((monday(p.x) - w0)/(7*DAY) + 0.01); if(i >= 0 && i < nW) buckets[i].push(p.y); });
    const vals = buckets.map(bk => aggregate(bk, how) || 0);
    barChart(ch, buckets.map((_, i) => "v" + isoWeek(addDays(w0, 7*i))), [{ color: "var(--accent)", vals }], { h: 150, fmt: v => how === "count" ? num(v) : fmt(v), onPick: i => { ro.innerHTML = '<b>Vecka ' + isoWeek(addDays(w0, 7*i)) + '</b> · ' + esc(how === "count" ? num(vals[i]) : fmt(vals[i])) + ' · ' + buckets[i].length + (daily ? ' dagar' : ' pass'); } });
    return;
  }
  if(c.view === "top" && !daily){
    const top = items.slice().sort((p, q) => m.lower ? p.y - q.y : q.y - p.y).slice(0, 5);
    ch.outerHTML = '<div class="list flush">' + top.map(p => rowHtml(p.ref).replace('<small>', '<small>' + esc(fmt(p.y)) + ' · ')).join("") + '</div>';
    return;
  }
  if(daily){
    const avg = items.map((p, i) => ({ x: p.x, y: mean(items.slice(Math.max(0, i-6), i+1).map(q => q.y)) }));
    multiLine(ch, [{ color: "var(--muted)", pts: items, dots: true }, { color: "var(--accent)", pts: avg }], { fmt: v => fmt(v), onPick: x => { const p = items.find(q => +q.x === +x); if(p) ro.innerHTML = '<b>' + esc(dateTxt(p.x)) + '</b> · ' + esc(fmt(p.y)); } });
    ro.textContent = "Punkter per dag, linjen är ett 7-dagarssnitt.";
    return;
  }
  lineChart(ch, items, { invert: m.lower, fmt: v => fmt(v), onPick: p => pickSession2(ro, p) });
  ro.textContent = "Median " + fmt(median(items.map(p => p.y))) + ". Tryck på en punkt för att se passet.";
}

function selectorOptions(cur){
  const types = [...new Set(S.all.map(x => x.type))];
  const opts = [["page","Följ sidans typval"],["all","Alla pass"]].concat(GROUPS.map(g => ["g:"+g[0], g[1]]), types.map(t => ["t:"+t, typeLabel(t)]), (CFG.views || []).map(v => ["v:"+v.id, "Vy: " + v.name]));
  return opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + '>' + esc(o[1]) + '</option>').join("");
}

function openCardEditor(id){
  const isNew = !id;
  const c = isNew ? { src: "pass", metric: "trimp", view: "week", agg: "", filter: "page", period: "page", title: "" } : clone(CFG.cards[id]);
  openSheet(isNew ? "Nytt kort" : "Ändra kort");
  const body = $("#sheet-body");
  const metricOpts = () => (c.src === "dygn" ? DMETRICS : METRICS).map(m => '<option value="' + m.id + '"' + (m.id === c.metric ? " selected" : "") + '>' + esc(m.label) + '</option>').join("");
  const viewOpts = () => (c.src === "dygn" ? [["dline","Värde per dag"],["week","Per vecka"],["number","Nyckeltal"]] : [["line","Värde per pass"],["week","Per vecka"],["number","Nyckeltal"],["top","Topplista"]]).map(v => '<option value="' + v[0] + '"' + (v[0] === c.view ? " selected" : "") + '>' + v[1] + '</option>').join("");
  const draw = () => {
    body.innerHTML = '<div class="form">' +
      '<label>Titel<input id="ce-title" value="' + esc(c.title || "") + '" placeholder="' + esc(autoTitle(c)) + '"></label>' +
      '<label>Data<select id="ce-src"><option value="pass"' + (c.src !== "dygn" ? " selected" : "") + '>Pass</option><option value="dygn"' + (c.src === "dygn" ? " selected" : "") + '>Dygnsdata och belastning per dag</option></select></label>' +
      '<label>Mått<select id="ce-metric">' + metricOpts() + '</select></label>' +
      '<label>Visning<select id="ce-view">' + viewOpts() + '</select></label>' +
      '<label>Sammanställning<select id="ce-agg">' + AGGS.map(a => '<option value="' + a[0] + '"' + (a[0] === (c.agg || "") ? " selected" : "") + '>' + a[1] + '</option>').join("") + '</select></label>' +
      (c.src !== "dygn" ? '<label>Urval<select id="ce-filter">' + selectorOptions(c.filter || "page") + '</select></label>' : '') +
      '<label>Period<select id="ce-period">' + [["page","Följ sidan"],["7","7 dagar"],["28","4 veckor"],["84","12 veckor"],["365","1 år"]].map(p => '<option value="' + p[0] + '"' + (String(c.period || "page") === p[0] ? " selected" : "") + '>' + p[1] + '</option>').join("") + '</select></label>' +
      '</div><section class="card"><h2>Förhandsvisning</h2><div class="cbody" id="ce-prev"></div></section>' +
      '<div class="btnrow"><button class="btn" id="ce-save">Spara</button>' + (isNew ? '' : '<button class="btn ghost" id="ce-del">Ta bort kortet</button>') + '<button class="btn ghost" id="ce-cancel">Avbryt</button></div>';
    const read = () => {
      c.title = $("#ce-title").value.trim(); c.metric = $("#ce-metric").value; c.view = $("#ce-view").value; c.agg = $("#ce-agg").value; c.period = $("#ce-period").value;
      if($("#ce-filter")) c.filter = $("#ce-filter").value;
    };
    const prev = () => { read(); $("#ce-title").placeholder = autoTitle(c); try{ renderCustom($("#ce-prev"), c, ctxFor(S.tab === "trender" ? "trender" : "oversikt")); }catch(e){ $("#ce-prev").innerHTML = note(esc(e.message)); } };
    $("#ce-src").onchange = e => { read(); c.src = e.target.value; c.metric = c.src === "dygn" ? "hrv" : "trimp"; c.view = c.src === "dygn" ? "dline" : "week"; draw(); };
    ["#ce-metric","#ce-view","#ce-agg","#ce-filter","#ce-period"].forEach(s => { if($(s)) $(s).onchange = prev; });
    $("#ce-title").oninput = () => { c.title = $("#ce-title").value.trim(); };
    $("#ce-save").onclick = () => {
      read();
      const cid = id || "c_" + uid();
      CFG.cards[cid] = c;
      if(isNew){ const L = ownLayout(curScope()); L.unshift({ id: cid, on: true }); }
      saveCfg(); S.sheetDirty = true; closeSheet(); toast("Kortet är sparat");
    };
    if($("#ce-del")) $("#ce-del").onclick = () => {
      delete CFG.cards[id];
      Object.keys(CFG.layouts).forEach(k => CFG.layouts[k] = CFG.layouts[k].filter(e => e.id !== id));
      saveCfg(); S.sheetDirty = true; closeSheet();
    };
    $("#ce-cancel").onclick = closeSheet;
    prev();
  };
  draw();
}

// ---------- Sparade vyer (filter + sortering + diagram) ----------
function openViewEditor(id){
  const isNew = !id;
  const v = isNew ? { id: "v_" + uid(), name: "", conds: [{ field: "type", op: "eq", value: "g:hiit" }], sort: "date", charts: [] } : clone((CFG.views || []).find(x => x.id === id));
  if(!v) return;
  openSheet(isNew ? "Ny vy" : "Ändra vyn");
  const fields = fieldDefs();
  const body = $("#sheet-body");
  const condRow = (c, i) => {
    const f = fields.find(f => f.id === c.field) || fields[0];
    const ops = OPS[f.kind];
    const val = f.kind === "enum"
      ? '<select data-k="value" data-i="' + i + '">' + f.options.map(o => '<option value="' + esc(o[0]) + '"' + (String(c.value) === o[0] ? " selected" : "") + '>' + esc(o[1]) + '</option>').join("") + '</select>'
      : '<input data-k="value" data-i="' + i + '" value="' + esc(c.value == null ? "" : c.value) + '"' + (f.kind === "num" ? ' inputmode="decimal"' : '') + ' placeholder="värde">';
    return '<div class="cond"><select data-k="field" data-i="' + i + '">' + fields.map(ff => '<option value="' + ff.id + '"' + (ff.id === f.id ? " selected" : "") + '>' + esc(ff.label) + '</option>').join("") + '</select>' +
      '<select data-k="op" data-i="' + i + '">' + ops.map(o => '<option value="' + o[0] + '"' + (o[0] === c.op ? " selected" : "") + '>' + o[1] + '</option>').join("") + '</select>' + val +
      '<button class="ib" data-del="' + i + '" aria-label="Ta bort villkoret">✕</button></div>';
  };
  const draw = () => {
    const hits = S.all.filter(x => matchConds(x, v.conds, fields));
    body.innerHTML = '<div class="form"><label>Namn<input id="ve-name" value="' + esc(v.name) + '" placeholder="t.ex. Hårda HIIT-pass"></label></div>' +
      '<section class="card"><h2>Villkor <small>alla måste stämma</small></h2><div class="conds">' + v.conds.map(condRow).join("") + '</div><div class="btnrow" style="margin-top:8px"><button class="btn ghost small" id="ve-add">+ Villkor</button></div><div class="sub" style="margin-top:8px"><b>' + hits.length + '</b> pass matchar' + (hits.length ? ', senast ' + esc(dateTxt(hits[0].date)) : '') + '.</div></section>' +
      '<div class="form"><label>Sortering<select id="ve-sort">' + $("#sort").innerHTML + '</select></label></div>' +
      '<section class="card"><h2>Diagram i vyn <small>värde per pass</small></h2><div class="checks">' + METRICS.filter(m => m.id !== "count").map(m => '<label><input type="checkbox" value="' + m.id + '"' + (v.charts.includes(m.id) ? " checked" : "") + '> ' + esc(m.label) + '</label>').join("") + '</div></section>' +
      '<div class="btnrow"><button class="btn" id="ve-save">Spara</button>' + (isNew ? '' : '<button class="btn ghost" id="ve-del">Ta bort vyn</button>') + '<button class="btn ghost" id="ve-cancel">Avbryt</button></div>';
    $("#ve-sort").value = v.sort || "date";
    $("#ve-name").oninput = e => v.name = e.target.value;
    $("#ve-sort").onchange = e => v.sort = e.target.value;
    body.querySelector(".checks").onchange = () => v.charts = $$("#sheet-body .checks input:checked").map(i => i.value);
    body.querySelector(".conds").onchange = e => {
      const t = e.target, i = +t.dataset.i, k = t.dataset.k; if(!k) return;
      v.conds[i][k] = t.value;
      if(k === "field"){ const f = fields.find(f => f.id === t.value); v.conds[i].op = OPS[f.kind][0][0]; v.conds[i].value = f.kind === "enum" ? f.options[0][0] : ""; }
      draw();
    };
    body.querySelector(".conds").oninput = e => { const t = e.target; if(t.tagName === "INPUT") v.conds[+t.dataset.i].value = t.value; };
    body.querySelector(".conds").onclick = e => { const b = e.target.closest("[data-del]"); if(b){ v.conds.splice(+b.dataset.del, 1); draw(); } };
    $("#ve-add").onclick = () => { v.conds.push({ field: "avgHR", op: "gt", value: "" }); draw(); };
    $("#ve-save").onclick = () => {
      v.name = (v.name || "").trim() || "Vy " + ((CFG.views || []).length + 1);
      CFG.views = isNew ? (CFG.views || []).concat([v]) : (CFG.views || []).map(x => x.id === v.id ? v : x);
      saveCfg(); S.view = v.id; S.sort = v.sort || "date"; S.sortTouched = false; S.sheetDirty = true; closeSheet();
    };
    if($("#ve-del")) $("#ve-del").onclick = () => { CFG.views = CFG.views.filter(x => x.id !== v.id); if(S.view === v.id) S.view = ""; saveCfg(); S.sheetDirty = true; closeSheet(); };
    $("#ve-cancel").onclick = closeSheet;
  };
  draw();
}

// ---------- Inställningar som JSON ----------
function openJsonEditor(){
  openSheet("Inställningar som JSON");
  $("#sheet-body").innerHTML = '<p class="sub">Allt som går att anpassa på sidan: kortens ordning per flik och passtyp (layouts), egna kort (cards), sparade vyer (views), mått per passtyp (profiles), puls (hr) och Persist-spår (persistTracks).</p><textarea id="je" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea><div class="btnrow"><button class="btn" id="je-save">Spara</button><button class="btn ghost" id="je-cancel">Avbryt</button></div><div id="je-err"></div>';
  $("#je").value = JSON.stringify(CFG, null, 2);
  $("#je-save").onclick = () => {
    let c; try{ c = JSON.parse($("#je").value); }catch(e){ $("#je-err").innerHTML = '<div class="banner">Ogiltig JSON: ' + esc(e.message) + '</div>'; return; }
    if(JSON.stringify(c).length > 60000){ $("#je-err").innerHTML = '<div class="banner">För stora inställningar.</div>'; return; }
    CFG = fixCfg(c); saveCfg(); invalidate(); S.sheetDirty = true; closeSheet(); toast("Sparat");
  };
  $("#je-cancel").onclick = closeSheet;
}

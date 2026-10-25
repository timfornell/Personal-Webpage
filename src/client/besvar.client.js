// ---------- Besvär: var det gör ont, hur mycket det påverkar träningen, och hur det utvecklas ----------
// Varje besvär är en tråd med graderingar över tid. Skalan har fyra steg utan mitt och beskriver
// vad besväret gör med träningen, inte hur ont det gör. Inget besvär = ingen post.
const AREAS = [
  ["nacke", "Nacke", false, ["drag","tryck"]],
  ["axel", "Axel", true, ["tryck","drag"]],
  ["armbage", "Armbåge", true, ["tryck","drag"]],
  ["handled", "Handled och hand", true, ["tryck","drag"]],
  ["ovrerygg", "Övre rygg", false, ["drag"]],
  ["landrygg", "Ländrygg", false, ["ben","drag","bal"]],
  ["hoft", "Höft och ljumske", true, ["ben"]],
  ["sate", "Säte", true, ["ben"]],
  ["lar", "Lår", true, ["ben"]],
  ["kna", "Knä", true, ["ben"]],
  ["vad", "Underben och vad", true, ["ben"]],
  ["halsena", "Hälsena", true, ["ben"]],
  ["fot", "Fotled och fot", true, ["ben"]],
  ["annat", "Annat", false, []],
];
const AREA = Object.fromEntries(AREAS.map(a => [a[0], { id: a[0], label: a[1], sided: a[2], regs: a[3] }]));
const RUN_AREAS = ["hoft","sate","lar","kna","vad","halsena","fot"];
const SPOTS = ["framsida","baksida","utsida","insida"];
const SIDES = [["v","Vänster"],["h","Höger"],["b","Båda"]];
const PLVL = [
  null,
  { n: "Känns av", d: "Märks, men du tränar som vanligt.", cls: "good" },
  { n: "Begränsar lite", d: "Vissa rörelser får anpassas.", cls: "warn" },
  { n: "Begränsar mycket", d: "Du stryker övningar eller byter pass.", cls: "bad" },
  { n: "Stoppar", d: "Du kan inte träna den kroppsdelen.", cls: "bad" },
];
const WHEN = [["under","Under passet"],["efter","Direkt efter"],["dagen","Dagen efter"],["vardag","I vardagen"]];
const WHEN_TXT = Object.fromEntries(WHEN);

S.issues = [];
async function issuesLoad(){
  if(S.storage && S.storage.db){
    try{ const j = await api("/api/items/issue"); S.issues = Object.values(j.items || {}); return; }catch(e){}
  }
  S.issues = store.get("issues", []);
}
async function issueSave(i){
  i.updated = Date.now();
  const k = S.issues.findIndex(x => x.id === i.id);
  if(k >= 0) S.issues[k] = i; else S.issues.push(i);
  if(S.storage.db) await api("/api/items/issue/" + encodeURIComponent(i.id), { method: "PUT", body: i });
  else store.set("issues", S.issues);
}
async function issueDelete(i){
  S.issues = S.issues.filter(x => x.id !== i.id);
  if(S.storage.db) await api("/api/items/issue/" + encodeURIComponent(i.id), { method: "DELETE" });
  else store.set("issues", S.issues);
}

function issueLabel(i, lower){
  const a = AREA[i.area] || AREA.annat;
  let name = i.area === "annat" && i.note ? i.note.split(/[.\n]/)[0].slice(0, 40) : a.label;
  let t = !a.sided || !i.side ? name : i.side === "b" ? name + ", båda sidor" : (i.side === "h" ? "Höger " : "Vänster ") + name.toLowerCase();
  if((i.spots || []).length) t += ", " + listJoin(i.spots);
  return lower ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}
const ratingsOf = i => (i.r || []).slice().sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : (a.at || 0) - (b.at || 0));
const WHEN_ORDER = { under: 0, efter: 1, vardag: 2, dagen: 3 };
function lastRating(i){ const r = ratingsOf(i); return r.length ? r[r.length-1] : null; }
const daysAgo = d => Math.round((sod(new Date()) - parseLocal(d))/DAY);

// Läget för ett besvär: senaste nivån, om det blev värre dagen efter ett pass, och trenden över två veckor
function issueState(i){
  const R = ratingsOf(i), last = R[R.length-1] || null;
  const st = { last, lvl: last ? last.l : null, age: last ? daysAgo(last.d) : null, worse: null, rising: false };
  // Dagen efter mot direkt efter eller under, för samma pass
  const nd = R.filter(r => r.w === "dagen" && r.a != null).pop();
  if(nd && daysAgo(nd.d) <= 3){
    const ref = R.filter(r => String(r.a) === String(nd.a) && (r.w === "efter" || r.w === "under")).map(r => r.l);
    const before = ref.length ? Math.max(...ref) : null;
    if(before != null && nd.l > before) st.worse = { from: before, to: nd.l, x: byId(nd.a) };
  }
  const avg = (a, b) => mean(R.filter(r => { const g = daysAgo(r.d); return g >= a && g <= b; }).map(r => r.l));
  const now = avg(0, 6), prev = avg(7, 13);
  st.rising = now != null && prev != null && now >= prev + 0.5;
  st.now7 = now; st.prev7 = prev;
  return st;
}
const openIssues = () => S.issues.filter(i => !i.closed).sort((a, b) => (issueState(b).lvl || 0) - (issueState(a).lvl || 0));

// Snabbgradering: vad den räknas som beror på när du senast tränade
function quickContext(){
  const now = Date.now();
  const recent = S.all.find(x => now - (+x.date + x.dur*1000) < 3*3600e3 && now >= +x.date);
  if(recent) return { w: "efter", a: recent.id, x: recent };
  const yKey = dayKey(addDays(new Date(), -1));
  const y = S.all.filter(x => x.day === yKey)[0];
  if(y && !S.all.some(x => x.day === dayKey(new Date()))) return { w: "dagen", a: y.id, x: y };
  return { w: "vardag", a: null, x: null };
}
async function quickRate(id, lvl){
  const i = S.issues.find(x => x.id === id); if(!i) return;
  const today = dayKey(new Date());
  if(lvl === 0){ i.closed = today; }
  else {
    const c = quickContext();
    i.r = (i.r || []).filter(r => !(r.d === today && r.w === c.w && String(r.a) === String(c.a)));
    i.r.push({ id: uid(), d: today, w: c.w, l: lvl, a: c.a, at: Date.now() });
  }
  try{ await issueSave(i); toast(lvl === 0 ? "Besväret är avslutat" : "Sparat"); }catch(e){ toast("Kunde inte spara: " + e.message); }
  rerender();
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-qr]"); if(b){ e.preventDefault(); quickRate(b.dataset.qr, +b.dataset.l); return; }
  const o = e.target.closest("[data-issue]"); if(o){ e.preventDefault(); openIssue(o.dataset.issue === "new" ? null : o.dataset.issue, o.dataset.act ? { act: o.dataset.act } : null); }
});

function lvlPill(l, small){ const L = PLVL[l]; return L ? '<span class="pill ' + L.cls + (small ? ' tiny' : '') + '">' + l + ' ' + L.n.toLowerCase() + '</span>' : ''; }
// Graderingar senaste tre veckorna som en remsa, en ruta per dag
function issueStrip(i){
  const days = 21, byDay = {};
  ratingsOf(i).forEach(r => { byDay[r.d] = Math.max(byDay[r.d] || 0, r.l); });
  let h = '<div class="istrip" title="Senaste tre veckorna">';
  for(let k = days - 1; k >= 0; k--){ const d = dayKey(addDays(new Date(), -k)), l = byDay[d]; h += '<i class="l' + (l || 0) + '"></i>'; }
  return h + '</div>';
}
function quickRow(i){
  const today = dayKey(new Date()), c = quickContext();
  const done = (i.r || []).find(r => r.d === today && r.w === c.w && String(r.a) === String(c.a));
  return '<div class="qr"><span class="sub">' + (c.w === "dagen" ? "Dagen efter " + esc(c.x.name) : c.w === "efter" ? "Efter " + esc(c.x.name) : "I dag") + '</span><span class="qb">' +
    [1,2,3,4].map(l => '<button class="lv l' + l + '" data-qr="' + i.id + '" data-l="' + l + '" aria-pressed="' + (done && done.l === l) + '" title="' + PLVL[l].n + '">' + l + '</button>').join("") +
    '<button class="lv gone" data-qr="' + i.id + '" data-l="0">Borta</button></span></div>';
}

const scaleLine = () => '<div class="sub" style="font-size:12px;margin-top:2px">' + [1,2,3,4].map(l => l + ' ' + PLVL[l].n.toLowerCase()).join(" · ") + '</div>';
CARDS.besvar = { title: "Besvär", tabs: ["oversikt"], render(b){
  const open = openIssues(), closed = S.issues.filter(i => i.closed);
  let h = '';
  if(!open.length) h += '<p class="sub" style="margin:0 0 8px">Inga öppna besvär. Gör något ont, lägg in det här, så följer sidan upp det och tar hänsyn till det i dagens plan.</p>';
  open.forEach(i => {
    const st = issueState(i);
    h += '<div class="issue"><button class="ihead" data-issue="' + i.id + '"><b>' + esc(issueLabel(i)) + '</b>' + (st.lvl ? lvlPill(st.lvl, true) : '') + '</button>' +
      '<div class="sub">' + (st.last ? 'Senast ' + esc(relDay(parseLocal(st.last.d))) + ', ' + esc(WHEN_TXT[st.last.w].toLowerCase()) + (st.worse ? '. Värre dagen efter ' + esc(st.worse.x ? st.worse.x.name : "passet") + ' (' + st.worse.from + ' till ' + st.worse.to + ')' : '') + (st.rising ? '. Ökar mot förra veckan' : '') + '.' : 'Ingen gradering än.') + '</div>' +
      issueStrip(i) + quickRow(i) + '</div>';
  });
  if(open.length) h += scaleLine();
  h += '<div class="btnrow" style="margin-top:10px"><button class="btn small" data-issue="new">Nytt besvär</button></div>';
  if(closed.length) h += '<details class="how"><summary>Avslutade (' + closed.length + ')</summary><div class="btnrow" style="margin-top:8px">' + closed.sort((a, b) => a.closed < b.closed ? 1 : -1).map(i => '<button class="btn ghost small" data-issue="' + i.id + '">' + esc(issueLabel(i)) + ' · ' + esc(i.closed) + '</button>').join("") + '</div></details>';
  h += '<details class="how"><summary>Skalan</summary>' + [1,2,3,4].map(l => '<p><b>' + l + ' ' + PLVL[l].n + '.</b> ' + PLVL[l].d + '</p>').join("") + '<p>Gradera gärna både direkt efter ett pass och dagen efter. Om det är värre dagen efter är det ett tecken på att belastningen var för hög. Den regeln kommer från smärtmonitoreringsmodellen (Silbernagel 2007), som studerades på hälsenebesvär: smärtan ska ha lagt sig till morgonen efter och inte öka från vecka till vecka. Sidan ställer ingen diagnos.</p></details>';
  b.innerHTML = h;
}};

// ---------- Ett besvär: nytt, historik och ny gradering ----------
function ratingForm(pre){
  const date = pre.d || dayKey(new Date());
  const near = S.all.filter(a => Math.abs(parseLocal(a.day) - parseLocal(date)) <= 2*DAY);
  return '<div class="form">' +
    '<label>Hur mycket påverkar det träningen?</label><div class="lvls">' + [1,2,3,4].map(l => '<button class="lvb l' + l + '" data-pick="' + l + '" aria-pressed="' + (pre.l === l) + '"><b>' + l + ' ' + PLVL[l].n + '</b><span>' + PLVL[l].d + '</span></button>').join("") + '</div>' +
    '<label>När<select id="ir-w">' + WHEN.map(w => '<option value="' + w[0] + '"' + (w[0] === pre.w ? ' selected' : '') + '>' + w[1] + '</option>').join("") + '</select></label>' +
    '<label>Datum<input id="ir-d" type="date" value="' + esc(date) + '"></label>' +
    '<label>Pass<select id="ir-a"><option value="">Inget pass</option>' + near.map(a => '<option value="' + a.id + '"' + (String(a.id) === String(pre.a) ? ' selected' : '') + '>' + esc(a.day + ' ' + pad(a.date.getHours()) + ':' + pad(a.date.getMinutes()) + ' ' + a.name) + '</option>').join("") + '</select></label>' +
    '<label>Anteckning<input id="ir-n" value="' + esc(pre.n || "") + '" placeholder="t.ex. ont i utfallen, inte i knäböj"></label></div>';
}
function wireRatingForm(state){
  $$("#sheet-body .lvb").forEach(b => b.onclick = () => { state.l = +b.dataset.pick; $$("#sheet-body .lvb").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  // Dagen efter ett pass: datumet flyttas en dag fram
  $("#ir-w").onchange = () => { const a = byId($("#ir-a").value); if(a) $("#ir-d").value = $("#ir-w").value === "dagen" ? dayKey(addDays(a.date, 1)) : a.day; };
  $("#ir-a").onchange = () => { const a = byId($("#ir-a").value); if(a) $("#ir-d").value = $("#ir-w").value === "dagen" ? dayKey(addDays(a.date, 1)) : a.day; };
}
function readRating(state){
  if(!state.l) throw new Error("Välj en nivå");
  const d = $("#ir-d").value; if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Välj ett datum");
  return { id: uid(), d, w: $("#ir-w").value, l: state.l, a: $("#ir-a").value || null, n: $("#ir-n").value.trim() || null, at: Date.now() };
}
function placeForm(i){
  const a = AREA[i.area];
  return '<label class="sub">Var</label><div class="chips wrapchips" id="ip-area">' + AREAS.map(x => '<button class="chip" data-v="' + x[0] + '" aria-pressed="' + (i.area === x[0]) + '">' + x[1] + '</button>').join("") + '</div>' +
    '<div id="ip-side"' + (a && a.sided ? '' : ' hidden') + '><label class="sub">Sida</label><div class="seg">' + SIDES.map(s => '<button data-v="' + s[0] + '" aria-pressed="' + (i.side === s[0]) + '">' + s[1] + '</button>').join("") + '</div></div>' +
    '<label class="sub">Mer exakt, om du vill</label><div class="chips wrapchips" id="ip-spot">' + SPOTS.map(s => '<button class="chip" data-v="' + s + '" aria-pressed="' + (i.spots || []).includes(s) + '">' + s + '</button>').join("") + '</div>' +
    '<div class="form"><label>Beskrivning<input id="ip-note" value="' + esc(i.note || "") + '" placeholder="t.ex. under knäskålen, hugger vid djupa böj"></label></div>';
}
function wirePlaceForm(i){
  $("#ip-area").onclick = e => { const b = e.target.closest("button"); if(!b) return; i.area = b.dataset.v; $$("#ip-area button").forEach(x => x.setAttribute("aria-pressed", x === b)); $("#ip-side").hidden = !AREA[i.area].sided; if(!AREA[i.area].sided) i.side = null; };
  $("#ip-side").onclick = e => { const b = e.target.closest("button"); if(!b) return; i.side = b.dataset.v; $$("#ip-side button").forEach(x => x.setAttribute("aria-pressed", x === b)); };
  $("#ip-spot").onclick = e => { const b = e.target.closest("button"); if(!b) return; const v = b.dataset.v, on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on); i.spots = SPOTS.filter(s => s === v ? on : (i.spots || []).includes(s)); };
}
function backTo(opts){ if(opts && opts.act && byId(opts.act)) openSession(opts.act); else closeSheet(); }

function openIssue(id, opts){
  opts = opts || {};
  const fromAct = opts.act ? byId(opts.act) : null;
  const preR = fromAct ? { w: "efter", a: fromAct.id, d: fromAct.day } : (() => { const c = quickContext(); return { w: c.w, a: c.a, d: dayKey(new Date()) }; })();
  if(!id){
    const i = { id: "b" + Date.now().toString(36) + uid().slice(0, 3), area: null, side: null, spots: [], note: "", start: dayKey(new Date()), closed: null, r: [] };
    const st = { l: null };
    openSheet("Nytt besvär");
    $("#sheet-body").innerHTML = '<section class="card">' + placeForm(i) + '</section><section class="card"><h2>Första graderingen</h2>' + ratingForm(preR) + '</section><div class="btnrow"><button class="btn" id="ip-save">Spara</button><button class="btn ghost" id="ip-cancel">Avbryt</button></div><div id="ip-err"></div>';
    wirePlaceForm(i); wireRatingForm(st);
    $("#ip-cancel").onclick = () => backTo(opts);
    $("#ip-save").onclick = async () => {
      try{
        if(!i.area) throw new Error("Välj var det gör ont");
        if(AREA[i.area].sided && !i.side) throw new Error("Välj sida");
        i.note = $("#ip-note").value.trim();
        const r = readRating(st); i.r = [r]; i.start = r.d;
        await issueSave(i); S.sheetDirty = true; toast("Sparat"); backTo(opts);
      }catch(e){ $("#ip-err").innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; }
    };
    return;
  }
  const i = S.issues.find(x => x.id === id); if(!i) return;
  const st = { l: null }, ist = issueState(i);
  openSheet(issueLabel(i));
  let h = '<div class="verdict">' + (ist.lvl ? lvlPill(ist.lvl) : '') + '<span class="sub">' + (i.closed ? 'Avslutat ' + esc(i.closed) : 'Sedan ' + esc(i.start || "")) + '</span></div>';
  if(i.note) h += '<p class="sub" style="margin:0">' + esc(i.note) + '</p>';
  const R = ratingsOf(i);
  if(R.length >= 2) h += '<section class="card"><h2>Utveckling</h2><div class="chart" id="ch-issue"></div></section>';
  h += '<section class="card"><h2>Ny gradering</h2>' + ratingForm(preR) + '<div class="btnrow" style="margin-top:10px"><button class="btn" id="ir-save">Spara gradering</button></div><div id="ir-err"></div></section>';
  h += '<section class="card"><h2>Graderingar <small>' + R.length + '</small></h2><div class="ilog">' + R.slice().reverse().map(r => { const a = r.a != null ? byId(r.a) : null; return '<div class="r"><span><b>' + esc(dateTxt(parseLocal(r.d))) + '</b> · ' + esc(WHEN_TXT[r.w] || "") + (a ? ' · ' + esc(a.name) : '') + (r.n ? '<span class="sub" style="display:block">' + esc(r.n) + '</span>' : '') + '</span>' + lvlPill(r.l, true) + '<button class="btn ghost small" data-delr="' + r.id + '" aria-label="Ta bort">✕</button></div>'; }).join("") + '</div></section>';
  h += '<details class="how card"><summary>Ändra plats</summary>' + placeForm(i) + '<div class="btnrow" style="margin-top:8px"><button class="btn small" id="ip-save">Spara plats</button></div></details>';
  h += '<div class="btnrow">' + (i.closed ? '<button class="btn ghost" id="i-reopen">Öppna igen</button>' : '<button class="btn ghost" id="i-close">Avsluta, det är borta</button>') + '<button class="btn ghost" id="i-del">Ta bort besväret</button></div>';
  $("#sheet-body").innerHTML = h;
  if(R.length >= 2){
    const pts = R.map(r => ({ x: parseLocal(r.d), y: r.l }));
    multiLine($("#ch-issue"), [{ color: "var(--warn)", pts, dots: true, line: true, gap: 30*DAY }], { h: 110, min: 1, fmt: v => num(v, 1), xfmt: t => shortDate(new Date(t)) });
  }
  wireRatingForm(st);
  const save = async () => { await issueSave(i); S.sheetDirty = true; };
  $("#ir-save").onclick = async () => { try{ const r = readRating(st); i.r = (i.r || []).concat([r]); if(i.closed) i.closed = null; await save(); toast("Sparat"); if(opts.act) backTo(opts); else openIssue(i.id); }catch(e){ $("#ir-err").innerHTML = '<div class="banner">' + esc(e.message) + '</div>'; } };
  $$("[data-delr]").forEach(b => b.onclick = async () => { i.r = (i.r || []).filter(r => r.id !== b.dataset.delr); await save(); openIssue(i.id, opts); });
  const copy = clone(i); wirePlaceForm(copy);
  $("#ip-save").onclick = async () => { if(!copy.area) return; Object.assign(i, { area: copy.area, side: AREA[copy.area].sided ? copy.side : null, spots: copy.spots, note: $("#ip-note").value.trim() }); await save(); toast("Sparat"); openIssue(i.id, opts); };
  if($("#i-close")) $("#i-close").onclick = async () => { i.closed = dayKey(new Date()); await save(); toast("Besväret är avslutat"); backTo(opts); };
  if($("#i-reopen")) $("#i-reopen").onclick = async () => { i.closed = null; await save(); openIssue(i.id, opts); };
  $("#i-del").onclick = async () => { if(!confirmTwice($("#i-del"))) return; await issueDelete(i); S.sheetDirty = true; toast("Borttaget"); backTo(opts); };
}

// ---------- I passvyn ----------
function renderIssueCard(x){
  const el = $("#issuecard"); if(!el) return;
  const linked = [];
  S.issues.forEach(i => (i.r || []).forEach(r => { if(String(r.a) === String(x.id)) linked.push({ i, r }); }));
  const open = S.issues.filter(i => !i.closed);
  let h = '<h2>Besvär</h2>';
  if(linked.length) h += '<div class="ilog">' + linked.sort((a, b) => (WHEN_ORDER[a.r.w] || 0) - (WHEN_ORDER[b.r.w] || 0)).map(o => '<div class="r"><span><b>' + esc(issueLabel(o.i)) + '</b> · ' + esc((WHEN_TXT[o.r.w] || "").toLowerCase()) + (o.r.n ? '<span class="sub" style="display:block">' + esc(o.r.n) + '</span>' : '') + '</span>' + lvlPill(o.r.l, true) + '</div>').join("") + '</div>';
  else h += '<p class="sub" style="margin:0 0 8px">Gjorde något ont under eller efter passet? Gradera det här, så kopplas det till passet. Du kan också gradera dagen efter.</p>';
  h += '<div class="btnrow" style="margin-top:8px">' + open.map(i => '<button class="btn ghost small" data-issue="' + i.id + '" data-act="' + x.id + '">' + esc(issueLabel(i)) + '</button>').join("") + '<button class="btn small" data-issue="new" data-act="' + x.id + '">Nytt besvär</button></div>';
  el.innerHTML = h;
}

// ---------- För dagens plan ----------
// Bara besvär graderade senaste sju dagarna påverkar planen
function issuePlan(){
  const doL = [], avoid = [], regs = new Set(), strict = new Set(), ask = [];
  openIssues().forEach(i => {
    const st = issueState(i), lbl = issueLabel(i, true), a = AREA[i.area] || AREA.annat;
    if(!st.last || st.age > 7){ ask.push(i); return; }
    const when = relDay(parseLocal(st.last.d));
    if(st.lvl >= 3) a.regs.forEach(r => regs.add(r));
    if(st.lvl === 4) a.regs.slice(0, 1).forEach(r => strict.add(r));
    if(st.lvl === 4) avoid.push({ t: "Allt som belastar " + lbl, why: "Graderat som Stoppar " + when + ". Håller det i sig mer än några dagar är det värt att låta en fysioterapeut eller läkare titta på det." });
    else if(st.lvl === 3) avoid.push({ t: "Övningar som gör ont i " + lbl + (RUN_AREAS.includes(i.area) ? ", och löpning och hopp" : ""), why: "Begränsar mycket sedan " + when + "." });
    else if(st.lvl === 2) doL.push({ t: "Anpassa övningarna för " + lbl, why: "Begränsar lite. Välj varianter som inte gör ondare, och gradera igen i morgon: det ska inte vara värre dagen efter." });
    if(st.worse) avoid.push({ t: "Samma belastning som " + (st.worse.x ? st.worse.x.name : "senaste passet"), why: issueLabel(i) + " var " + st.worse.from + " direkt efter och " + st.worse.to + " dagen efter. Enligt smärtmonitoreringsmodellen (Silbernagel 2007) betyder det att belastningen var för hög." });
    else if(st.rising) avoid.push({ t: "Att öka belastningen på " + lbl, why: "Graderingen har gått upp från " + num(st.prev7, 1) + " till " + num(st.now7, 1) + " i snitt mot förra veckan. Besvär ska inte öka från vecka till vecka (Silbernagel 2007)." });
  });
  return { doL, avoid, regs: [...regs], strict: [...strict], ask };
}

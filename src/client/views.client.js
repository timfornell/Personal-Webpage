// ---------- Flikar och inbyggda kort ----------
function invalidate(){ LOADC = null; CALC = {}; S._dmap = null; HRMAXC = null; applyHrq(); }
const RENDER = { oversikt: renderOverview, pass: renderPass, trender: renderTrends, data: renderData };
function showTab(name){
  if(!RENDER[name]) name = "oversikt";
  S.tab = name; store.set("tab", name);
  $$(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name));
  ["oversikt","pass","trender","data"].forEach(t => { $("#view-"+t).hidden = t !== name || (!S.all.length && t !== "data"); });
  $("#edit-btn").hidden = !(name === "oversikt" || name === "trender") || !S.all.length;
  RENDER[name]();
}
function rerender(){ if(S.all.length || S.tab === "data") RENDER[S.tab](); }

function segment(el, options, value, onPick){
  el.innerHTML = options.map(o => '<button data-v="' + o[0] + '" aria-pressed="' + (o[0] === value) + '">' + o[1] + '</button>').join("");
  el.onclick = e => { const b = e.target.closest("button"); if(b) onPick(+b.dataset.v); };
}
const PERIODS = [[7,"7 d"],[28,"4 v"],[84,"12 v"],[365,"1 år"]];
function openBtn(id){ return '<button class="btn ghost small" data-open="' + id + '">Öppna</button>'; }
document.addEventListener("click", e => { const b = e.target.closest("[data-open]"); if(b){ e.preventDefault(); openSession(b.dataset.open); } });
const note = t => '<div class="note">' + t + '</div>';

function ctxFor(tab){
  const now = new Date();
  if(tab === "oversikt"){
    const days = S.period, from = addDays(sod(now), -days+1), prevFrom = addDays(from, -days);
    return { tab, days, from, cur: S.all.filter(x => x.date >= from), prev: S.all.filter(x => x.date >= prevFrom && x.date < from), sel: S.all.filter(x => x.date >= from).slice().sort((a,b) => a.date-b.date) };
  }
  const days = S.tperiod, from = addDays(sod(now), -days+1);
  const inP = S.all.filter(x => x.date >= from);
  return { tab, days, from, inP, cur: inP, sel: inP.filter(x => !S.ttype || x.type === S.ttype).slice().sort((a,b) => a.date-b.date) };
}
function weekIndex(list, nW){
  const w0 = addDays(monday(new Date()), -7*(nW-1));
  const idx = x => Math.floor((monday(x.date) - w0)/(7*DAY) + 0.01);
  return { w0, weeks: Array.from({length:nW}, (_, i) => addDays(w0, 7*i)), idx };
}
const nWeeksFor = days => Math.min(52, Math.max(8, Math.ceil(days/7)));

const CARDS = {
  // ----- Översikt -----
  // Kortet "I dag" finns i plan.client.js
  kpis: { title: "Nyckeltal", tabs: ["oversikt"], bare: true, render(b, c){
    const canCmp = S.loadedDays >= c.days*2, weeksIn = c.days/7;
    const kp = [
      ["Pass", c.cur.length, c.prev.length, v => num(v)],
      ["Träningstid", sum(c.cur, x => x.dur), sum(c.prev, x => x.dur), v => hm(v)],
      ["Belastning (TRIMP)", sum(c.cur, x => x.zp), sum(c.prev, x => x.zp), v => num(v)],
      ["Intensitetsminuter / vecka", sum(c.cur, x => x.im)/weeksIn, sum(c.prev, x => x.im)/weeksIn, v => num(v)],
    ];
    b.innerHTML = '<div class="kpis">' + kp.map(k => {
      let d = "";
      if(canCmp && k[2]){ const p = (k[1]-k[2])/k[2]*100; const cls = Math.abs(p) < 5 ? "flat" : p > 0 ? "up" : "down"; d = '<span class="delta ' + cls + '">' + (p>0?"▲ ":p<0?"▼ ":"") + num(Math.abs(p)) + ' % mot förra ' + (c.days === 7 ? "veckan" : "perioden") + '</span>'; }
      else if(canCmp) d = '<span class="delta flat">ingen jämförelse</span>';
      return '<div class="kpi"><span>' + k[0] + '</span><b>' + k[3](k[1]) + '</b>' + d + '</div>';
    }).join("") + '</div>';
  }},
  recovery: { title: "Återhämtning", tabs: ["oversikt","trender"], render(b, c){
    if(!S.daily.length){
      b.innerHTML = note(S.dailyNote ? esc(S.dailyNote) : "Ingen dygnsdata från Garmin än. Se Data-fliken för vad Garmin svarade.");
      return;
    }
    const days = Math.max(c.days, 28);
    let h = "";
    const q = s => b.querySelector(s);
    if(c.tab === "trender" && days > S.dailyDays && S.dailyDays < 365) h += '<div class="btnrow" style="margin-bottom:8px"><button class="btn ghost small more-daily">Hämta dygnsdata för hela perioden</button></div>';
    const from = addDays(sod(new Date()), -days+1);
    const rows = S.daily.filter(d => parseLocal(d.date) >= from);
    const hrvRows = rows.filter(d => d.hrv > 0);
    h += '<div class="sub">HRV per natt, 7-dagarssnitt och ditt band</div><div class="chart ch-hrv"></div><div class="readout ro-hrv"></div>';
    h += '<div class="sub" style="margin-top:10px">Vilopuls, punkter per dag och 7-dagarssnitt</div><div class="chart ch-rhr"></div>';
    h += '<div class="sub" style="margin-top:10px">Sömn per natt</div><div class="chart ch-sleep"></div><div class="readout ro-sleep"></div>';
    b.innerHTML = h;
    if(q(".more-daily")) q(".more-daily").onclick = () => loadDaily(Math.min(365, days), true);
    if(hrvRows.length >= 2){
      const pts = hrvRows.map(d => ({ x: parseLocal(d.date), y: d.hrv }));
      const avg = [], lo = [], hi = [];
      rows.forEach(d => { const st = hrvState(d.date); const x = parseLocal(d.date); if(st.ok){ avg.push({x, y: st.ms7}); lo.push({x, y: st.msLo}); hi.push({x, y: st.msHi}); } });
      multiLine(q(".ch-hrv"), [{ name:"natt", color:"var(--muted)", pts, dots:true }, { name:"7 d", color:"var(--accent)", pts: avg, width: 2.5 }], { bandSeries: lo.length > 1 ? { lo, hi } : null, fmt: v => num(v), onPick: x => {
        const d = dmap()[dayKey(x)] || {}, st = hrvState(dayKey(x));
        q(".ro-hrv").innerHTML = '<b>' + esc(dateTxt(x)) + '</b> · HRV ' + num(d.hrv) + ' ms' + (st.ok ? ' · 7 d ' + num(st.ms7) + ' · band ' + num(st.msLo) + '–' + num(st.msHi) : '') + (d.rhr ? ' · vilopuls ' + num(d.rhr) : '') + (d.sleepSec ? ' · sömn ' + hm(d.sleepSec) : '');
      }});
      const st = hrvState(dayKey(new Date()));
      q(".ro-hrv").textContent = st.ok ? "Senaste 7 dagarna " + num(st.ms7) + " ms, ditt band " + num(st.msLo) + "–" + num(st.msHi) + " ms." : "Bandet visas när det finns 14 nätter baslinje och minst 3 mätningar senaste veckan.";
    } else q(".ch-hrv").innerHTML = note("Ingen HRV i dygnsdatan. Garmin skickar HRV bara om klockan mäter den på natten.");
    const rr = rows.filter(d => d.rhr > 0);
    if(rr.length >= 2){
      const pts = rr.map(d => ({ x: parseLocal(d.date), y: d.rhr }));
      const avg = pts.map((p, i) => ({ x: p.x, y: mean(pts.slice(Math.max(0, i-6), i+1).map(q => q.y)) }));
      multiLine(q(".ch-rhr"), [{ color:"var(--muted)", pts, dots:true }, { color:"var(--bad)", pts: avg }], { h: 110, fmt: v => num(v) });
    } else q(".ch-rhr").innerHTML = note("Ingen vilopuls i dygnsdatan.");
    const sl = rows.filter(d => d.sleepSec > 0).slice(-21);
    if(sl.length){
      const med = median(S.daily.slice(-28).map(d => d.sleepSec));
      barChart(q(".ch-sleep"), sl.map(d => shortDate(parseLocal(d.date))), [{ color:"var(--z2)", vals: sl.map(d => d.sleepSec/3600) }], { h: 120, ref: med ? med/3600 : null, fmt: v => num(v, 1) + " h", onPick: i => { const d = sl[i]; q(".ro-sleep").innerHTML = '<b>' + esc(dateTxt(parseLocal(d.date))) + '</b> · ' + hm(d.sleepSec) + (d.sleepScore ? ' · sömnpoäng ' + num(d.sleepScore) : '') + (d.bbWake ? ' · Body Battery vid uppvaknande ' + num(d.bbWake) : ''); } });
      q(".ro-sleep").textContent = med ? "Streckad linje: din median, " + hm(med) + "." : "";
    } else q(".ch-sleep").innerHTML = note("Ingen sömn i dygnsdatan.");
  }},
  form: { title: "Form och trötthet", tabs: ["oversikt","trender"], render(b, c){
    const L = dailyLoads(), q = s => b.querySelector(s);
    const days = Math.max(c.days, 42);
    const rows = L.rows.slice(-days);
    const today = L.rows[L.rows.length-1];
    if(!today){ b.innerHTML = note("Ingen belastning än."); return; }
    let h = '';
    if(!L.warm) h += note("Kronisk nivå behöver 42 dagars historik. Hämtat: " + L.rows.length + " dagar.");
    const fp = today.formPct;
    const fcls = fp == null ? "" : fp < -30 ? "bad" : fp < -10 ? "good" : fp <= 5 ? "" : "warn";
    const ftxt = fp == null ? "–" : fp < -30 ? "Mycket hög belastning" : fp < -10 ? "Normal träningsbelastning" : fp <= 5 ? "Neutral" : "Utvilad";
    h += '<div class="metrics three" style="margin-bottom:10px"><div class="metric"><b>' + num(today.ctlM) + '</b><span>Kronisk, 42 d</span></div><div class="metric"><b>' + num(today.atlM) + '</b><span>Akut, 7 d</span></div><div class="metric"><b>' + (fp == null ? "–" : num(fp) + " %") + '</b><span>Form <span class="pill ' + fcls + '" style="font-size:11px;padding:1px 6px">' + ftxt + '</span></span></div></div>';
    h += '<div class="chart" data-k="ch-form"></div>' + legend([["var(--accent)","Kronisk (fitness)"],["var(--z4)","Akut (trötthet)"]]) + '<div class="sub" style="margin-top:10px">Form i procent av kronisk nivå</div><div class="chart" data-k="ch-formp"></div><div class="readout" data-k="ro-form"></div>';
    h += '<details class="how"><summary>Så räknas det</summary><p>Daglig TRIMP läggs in i två glidande medelvärden: 42 dagar för kronisk och 7 dagar för akut belastning (TrainingPeaks modell). Form är kronisk minus akut, i procent av kronisk. Procent används eftersom TRIMP har en annan skala än TrainingPeaks TSS. Under −30 % räknas som hög risk, samma gräns som intervals.icu använder. Det är praxis, inte forskning.</p></details>';
    b.innerHTML = h;
    const X = r => r.date;
    multiLine(q('[data-k="ch-form"]'), [{ color:"var(--accent)", pts: rows.map(r => ({x: X(r), y: r.ctl})), gap: 2*DAY }, { color:"var(--z4)", pts: rows.map(r => ({x: X(r), y: r.atl})), gap: 2*DAY }], { fmt: v => num(v), onPick: x => {
      const r = L.byKey[dayKey(x)]; if(!r) return;
      q('[data-k="ro-form"]').innerHTML = '<b>' + esc(dateTxt(x)) + '</b> · belastning ' + num(r.load) + ' · kronisk ' + num(r.ctl) + ' · akut ' + num(r.atl) + (r.formPct != null ? ' · form ' + num(r.formPct) + ' %' : '');
    }});
    multiLine(q('[data-k="ch-formp"]'), [{ color:"var(--ink)", pts: rows.filter(r => r.formPct != null).map(r => ({x: X(r), y: r.formPct})), gap: 2*DAY }], { h: 110, zero: true, fmt: v => num(v) + "%", bandSeries: { lo: rows.map(r => ({x: X(r), y: -30})), hi: rows.map(r => ({x: X(r), y: -10})) } });
    q('[data-k="ro-form"]').textContent = "Grönt fält: −30 till −10 %, normal träningsbelastning.";
  }},
  weeks: { title: "Tid per vecka", tabs: ["oversikt","trender"], render(b, c){
    const nW = nWeeksFor(c.days);
    const { w0, weeks, idx } = weekIndex(S.all, nW);
    const per = {}; GROUPS.forEach(g => per[g[0]] = new Array(nW).fill(0));
    const wk = weeks.map(() => []);
    (c.tab === "trender" ? c.sel : S.all).forEach(x => { if(x.date < w0) return; const i = idx(x); if(i >= 0 && i < nW){ per[x.grp][i] += x.dur/60; wk[i].push(x); } });
    const used = GROUPS.filter(g => per[g[0]].some(v => v));
    const avgMin = sum(used.map(g => sum(per[g[0]])))/nW;
    b.innerHTML = '<div class="sub">Snitt ' + hm(avgMin*60) + ' per vecka</div><div class="chart"></div>' + legend(used.map(g => [gColor(g[0]), g[1]])) + '<div class="readout">Tryck på en stapel för att se veckan.</div>';
    const ro = b.querySelector(".readout");
    barChart(b.querySelector(".chart"), weeks.map(d => "v"+isoWeek(d)), used.map(g => ({ color: gColor(g[0]), vals: per[g[0]] })), {
      fmt: v => num(v/60, 1) + " h", minMax: 180,
      onPick: i => { const ss = wk[i]; ro.innerHTML = '<b>Vecka ' + isoWeek(weeks[i]) + '</b> · ' + ss.length + ' pass · ' + hm(sum(ss, x => x.dur)) + ' · belastning ' + num(sum(ss, x => x.zp)) +
        (ss.length ? '<div class="btnrow" style="margin-top:8px">' + ss.slice().reverse().map(x => '<button class="btn ghost small" data-open="' + x.id + '">' + esc(dateTxt(x.date).split(" ")[0]) + ' ' + esc(x.name) + '</button>').join("") + '</div>' : ""); }
    });
  }},
  strain: { title: "Monotoni och strain", tabs: ["oversikt","trender"], render(b, c){
    const nW = Math.min(26, nWeeksFor(c.days));
    const ws = weeklyStrain(nW);
    if(!ws.some(w => w.total)){ b.innerHTML = note("Ingen belastning i perioden."); return; }
    b.innerHTML = '<div class="chart"></div><div class="readout"></div><div class="sub" style="margin-top:6px">Monotoni är dagligt snitt delat med standardavvikelsen över veckan, strain är veckans TRIMP gånger monotoni (Foster 1998). Foster såg sjukdomsfall sammanfalla med toppar i strain. Monotoni över 2 brukar nämnas som varningsnivå.</div>';
    const ro = b.querySelector(".readout");
    barChart(b.querySelector(".chart"), ws.map(w => "v"+isoWeek(w.week)), [{ color:"var(--str)", vals: ws.map(w => w.strain || 0) }], { h: 150, fmt: v => num(v), onPick: i => { const w = ws[i]; ro.innerHTML = '<b>Vecka ' + isoWeek(w.week) + '</b> · belastning ' + num(w.total) + ' · monotoni ' + (w.mono != null ? num(w.mono, 2) : "–") + ' · strain ' + num(w.strain); } });
    const last = ws[ws.length-1];
    ro.innerHTML = 'Den här veckan: monotoni ' + (last.mono != null ? num(last.mono, 2) : "–") + ', strain ' + num(last.strain) + '.';
  }},
  zones: { title: "Pulszoner", tabs: ["oversikt","trender"], render(b, c){
    const zt = [0,0,0,0,0]; c.cur.filter(x => c.tab !== "trender" || !S.ttype || x.type === S.ttype).forEach(x => { if(x.zones) x.zones.forEach((v, i) => zt[i] += v); });
    const tot = sum(zt);
    if(!tot){ b.innerHTML = note("Ingen pulsdata i perioden."); return; }
    const mx = Math.max(...zt);
    b.innerHTML = '<div class="sub">' + hm(tot) + ' med puls</div>' + zoneBar(zt) + '<div class="zrows">' + zt.map((v, i) => '<div class="zrow"><b>Z' + (i+1) + '</b><div class="t"><span style="width:' + (v/mx*100).toFixed(1) + '%;background:' + ZC[i] + '"></span></div><span class="v">' + hmShort(v) + ' · ' + num(v/tot*100) + '%</span></div>').join("") + '</div>';
  }},
  heat: { title: "Kalender", tabs: ["oversikt"], render(b, c){
    const nW = c.days >= 365 ? 26 : 13;
    const now = new Date(), w0 = addDays(monday(now), -7*(nW-1));
    const mins = {}, list = {}; S.all.forEach(x => { mins[x.day] = (mins[x.day] || 0) + x.dur/60; (list[x.day] = list[x.day] || []).push(x); });
    const lvl = m => !m ? 0 : m < 30 ? .3 : m < 60 ? .55 : m < 90 ? .8 : 1;
    let cells = "";
    for(let r = 0; r < 7; r++) for(let col = 0; col < nW; col++){
      const d = addDays(w0, col*7+r), k = dayKey(d), m = mins[k] || 0, fut = d > now;
      cells += '<button style="grid-row:' + (r+1) + ';grid-column:' + (col+1) + ';' + (m ? 'background:color-mix(in srgb, var(--accent) ' + Math.round(lvl(m)*100) + '%, var(--sunk))' : '') + (fut ? ';opacity:.25' : '') + '"' + (dayKey(now) === k ? ' class="today"' : '') + ' data-day="' + k + '" aria-label="' + k + ', ' + Math.round(m) + ' minuter"></button>';
    }
    b.innerHTML = '<div class="sub">Minuter per dag</div><div class="heatwrap"><div class="heatdays" style="grid-template-rows:repeat(7,1fr)">' + ["M","T","O","T","F","L","S"].map(x => '<span>'+x+'</span>').join("") + '</div><div class="heat" style="grid-template-columns:repeat(' + nW + ',1fr)">' + cells + '</div></div><div class="readout">Tryck på en dag för att se passen.</div>';
    const ro = b.querySelector(".readout");
    b.querySelector(".heat").onclick = e => { const bt = e.target.closest("[data-day]"); if(!bt) return; const ss = list[bt.dataset.day] || []; const d = parseLocal(bt.dataset.day);
      ro.innerHTML = '<b>' + esc(dateTxt(d)) + '</b> · ' + (ss.length ? ss.length + ' pass, ' + hm(sum(ss, x => x.dur)) + '<div class="btnrow" style="margin-top:8px">' + ss.map(x => '<button class="btn ghost small" data-open="' + x.id + '">' + esc(x.name) + ' · ' + hmShort(x.dur) + '</button>').join("") + '</div>' : 'vilodag'); };
  }},
  recent: { title: "Senaste passen", tabs: ["oversikt"], render(b){
    b.innerHTML = '<div class="list flush">' + (S.all.slice(0, 5).map(rowHtml).join("") || '<div class="empty">Inga pass ännu.</div>') + '</div>';
  }},

  // ----- Trender -----
  trimpw: { title: "Belastning per vecka", tabs: ["trender"], render(b, c){
    const nW = Math.max(4, Math.round(c.days/7));
    const { weeks, idx } = weekIndex(c.sel, nW);
    const v = new Array(nW).fill(0); c.sel.forEach(x => { const i = idx(x); if(i >= 0 && i < nW) v[i] += x.zp || 0; });
    b.innerHTML = '<div class="chart"></div><div class="readout"></div>';
    barChart(b.querySelector(".chart"), weeks.map(d => "v"+isoWeek(d)), [{ color:"var(--accent)", vals: v }], { h: 150, onPick: i => { b.querySelector(".readout").innerHTML = '<b>Vecka ' + isoWeek(weeks[i]) + '</b> · belastning ' + num(v[i]); } });
    b.querySelector(".readout").textContent = "Snitt " + num(mean(v)) + " per vecka.";
  }},
  hr: { title: "Snittpuls per pass", tabs: ["trender"], render(b, c){
    const pts = c.sel.filter(x => x.avgHR).map(x => ({ x: x.date, y: x.avgHR, ref: x, color: gColor(x.grp) }));
    b.innerHTML = '<div class="sub">Linjen är ett glidande snitt</div><div class="chart"></div><div class="readout"></div>';
    const ro = b.querySelector(".readout");
    lineChart(b.querySelector(".chart"), pts, { fmt: v => num(v), onPick: p => pickSession2(ro, p) });
    ro.textContent = pts.length >= 2 ? "Median " + num(median(pts.map(p => p.y))) + " bpm. Tryck på en punkt för att se passet." : "";
  }},
  dur: { title: "Längd per pass", tabs: ["trender"], render(b, c){
    const pts = c.sel.map(x => ({ x: x.date, y: x.dur/60, ref: x, color: gColor(x.grp) }));
    b.innerHTML = '<div class="chart"></div><div class="readout"></div>';
    const ro = b.querySelector(".readout");
    lineChart(b.querySelector(".chart"), pts, { fmt: v => num(v) + "m", onPick: p => pickSession2(ro, p) });
    ro.textContent = pts.length >= 2 ? "Median " + num(median(pts.map(p => p.y))) + " minuter." : "";
  }},
  pace: { title: "Löptempo", tabs: ["trender"], render(b, c){
    const runs = c.sel.filter(x => x.grp === "run" && x.speed > 0 && x.dist > 500);
    b.innerHTML = '<div class="chart"></div><div class="readout"></div>';
    const ro = b.querySelector(".readout");
    lineChart(b.querySelector(".chart"), runs.map(x => ({ x: x.date, y: 1000/x.speed/60, ref: x })), { invert: true, fmt: v => paceMin(v), onPick: p => { const x = p.ref; ro.innerHTML = '<b>' + esc(x.name) + '</b> · ' + km(x.dist) + ' · ' + paceTxt(x.speed) + ' ' + openBtn(x.id); } });
    if(runs.length >= 2) ro.textContent = "Högre upp är snabbare.";
  }},
  ef: { title: "Effektivitetsfaktor", tabs: ["trender"], render(b, c){
    const runs = c.sel.filter(x => x.ef);
    b.innerHTML = '<div class="sub">Meter per minut delat med snittpuls, lugna löppass (under 10 % i zon 4–5). Stigande värde tyder på bättre aerob form.</div><div class="chart"></div><div class="readout"></div>';
    const ro = b.querySelector(".readout");
    lineChart(b.querySelector(".chart"), runs.map(x => ({ x: x.date, y: x.ef, ref: x })), { fmt: v => num(v, 2), onPick: p => { const x = p.ref; ro.innerHTML = '<b>' + esc(x.name) + '</b> · EF ' + num(x.ef, 2) + ' · ' + paceTxt(x.speed) + ' · ' + Math.round(x.avgHR) + ' bpm ' + openBtn(x.id); } });
  }},
  hrpace: { title: "Puls vid fast tempo", tabs: ["trender"], render(b, c){
    const runs = c.sel.filter(x => x.grp === "run");
    const r = hrAtPace(runs);
    if(!r || r.list.length < 2){ b.innerHTML = note("För få löppass i samma tempo."); return; }
    b.innerHTML = '<div class="sub">Snittpuls på löppass i tempot ' + paceTxt(r.hi) + '–' + paceTxt(r.lo) + '. Lägre puls vid samma fart tyder på bättre form. Typiskt mätfel cirka 3 % (Buchheit 2014).</div><div class="chart"></div><div class="readout"></div>';
    const ro = b.querySelector(".readout");
    lineChart(b.querySelector(".chart"), r.list.map(x => ({ x: x.date, y: x.avgHR, ref: x })), { fmt: v => num(v), onPick: p => pickSession2(ro, p) });
  }},
  volume: { title: "Löpvolym per vecka", tabs: ["trender"], render(b, c){
    const nW = Math.max(4, Math.round(c.days/7));
    const runs = c.sel.filter(x => x.grp === "run");
    const { weeks, idx } = weekIndex(runs, nW);
    const kmv = new Array(nW).fill(0), tv = new Array(nW).fill(0);
    runs.forEach(x => { const i = idx(x); if(i >= 0 && i < nW){ kmv[i] += x.dist/1000; tv[i] += x.dur; } });
    if(!sum(kmv)){ b.innerHTML = note("Inga löppass i perioden."); return; }
    b.innerHTML = '<div class="chart"></div><div class="readout"></div>';
    barChart(b.querySelector(".chart"), weeks.map(d => "v"+isoWeek(d)), [{ color:"var(--run)", vals: kmv }], { h: 150, fmt: v => num(v) + " km", onPick: i => { b.querySelector(".readout").innerHTML = '<b>Vecka ' + isoWeek(weeks[i]) + '</b> · ' + num(kmv[i], 1) + ' km · ' + hm(tv[i]); } });
    b.querySelector(".readout").textContent = "Snitt " + num(mean(kmv), 1) + " km per vecka.";
  }},
  dist: { title: "Intensitetsfördelning per månad", tabs: ["trender"], render(b, c){
    const months = {};
    c.sel.forEach(x => { if(!x.zones) return; const k = x.date.getFullYear() + "-" + pad(x.date.getMonth()+1); (months[k] = months[k] || []).push(x); });
    const keys = Object.keys(months).sort();
    if(!keys.length){ b.innerHTML = note("Ingen pulsdata i perioden."); return; }
    const sp = keys.map(k => intensitySplit(months[k]));
    b.innerHTML = '<div class="sub">Andel pulstid i zon 1–2 (lätt), 3 (medel) och 4–5 (hård). I Stöggl och Sperlich 2014 gav cirka 68/6/26 % störst förbättring hos uthållighetsidrottare. Garmins zon 3 motsvarar inte exakt forskningens medelzon, så se det som en uppskattning.</div><div class="chart"></div>' + legend([["var(--z2)","Lätt"],["var(--z3)","Medel"],["var(--z4)","Hård"]]) + '<div class="readout"></div>';
    barChart(b.querySelector(".chart"), keys.map(k => MONTHS[+k.slice(5)-1]), [{ color:"var(--z2)", vals: sp.map(s => s.easy*100) }, { color:"var(--z3)", vals: sp.map(s => s.mid*100) }, { color:"var(--z4)", vals: sp.map(s => s.hard*100) }], { max: 100, h: 150, fmt: v => num(v) + "%", onPick: i => { const s = sp[i]; b.querySelector(".readout").innerHTML = '<b>' + keys[i] + '</b> · lätt ' + num(s.easy*100) + ' % · medel ' + num(s.mid*100) + ' % · hård ' + num(s.hard*100) + ' % av ' + hm(s.total); } });
  }},
  vo2: { title: "VO2max enligt Garmin", tabs: ["trender"], render(b, c){
    const pts = c.sel.filter(x => x.vo2).map(x => ({ x: x.date, y: x.vo2, ref: x }));
    if(pts.length < 2){ b.innerHTML = note("Garmin skickar inget VO2max för passen i perioden."); return; }
    b.innerHTML = '<div class="sub">Grov trend. Garmins uppskattning har cirka 7–8 % medelfel.</div><div class="chart"></div><div class="readout"></div>';
    lineChart(b.querySelector(".chart"), pts, { raw: true, fmt: v => num(v, 1), onPick: p => pickSession2(b.querySelector(".readout"), p) });
  }},
  z45: { title: "Andel tid i zon 4–5 per vecka", tabs: ["trender"], render(b, c){
    const nW = Math.max(4, Math.round(c.days/7));
    const { weeks, idx } = weekIndex(c.sel, nW);
    const zw = Array.from({length: nW}, () => [0,0]);
    c.sel.forEach(x => { if(!x.zones) return; const i = idx(x); if(i >= 0 && i < nW){ zw[i][0] += x.zones[3] + x.zones[4]; zw[i][1] += x.zt; } });
    const share = zw.map(z => z[1] ? z[0]/z[1]*100 : 0);
    b.innerHTML = '<div class="chart"></div><div class="readout">Hur stor del av pulstiden som var hård.</div>';
    barChart(b.querySelector(".chart"), weeks.map(d => "v"+isoWeek(d)), [{ color:"var(--z4)", vals: share }], { max: 100, fmt: v => num(v) + "%", h: 140, onPick: i => { b.querySelector(".readout").innerHTML = '<b>Vecka ' + isoWeek(weeks[i]) + '</b> · ' + num(share[i]) + ' % av ' + hm(zw[i][1]) + ' med puls i zon 4–5'; } });
  }},
  bench: { title: "Benchmarks", tabs: ["trender","oversikt"], render(b){
    if(!S.storage.db){ b.innerHTML = note("Loggade pass kräver databasen."); return; }
    const bm = benchmarks();
    if(!bm.length){ b.innerHTML = note(S.logs.length ? "Inget loggat pass har gjorts två gånger än." : "Logga CrossFit-pass från Pass-fliken så visas återkommande pass här."); return; }
    b.innerHTML = bm.map((g, gi) => '<div class="bench"><div class="bh"><b>' + esc(g.name) + '</b><span class="sub">' + g.list.length + ' gånger' + (g.best ? ' · bäst ' + esc(g.best.s.txt) + ' (' + esc(g.best.l.date) + ')' : '') + '</span></div>' +
      (g.scored.length >= 2 ? '<div class="chart" data-bench="' + gi + '"></div>' : '') +
      '<div class="btnrow">' + g.list.slice().reverse().map(l => '<button class="btn ghost small" data-log="' + l.id + '">' + esc(l.date) + (scoreOf(l) ? ' · ' + esc(scoreOf(l).txt) : '') + '</button>').join("") + '</div></div>').join("");
    bm.forEach((g, gi) => { const el = b.querySelector('[data-bench="' + gi + '"]'); if(el) lineChart(el, g.scored.map(s => ({ x: parseLocal(s.l.date), y: s.s.v })), { raw: true, h: 120, invert: g.lower, fmt: v => g.lower ? clock(v) : num(v) }); });
  }},
  moves: { title: "Rörelser", tabs: ["trender"], render(b, c){
    const mv = {}; c.sel.forEach(x => x.sets.forEach(s => { if(!s.category) return; const m = mv[s.category] || (mv[s.category] = { reps: 0, n: 0 }); m.reps += s.reps || 0; m.n++; }));
    const top = Object.entries(mv).filter(e => e[0] !== "UNKNOWN" || e[1].reps).sort((a, b) => b[1].reps - a[1].reps).slice(0, 10); const mx = top.length ? top[0][1].reps || 1 : 1;
    b.innerHTML = '<div class="sub">Reps enligt klockan</div>' + (top.length ? '<div class="ex">' + top.map(([cat, m]) => '<div class="r"><span>' + esc(moveLabel(cat)) + '</span><em>' + num(m.reps) + ' reps · ' + m.n + ' pass</em><div class="t"><span style="width:' + (m.reps/mx*100).toFixed(1) + '%"></span></div></div>').join("") + '</div>' : note("Inga övningar registrerade av klockan i perioden."));
  }},
  bb: { title: "Body Battery per pass", tabs: ["trender"], render(b, c){
    const pts = c.sel.filter(x => x.bb != null).map(x => ({ x: x.date, y: x.bb, ref: x, color: gColor(x.grp) }));
    b.innerHTML = '<div class="sub">Förändring under passet enligt Garmin. Mer negativt betyder dyrare pass.</div><div class="chart"></div><div class="readout"></div>';
    lineChart(b.querySelector(".chart"), pts, { fmt: v => num(v), onPick: p => pickSession2(b.querySelector(".readout"), p) });
  }},
  wd: { title: "När du tränar", tabs: ["trender"], render(b, c){
    const wd = [0,0,0,0,0,0,0], tod = { morgon: 0, dag: 0, kväll: 0 };
    c.sel.forEach(x => { wd[(x.date.getDay()+6)%7]++; const hr = x.date.getHours(); if(hr < 10) tod.morgon++; else if(hr < 16) tod.dag++; else tod.kväll++; });
    b.innerHTML = '<div class="chart"></div><div class="readout"></div>';
    const ro = b.querySelector(".readout");
    barChart(b.querySelector(".chart"), ["mån","tis","ons","tor","fre","lör","sön"], [{ color:"var(--accent)", vals: wd }], { h: 130, fmt: v => num(v), onPick: i => { ro.innerHTML = '<b>' + WEEKDAYS[i] + 'ar</b> · ' + wd[i] + ' pass'; } });
    ro.textContent = c.sel.length ? "Morgon (före 10): " + tod.morgon + " · dag: " + tod.dag + " · kväll (efter 16): " + tod.kväll : "";
  }},
};
function pickSession2(ro, p){ const x = p.ref; ro.innerHTML = '<b>' + esc(x.name) + '</b> · ' + esc(dateTxt(x.date)) + ' · ' + hmShort(x.dur) + (x.avgHR ? ' · ' + Math.round(x.avgHR) + ' bpm' : '') + ' ' + openBtn(x.id); }

// ---------- Översikt och Trender ----------
function renderOverview(){
  segment($("#period-o"), PERIODS, S.period, v => { S.period = v; store.set("period", v); renderOverview(); });
  renderCards("oversikt");
}
function renderTrends(){
  segment($("#period-t"), PERIODS.slice(1), S.tperiod, v => { S.tperiod = v; store.set("tperiod", v); renderTrends(); });
  const from = addDays(sod(new Date()), -S.tperiod+1);
  const counts = {}; S.all.filter(x => x.date >= from).forEach(x => counts[x.type] = (counts[x.type] || 0) + 1);
  const types = Object.keys(counts).filter(k => counts[k] >= 2).sort((a, b) => counts[b] - counts[a]);
  if(S.ttype && !types.includes(S.ttype)) S.ttype = "";
  $("#tchips").innerHTML = '<button class="chip" data-t="" aria-pressed="' + (!S.ttype) + '">Alla</button>' + types.map(k => '<button class="chip" data-t="' + esc(k) + '" aria-pressed="' + (S.ttype === k) + '"><span class="dot" style="background:' + gColor(groupOf(k)) + '"></span>' + esc(typeLabel(k)) + '<span class="n">' + counts[k] + '</span></button>').join("");
  $("#tchips").onclick = e => { const b = e.target.closest(".chip"); if(!b) return; S.ttype = b.dataset.t; renderTrends(); };
  renderCards(trendScope());
}
function trendScope(){ return S.ttype ? "trender:" + groupOf(S.ttype) : "trender:all"; }

// ---------- Pass ----------
function rowHtml(x){
  const right = x.dist ? km(x.dist) : hmShort(x.dur);
  const sub = x.avgHR ? Math.round(x.avgHR) + " bpm" : (x.kcal ? x.kcal + " kcal" : "");
  const lg = logFor(x);
  return '<button class="row" data-open="' + x.id + '"><span class="stripe" style="background:' + gColor(x.grp) + '"></span>' +
    '<span style="min-width:0"><span class="name">' + esc(lg && lg.data.name ? lg.data.name : x.name) + (lg ? ' <span class="pill tiny">loggat</span>' : '') + ' ' + hrqPill(x, true) + '</span><span class="meta">' + esc(typeLabel(x.type)) + ' · ' + esc(dateTxt(x.date)) + ' ' + pad(x.date.getHours()) + ':' + pad(x.date.getMinutes()) + (x.dist ? ' · ' + hmShort(x.dur) : '') + '</span></span>' +
    '<span class="nums">' + esc(right) + '<small>' + esc(sub) + '</small></span>' + (x.zones ? zoneBar(x.zones, true) : '') + '</button>';
}
function currentView(){ return (CFG.views || []).find(v => v.id === S.view) || null; }
function passList(){
  const q = S.q.trim().toLowerCase(), view = currentView(), fields = fieldDefs();
  return S.all.filter(x => (!S.type || x.type === S.type) && (!view || matchConds(x, view.conds, fields)) &&
    (!q || (x.name + " " + typeLabel(x.type) + " " + x.type + " " + x.sets.map(s => moveLabel(s.category)).join(" ") + " " + (logFor(x) ? JSON.stringify(logFor(x).data) : "")).toLowerCase().includes(q)));
}
function renderPass(){
  const counts = {}; S.all.forEach(x => counts[x.type] = (counts[x.type] || 0) + 1);
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  $("#chips").innerHTML = '<button class="chip" data-t="" aria-pressed="' + (!S.type) + '">Alla<span class="n">' + S.all.length + '</span></button>' +
    keys.map(k => '<button class="chip" data-t="' + esc(k) + '" aria-pressed="' + (S.type === k) + '"><span class="dot" style="background:' + gColor(groupOf(k)) + '"></span>' + esc(typeLabel(k)) + '<span class="n">' + counts[k] + '</span></button>').join("");
  const views = CFG.views || [];
  if(S.view && !currentView()) S.view = "";
  $("#vchips").innerHTML = views.map(v => '<button class="chip" data-v="' + esc(v.id) + '" aria-pressed="' + (S.view === v.id) + '">' + esc(v.name) + '</button>').join("") +
    (S.view ? '<button class="chip" data-edit-view="' + esc(S.view) + '">Ändra vyn</button>' : '') + '<button class="chip" data-new-view="1">+ Ny vy</button>';
  const view = currentView();
  const sortSel = $("#sort");
  if(!sortSel.dataset.filled){ sortSel.innerHTML = '<option value="date">Senaste först</option><option value="date_asc">Äldsta först</option>' + METRICS.filter(m => m.id !== "count").map(m => '<option value="' + m.id + '">' + esc(m.label) + (m.lower ? ', lägst först' : ', högst först') + '</option>').join(""); sortSel.dataset.filled = "1"; }
  if(view && view.sort && !S.sortTouched) S.sort = view.sort;
  sortSel.value = S.sort;
  const list = passList();
  const fields = fieldDefs();
  const avgHr = mean(list.map(x => x.avgHR));
  $("#psum").innerHTML = list.length ? '<b>' + list.length + ' pass</b> · ' + hm(sum(list, x => x.dur)) + ' · belastning ' + num(sum(list, x => x.zp)) + (avgHr ? ' · snittpuls ' + num(avgHr) : '') + (view && view.conds.length ? '<div class="sub">' + esc(view.conds.map(c => condText(c, fields)).join(" och ")) + '</div>' : '') : "";
  const vc = $("#vcharts"); vc.innerHTML = "";
  if(view && (view.charts || []).length && list.length >= 2){
    view.charts.forEach(mid => {
      const m = MET[mid]; if(!m) return;
      const sec = document.createElement("section"); sec.className = "card";
      sec.innerHTML = '<h2>' + esc(m.label) + '</h2><div class="chart"></div><div class="readout"></div>';
      vc.appendChild(sec);
      const pts = list.map(x => ({ x: x.date, y: m.get(x), ref: x, color: gColor(x.grp) })).filter(p => p.y != null && !isNaN(p.y)).sort((a, b) => a.x - b.x);
      lineChart(sec.querySelector(".chart"), pts, { h: 140, invert: m.lower, fmt: v => fmtM(m, v), onPick: p => pickSession2(sec.querySelector(".readout"), p) });
    });
  }
  if(!list.length){ $("#list").innerHTML = '<div class="empty">Inga pass matchar.</div>'; return; }
  let html = "";
  if(S.sort === "date" || S.sort === "date_asc"){
    let lastW = null, rows = [];
    const flush = () => { if(!rows.length) return; const ss = rows; html += '<div class="wk"><span>Vecka ' + isoWeek(ss[0].date) + (ss[0].date.getFullYear() !== new Date().getFullYear() ? ", " + ss[0].date.getFullYear() : "") + '</span><span>' + ss.length + ' pass · ' + hm(sum(ss, x => x.dur)) + ' · ' + num(sum(ss, x => x.zp)) + ' belastning</span></div>' + ss.map(rowHtml).join(""); rows = []; };
    const ordered = S.sort === "date_asc" ? list.slice().reverse() : list;
    ordered.slice(0, 500).forEach(x => { const w = +monday(x.date); if(w !== lastW){ flush(); lastW = w; } rows.push(x); }); flush();
  } else {
    const m = MET[S.sort];
    const val = x => { const v = m ? m.get(x) : null; return v == null || isNaN(v) ? null : v; };
    html = list.filter(x => val(x) != null).sort((a, b) => m.lower ? val(a) - val(b) : val(b) - val(a)).slice(0, 200).map(x => rowHtml(x).replace('<small>', '<small>' + esc(fmtM(m, val(x))) + ' · ')).join("");
  }
  $("#list").innerHTML = html;
}
$("#chips").onclick = e => { const b = e.target.closest(".chip"); if(!b) return; S.type = b.dataset.t; renderPass(); };
$("#vchips").onclick = e => {
  const b = e.target.closest(".chip"); if(!b) return;
  if(b.dataset.newView){ openViewEditor(null); return; }
  if(b.dataset.editView){ openViewEditor(b.dataset.editView); return; }
  S.view = S.view === b.dataset.v ? "" : b.dataset.v; S.sortTouched = false; if(!S.view) S.sort = "date"; renderPass();
};
$("#q").oninput = e => { S.q = e.target.value; renderPass(); };
$("#sort").onchange = e => { S.sort = e.target.value; S.sortTouched = true; renderPass(); };
$("#log-new").onclick = () => openLogEditor(null, null);

// ---------- Passvy ----------
function openSheet(title){ $("#sheet-title").textContent = title; $("#sheet").hidden = false; document.body.style.overflow = "hidden"; $("#sheet").scrollTop = 0; }
function closeSheet(){ $("#sheet").hidden = true; document.body.style.overflow = ""; S.openId = null; if(S.sheetDirty){ S.sheetDirty = false; rerender(); } }
$("#back").onclick = closeSheet;
document.addEventListener("keydown", e => { if(e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

const DEFAULT_PROFILES = {
  run: ["dur","dist","pace","avgHR","maxHR","ef","trimp","z45","recov","vo2","elev","kcal"],
  hiit: ["dur","avgHR","maxHR","trimp","z45","recov","im","bb","kcal","sets","reps"],
  str: ["dur","avgHR","trimp","recov","sets","reps","bb","kcal"],
  cyc: ["dur","dist","speed","avgHR","trimp","recov","kcal"],
  oth: ["dur","trimp","avgHR","kcal","steps"],
};
const profileFor = grp => (CFG.profiles && CFG.profiles[grp]) || DEFAULT_PROFILES[grp] || DEFAULT_PROFILES.oth;

function metricGrid(x){
  return profileFor(x.grp).map(id => {
    const m = MET[id]; if(!m) return "";
    const v = m.get(x); if(v == null || isNaN(v)) return "";
    return '<div class="metric"><b>' + esc(fmtM(m, v)) + '</b><span>' + esc(m.label) + '</span></div>';
  }).join("");
}

function openSession(id){
  const x = byId(id); if(!x) return;
  S.openId = x.id;
  openSheet(x.name);
  const rec = recoveryHours(x);
  let html = '<div class="sub">' + esc(typeLabel(x.type)) + ' · ' + esc(dateTxt(x.date, true)) + ' kl ' + pad(x.date.getHours()) + ':' + pad(x.date.getMinutes()) + '</div>';
  html += '<div class="metrics" id="mgrid">' + metricGrid(x) + '</div><div class="btnrow"><button class="btn ghost small" id="prof-btn">Välj mått för ' + esc(GROUP_NAME[x.grp]) + '</button></div><div id="prof-edit"></div>';
  if(x.zp != null) html += '<div class="sub">Belastning (TRIMP) ' + num(x.zp) + (x.zpEst ? ', uppskattad eftersom pulsen är opålitlig.' : ': varje minut i pulszon 1–5 räknas som 1–5 poäng, så 10 minuter i zon 4 ger 40.') + (rec ? ' Passet är ' + num(rec.r*100) + ' % av ditt vanliga pass i gruppen ' + esc(GROUP_NAME[x.grp]) + ', vilket ger cirka ' + rec.h + ' h vilotid (' + esc(rec.method) + ').' : '') + '</div>';

  const hq = hrqCardHtml(x);
  if(hq && x.hrq.state !== "ok") html += '<section class="card" id="hrqcard">' + hq + '</section>';
  html += '<section class="card" id="logcard"></section>';
  html += '<section class="card" id="issuecard"></section>';

  if(x.zones){
    const t = x.zt, mx = Math.max(...x.zones);
    html += '<section class="card"><h2>Pulszoner <small>' + num(x.z45*100) + ' % i zon 4–5</small></h2>' + zoneBar(x.zones) + '<div class="zrows">' +
      x.zones.map((v, i) => '<div class="zrow"><b>Z' + (i+1) + '</b><div class="t"><span style="width:' + (v/mx*100).toFixed(1) + '%;background:' + ZC[i] + '"></span></div><span class="v">' + clock(v) + ' · ' + num(v/t*100) + '%</span></div>').join("") + '</div></section>';
  }
  html += '<section class="card" id="fitcard"><h2>Puls över tid</h2><div class="note"><span class="spin"></span>Läser originalfilen från Garmin …</div></section>';

  const peers = S.all.filter(p => p.type === x.type && p.id !== x.id);
  if(peers.length >= 3){
    const ids = profileFor(x.grp).filter(id => !["recov","vo2","steps","elev"].includes(id)).slice(0, 7);
    let c = "";
    ids.forEach(id => {
      const m = MET[id]; if(!m) return;
      const me = m.get(x), vals = peers.map(m.get).filter(v => v != null && !isNaN(v)); if(me == null || isNaN(me) || vals.length < 3) return;
      const lo = Math.min(...vals, me), hi = Math.max(...vals, me), md = median(vals), pos = v => ((v-lo)/((hi-lo)||1)*100).toFixed(1);
      const d = md ? (me-md)/md*100 : 0;
      c += '<div class="r"><span>' + esc(m.label) + '<span class="sub" style="display:block">' + esc(fmtM(m, me)) + '</span></span><div class="track" title="Median ' + esc(fmtM(m, md)) + '"><div class="rng"></div><div class="med" style="left:' + pos(md) + '%"></div><div class="me" style="left:' + pos(me) + '%"></div></div><span class="d">' + (d>0?"+":"") + num(d) + ' %</span></div>';
    });
    if(c) html += '<section class="card"><h2>Mot dina ' + esc(typeLabel(x.type).toLowerCase()) + '-pass <small>' + peers.length + ' andra pass</small></h2><div class="cmp">' + c + '</div>' + legend([["var(--accent)","det här passet"],["var(--muted)","median"]]) + '</section>';
  }
  if(x.sets.length){
    const mx = Math.max(...x.sets.map(s => s.reps || 0), 1);
    html += '<section class="card"><h2>Övningar <small>enligt klockan</small></h2><div class="ex">' + x.sets.slice().sort((a, b) => (b.reps||0) - (a.reps||0)).map(s =>
      '<div class="r"><span>' + esc(moveLabel(s.category)) + '</span><em>' + num(s.reps) + ' reps · ' + num(s.sets) + ' set' + (s.duration ? ' · ' + clock(s.duration/1000) : '') + '</em><div class="t"><span style="width:' + ((s.reps||0)/mx*100).toFixed(1) + '%"></span></div></div>').join("") + '</div></section>';
  }
  html += '<section class="card" id="det"><h2>Fler detaljer</h2><div class="note"><span class="spin"></span>Hämtar från Garmin …</div></section>';
  $("#sheet-body").innerHTML = html;
  $("#prof-btn").onclick = () => toggleProfileEditor(x);
  renderLogCard(x);
  renderIssueCard(x);
  loadDetails(x);
  loadFitCard(x);
}

function toggleProfileEditor(x){
  const box = $("#prof-edit");
  if(box.innerHTML){ box.innerHTML = ""; return; }
  const cur = profileFor(x.grp);
  const order = cur.concat(METRICS.filter(m => !m.noProfile && !cur.includes(m.id)).map(m => m.id));
  box.innerHTML = '<div class="card"><h2>Mått för ' + esc(GROUP_NAME[x.grp]) + '<small>gäller alla pass i gruppen</small></h2><div class="checks">' + order.map(id => '<label><input type="checkbox" value="' + id + '"' + (cur.includes(id) ? ' checked' : '') + '> ' + esc(MET[id].label) + '</label>').join("") + '</div><div class="btnrow" style="margin-top:8px"><button class="btn small" id="prof-save">Spara</button><button class="btn ghost small" id="prof-reset">Standard</button></div></div>';
  $("#prof-save").onclick = () => { CFG.profiles = CFG.profiles || {}; CFG.profiles[x.grp] = $$("#prof-edit input:checked").map(i => i.value); saveCfg(); $("#mgrid").innerHTML = metricGrid(x); box.innerHTML = ""; toast("Sparat"); };
  $("#prof-reset").onclick = () => { if(CFG.profiles) delete CFG.profiles[x.grp]; saveCfg(); $("#mgrid").innerHTML = metricGrid(x); box.innerHTML = ""; };
}

async function loadFitCard(x){
  const el = () => S.openId === x.id ? $("#fitcard") : null;
  try{
    const raw = await loadFit(x.id);
    if(!el()) return;
    const rest = hrRest(), max = hrMax();
    // Pulskontrollen: spara analysen om den saknas, och markera störningar i diagrammet
    const A = analyzeFit(raw, max.v, rest.v);
    if(hrqNeeds(x, max.v) || !HRQ.items[x.id] || HRQ.items[x.id].err){
      const before = x.hrq && x.hrq.state;
      await hrqSave(x.id, A.item); invalidate(); S.sheetDirty = true;
      if(x.hrq && x.hrq.state !== before && S.openId === x.id){ openSession(x.id); return; }
    }
    const lim = max.v ? max.v + HRQ_RULES.over : Infinity;
    const trust = x.hrq && x.hrq.mark === "ok";
    const bad = (r, i) => !r.hr || r.hr > lim || (!trust && A.flag[i] > 0);
    const recs = A.recs.map((r, i) => bad(r, i) ? Object.assign({}, r, { hr: null }) : r);
    const hr = A.recs.filter(r => r.hr);
    if(hr.length < 10){ el().innerHTML = '<h2>Puls över tid</h2>' + note("Filen innehåller ingen puls.") + hrqFoot(x); return; }
    const ban = x.hrq && x.hrq.state === "opalitlig" ? null : banister(recs, rest.v, max.v);
    const dec = x.grp === "run" && x.hrOk !== false ? decoupling(recs) : null;
    const good = recs.filter(r => r.hr);
    let h = '<h2>Puls över tid</h2><div class="chart" id="ch-fit"></div>';
    const nBad = A.recs.filter((r, i) => r.hr && bad(r, i)).length;
    if(nBad) h += legend([["var(--bad)","puls"],["var(--muted)","störning, räknas inte"]]);
    h += '<div class="metrics" style="margin-top:10px">';
    if(ban != null) h += '<div class="metric"><b>' + num(ban) + '</b><span>Banister TRIMP</span></div>';
    if(dec) h += '<div class="metric"><b>' + num(dec.pct, 1) + ' %</b><span>Aerob avkoppling</span></div>';
    const cleanMax = good.length ? Math.max(...good.map(r => r.hr)) : null, rawMax = Math.max(...hr.map(r => r.hr));
    h += '<div class="metric"><b>' + num(cleanMax) + '</b><span>Maxpuls' + (rawMax > (cleanMax || 0) ? ' utan störningar, ' + num(rawMax) + ' i filen' : ' i filen') + '</span></div></div>';
    h += '<div class="sub" style="margin-top:8px">' + (ban != null ? 'Banister TRIMP med vilopuls ' + num(rest.v) + ' (' + esc(rest.src) + ') och maxpuls ' + num(max.v) + ' (' + esc(max.src) + '), koefficienter för män. ' : 'Banister TRIMP behöver vilo- och maxpuls, se Data-fliken. ') +
      (dec ? 'Avkoppling: fart per puls sjönk ' + num(dec.pct, 1) + ' % från första till andra halvan. Under 5 % räknas som god uthållighet, och måttet gäller jämna pass.' + (x.z45 > 0.2 ? ' Det här passet hade mycket tid i zon 4–5, så värdet säger mindre.' : '') : x.grp === "run" ? 'Avkoppling kräver minst 20 minuter med fart och puls.' : '') + '</div>';
    h += hrqFoot(x);
    el().innerHTML = h;
    const t0 = hr[0].t, step = Math.max(1, Math.floor(A.recs.length/500));
    const okPts = [], badPts = [];
    A.recs.forEach((r, i) => { if(!r.hr || i % step) return; (bad(r, i) ? badPts : okPts).push({ x: new Date(r.t), y: r.hr }); });
    const gap = Math.max(15000, 3*step*((A.recs[A.recs.length-1].t - t0)/A.recs.length));
    multiLine($("#ch-fit"), [{ color:"var(--muted)", pts: badPts, gap }, { color:"var(--bad)", pts: okPts, gap }], { h: 140, fmt: v => num(v), xfmt: t => Math.round((t - t0)/60000) + " min" });
    const it = A.item;
    const parts = [["utan puls", it.miss], ["plötsliga fall", it.drop], ["låg puls i rörelse", it.low], ["plötsliga toppar", it.jump]].filter(p => p[1] >= 10).map(p => hm(p[1]) + " " + p[0]);
    $("#ch-fit").insertAdjacentHTML("afterend", '<div class="readout">' + Math.round(it.act/60) + ' minuter i filen' + (parts.length ? ', varav ' + listJoin(parts) : '') + '.</div>');
  }catch(e){ if(el()) el().innerHTML = '<h2>Puls över tid</h2>' + note("Kunde inte läsa originalfilen: " + esc(e.message)) + hrqFoot(x); }
}
// Knapp för att markera ett pass där sidan inte hittat något fel
function hrqFoot(x){
  return x.hrq && x.hrq.state === "ok" && !x.hrq.mark ? '<div class="btnrow" style="margin-top:8px"><button class="btn ghost small" data-hrmark="bad">Markera pulsen som opålitlig</button></div>' : "";
}

async function loadDetails(x){
  try{
    const j = await api("/api/activity/" + x.id);
    if(S.openId !== x.id || $("#sheet").hidden) return;
    const d = j.details || {}, sm = d.summaryDTO || {};
    const m = (label, v) => v == null || v === "–" ? "" : '<div class="metric"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
    let html = '<h2>Fler detaljer</h2><div class="metrics" style="margin-bottom:10px">' +
      m("Lägsta puls", sm.minHR ? sm.minHR + " bpm" : null) + m("Vätskeförlust", sm.waterEstimated ? sm.waterEstimated + " ml" : null) +
      m("Tidszon", d.timeZoneUnitDTO && d.timeZoneUnitDTO.timeZone) + m("Varv/rundor", (d.splitSummaries||[]).map(s => s.noOfSplits).filter(Boolean)[0] || null) + '</div>';
    html += '<details class="raw"><summary>Rådata från Garmin</summary><pre>' + esc(JSON.stringify({ listPost: x.raw, detaljer: d, workouts: j.workouts }, null, 1)) + '</pre></details>';
    $("#det").innerHTML = html;
  }catch(e){ if($("#det")) $("#det").innerHTML = '<h2>Fler detaljer</h2><div class="banner">' + esc(e.message) + '</div>'; }
}

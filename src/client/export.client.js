// ---------- Exportera ett pass ----------
// All data för ett pass i en JSON-fil: måtten, Garmins rådata, hela tidsserien ur FIT-filen,
// splittar, pulskontrollen, loggat pass, besvär och samtalet med Claude. Position tas bort.
const EXP = { id: null, file: null };
const NO_POS = /latitude|longitude|polyline|location|gps|^lat$|^lon$|^lng$/i;

function stripPos(v, depth){
  depth = depth || 0;
  if(depth > 12 || v == null || typeof v !== "object") return v;
  if(Array.isArray(v)) return v.map(x => stripPos(x, depth + 1));
  const o = {};
  for(const [k, val] of Object.entries(v)) if(!NO_POS.test(k)) o[k] = stripPos(val, depth + 1);
  return o;
}

const EXP_ABOUT = [
  "Export av ett träningspass från Tims träningssida (Garmin-data). Position är borttagen.",
  "pass: sammanfattning med svenska namn. Tider i minuter, distans i km, fart i m/s, pulszoner som minuter i zon 1–5, trimp_edwards = minuter i zon × zonnummer.",
  "atlet: maxpuls och vilopuls med källa.",
  "garmin: Garmins egna svar för passet (listposten, detaljer och workouts) utan positionsfält.",
  "tidsserie: en rad per punkt i FIT-filen, oftast varje sekund. puls_ra är pulsen som klockan registrerade, puls är pulsen efter sidans pulskontroll (null där den räknas som störning). storning anger varför: topp, fall, lag_i_rorelse, saknas eller over_maxpuls. kadens är steg per minut för löpning och gång, annars varv per minut.",
  "splittar: per km (cykel per 5 km), höjdmeter med 2 m hysteres.",
  "pulskontroll: sidans bedömning av pulsdatan och sekunder per typ av störning.",
  "loggat_pass, besvar, fragor_till_claude: det som är kopplat till passet på sidan.",
  "liknande_pass: de tio senaste passen av samma typ.",
].join("\n");

async function exportSession(x){
  const rest = hrRest(), max = hrMax();
  const out = {
    format: "traningsdata-pass", version: 1, exporterad: new Date().toISOString(), om: EXP_ABOUT,
    pass: askSummary(x),
    atlet: { maxpuls: r0(max.v), maxpuls_kalla: max.src, vilopuls: r0(rest.v), vilopuls_kalla: rest.src },
  };
  let det = null;
  try{ det = await api("/api/activity/" + x.id); }catch(e){ out.garmin_detaljer_fel = e.message; }
  out.garmin = stripPos({ lista: x.raw || null, detaljer: det ? det.details : null, workouts: det ? det.workouts : null });
  try{
    const raw = await loadFit(x.id);
    const A = analyzeFit(raw, max.v, rest.v);
    const { bad, recs } = fitClean(x, A, max.v);
    const run = x.grp === "run" || x.type === "walking" || x.type === "hiking";
    const FL = { 1: "topp", 2: "fall", 3: "lag_i_rorelse", 4: "saknas" };
    const t0 = A.recs.length ? A.recs[0].t : 0;
    const clockOf = t => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
    const cols = ["sek", "klockslag", "puls_ra", "puls", "storning", "hojd_m", "fart_m_s", "distans_m", "kadens", "effekt_w", "temp_c"];
    const rows = A.recs.map((r, i) => [
      Math.round((r.t - t0)/1000), clockOf(r.t), r.hr || null, recs[i].hr || null,
      bad(r, i) ? (FL[A.flag[i]] || (r.hr ? "over_maxpuls" : "saknas")) : null,
      r.alt != null ? r1(r.alt) : null, r.spd != null ? Math.round(r.spd*100)/100 : null, r.dist != null ? r1(r.dist) : null,
      r.cad != null ? (run ? r.cad*2 : r.cad) : null, r.pwr != null ? r.pwr : null, r.temp != null ? r.temp : null,
    ]);
    const keep = cols.map((c, i) => i < 2 || rows.some(row => row[i] != null));
    out.tidsserie = { kolumner: cols.filter((c, i) => keep[i]), rader: rows.map(row => row.filter((v, i) => keep[i])) };
    const sp = x.dist > 1500 ? askSplits(recs, x.grp === "cyc" ? 5000 : 1000) : null;
    if(sp) out.splittar = sp;
    const ban = x.hrq && x.hrq.state === "opalitlig" ? null : banister(recs, rest.v, max.v);
    if(ban != null) out.pass.trimp_banister = r0(ban);
    const dec = x.grp === "run" && x.hrOk !== false ? decoupling(recs) : null;
    if(dec) out.pass.aerob_avkoppling_procent = r1(dec.pct);
    const it = A.item;
    out.pulskontroll = { bedomning: x.hrq ? x.hrq.state : null, markering: x.hrq ? x.hrq.mark || null : null, sekunder_i_rorelse: r0(it.act), sekunder_utan_puls: r0(it.miss), sekunder_plotsliga_toppar: r0(it.jump), sekunder_plotsliga_fall: r0(it.drop), sekunder_lag_puls_i_rorelse: r0(it.low), hogsta_puls_i_filen: it.raw };
  }catch(e){ out.fil_fel = "Originalfilen kunde inte läsas: " + e.message; }
  const lg = logFor(x);
  if(lg && lg.data) out.loggat_pass = lg.data;
  const iss = [];
  (S.issues || []).forEach(i => (i.r || []).forEach(r => { if(String(r.a) === String(x.id)) iss.push({ besvar: issueLabel(i), datum: r.d, nar: r.w, niva_1_4: r.l, anteckning: r.n || null }); }));
  if(iss.length) out.besvar = iss;
  const conv = ASK.conv[x.id];
  if(conv && conv.turns && conv.turns.length) out.fragor_till_claude = conv.turns.map(t => ({ fraga: t.q, svar: t.a, modell: t.model || null }));
  out.liknande_pass = askPeers(x);
  return out;
}

function expFileName(x){
  const slug = String(x.name || "pass").toLowerCase().replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return "pass-" + dayKey(x.date) + (slug ? "-" + slug : "") + ".json";
}

// Ett eget kort under Fråga Claude. Filen skapas i ett första tryck och delas eller laddas ner i ett andra,
// eftersom telefonen bara tillåter delning direkt efter ett tryck.
function renderExportCard(x){
  const ask = $("#askcard"); if(!ask) return;
  let el = $("#expcard");
  if(!el){ ask.insertAdjacentHTML("afterend", '<section class="card" id="expcard"></section>'); el = $("#expcard"); }
  if(EXP.id !== x.id){ EXP.id = x.id; EXP.file = null; }
  let h = '<h2>Exportera</h2><div class="sub">All data för passet i en fil: måtten, Garmins rådata, tidsserien sekund för sekund ur FIT-filen, splittar, pulskontroll, loggat pass, besvär och frågorna till Claude. Position tas bort. Filen går att skicka till Claude i chatten.</div><div class="btnrow" style="margin-top:8px">';
  if(!EXP.file) h += '<button class="btn ghost small" id="exp-go">Skapa fil</button>';
  else {
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [EXP.file] }));
    h += (canShare ? '<button class="btn small" id="exp-share">Dela</button>' : '') + '<button class="btn ghost small" id="exp-dl">Ladda ner</button><span class="sub" style="align-self:center">' + esc(EXP.file.name) + ', ' + num(EXP.file.size/1024) + ' kB</span>';
  }
  h += '</div><div id="exp-status"></div>';
  el.innerHTML = h;
  if($("#exp-go")) $("#exp-go").onclick = async () => {
    const b = $("#exp-go"); b.disabled = true; b.textContent = "Samlar ihop …";
    try{
      const data = await exportSession(x);
      if(EXP.id !== x.id) return;
      EXP.file = new File([JSON.stringify(data)], expFileName(x), { type: "application/json" });
    }catch(e){ if($("#exp-status")) $("#exp-status").innerHTML = '<div class="banner" style="margin-top:8px">' + esc(e.message) + '</div>'; }
    if(S.openId === x.id) renderExportCard(x);
  };
  if($("#exp-share")) $("#exp-share").onclick = async () => {
    try{ await navigator.share({ files: [EXP.file], title: x.name }); }
    catch(e){ if(e.name !== "AbortError") toast("Delningen fungerade inte, prova Ladda ner"); }
  };
  if($("#exp-dl")) $("#exp-dl").onclick = () => {
    const url = URL.createObjectURL(EXP.file);
    const a = document.createElement("a"); a.href = url; a.download = EXP.file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
}

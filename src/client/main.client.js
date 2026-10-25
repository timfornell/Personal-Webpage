// ---------- Start ----------
const RECENT_DAYS = 62;
function setData(j, days){
  S.all = (j.activities || []).map(norm).filter(x => !isNaN(x.date)).sort((a, b) => b.date - a.date);
  S.loadedDays = days; S.source = j.source || "garmin";
  invalidate();
  $("#loading").hidden = true;
  showTab(S.tab);
}
function bgNote(text){ $("#loaderr").innerHTML = text ? '<div class="note" style="padding:10px 0 0"><span class="spin"></span>' + esc(text) + '</div>' : ""; }
async function load(days){
  $("#loaderr").innerHTML = "";
  if(!S.all.length){ $("#loading").hidden = false; $("#loading").innerHTML = '<div class="note"><span class="spin"></span>Hämtar dina pass …</div>'; }
  try{
    // Med databas: visa de senaste två månaderna direkt, hämta resten från Garmin i bakgrunden
    if(S.storage && S.storage.db && days > RECENT_DAYS && !S.all.length){
      try{ setData(await api("/api/activities?days=" + RECENT_DAYS), RECENT_DAYS); }catch(e){}
    }
    if(S.all.length) bgNote("Hämtar " + (days > 400 ? "tre års" : "ett års") + " historik från Garmin …");
    setData(await api("/api/activities?days=" + days), days);
    bgNote("");
  }catch(e){
    $("#loading").hidden = true;
    $("#loaderr").innerHTML = '<div class="banner" style="margin-top:14px">' + esc(e.message) + '</div>';
  }
}
document.querySelector(".tabs").onclick = e => { const b = e.target.closest(".tab"); if(b){ showTab(b.dataset.tab); window.scrollTo(0, 0); } };
let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if(S.all.length && $("#sheet").hidden) RENDER[S.tab](); }, 150); });

(async function start(){
  CFG = fixCfg(store.get("cfg", null));
  $$(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  try{
    const s = await api("/api/status");
    S.storage = s.storage || { db: false }; S.claude = !!s.claude;
    $("#who").innerHTML = '<span class="dot ok"></span>' + esc(s.email || "Ansluten");
  }catch(e){
    S.storage = { db: false };
    $("#who").innerHTML = '<span class="dot err"></span>Garmin ej ansluten';
  }
  if(S.storage.db){
    try{
      const j = await api("/api/settings");
      const remote = j.settings && j.settings[CFG_KEY];
      if(remote && (!CFG.updated || (remote.updated || 0) >= CFG.updated)){ CFG = fixCfg(remote); store.set("cfg", CFG); }
      else if(CFG.updated) saveCfg();      // inställningar gjorda innan databasen fanns
    }catch(e){}
  }
  const extras = Promise.all([loadDaily(62, false), S.storage.db ? loadLogs() : Promise.resolve(), issuesLoad(), suggLoad()]);
  await load(365);
  await extras;
  invalidate();
  rerender();
  hrqInit();
})();

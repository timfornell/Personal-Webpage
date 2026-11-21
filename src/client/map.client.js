// ---------- Karta med GPS-spåret ----------
// Spåret ur FIT-filen ritas ovanpå kartbitar från OpenStreetMap som Workern hämtar (/api/tile),
// så att webbläsaren bara pratar med sidan själv. Positionen visas bara här och skickas inte vidare.
const MAP_TILE = 256, MAP_H = 280;
const mercX = (lon, z) => (lon + 180) / 360 * MAP_TILE * 2 ** z;
const mercY = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * MAP_TILE * 2 ** z; };

// Stilarna ligger här så att kartkortet är självständigt
(function(){
  const st = document.createElement("style");
  st.textContent = ".map{position:relative; overflow:hidden; border-radius:10px; background:var(--sunk); touch-action:none; user-select:none; -webkit-user-select:none; cursor:grab}" +
    ".map .tiles img{position:absolute; left:0; top:0; width:256px; height:256px; max-width:none; pointer-events:none}" +
    ".map svg{position:absolute; left:0; top:0; pointer-events:none}" +
    ".map .mapbtns{position:absolute; right:8px; top:8px; display:flex; flex-direction:column; gap:4px}" +
    ".map .mapbtns .ib{box-shadow:0 1px 3px rgba(0,0,0,.2)}" +
    ".map-attr{font-size:11px; margin-top:4px} .map-attr a{color:inherit}";
  document.head.appendChild(st);
})();

// Läggs mellan pulskortet och Fråga Claude när passet har GPS
function renderMapCard(x){
  loadFit(x.id).then(recs => {
    if(S.openId !== x.id || $("#mapcard") || !$("#askcard")) return;
    const pts = recs.filter(r => r.lat != null && r.lon != null && Math.abs(r.lat) < 85 && Math.abs(r.lon) <= 180 && (r.lat !== 0 || r.lon !== 0));
    if(pts.length < 10) return;
    $("#askcard").insertAdjacentHTML("beforebegin", '<section class="card" id="mapcard"><h2>Karta</h2><div class="map" id="map"></div>' +
      '<div class="readout" id="map-ro">Tryck på spåret för att se tid, puls och höjd. Dra för att flytta kartan.</div>' +
      '<div class="sub map-attr">Karta © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-bidragsgivare</div></section>');
    drawMap($("#map"), pts, recs[0].t, x);
  }).catch(() => {});
}

function drawMap(el, pts, t0, x){
  el.style.height = MAP_H + "px";
  const W = () => el.clientWidth || 340;
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  const box = { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lons), w: Math.min(...lons) };
  const fitView = () => {
    let z = 17;
    for(; z > 2; z--) if(mercX(box.e, z) - mercX(box.w, z) <= W() - 48 && mercY(box.s, z) - mercY(box.n, z) <= MAP_H - 48) break;
    return { z, cx: (mercX(box.e, z) + mercX(box.w, z)) / 2, cy: (mercY(box.s, z) + mercY(box.n, z)) / 2 };
  };
  let view = fitView(), mark = null;
  const step = Math.max(1, Math.floor(pts.length / 1500));
  const line = pts.filter((p, i) => !(i % step) || i === pts.length - 1);
  el.innerHTML = '<div class="tiles"></div><svg></svg><div class="mapbtns"><button class="ib" data-z="1" aria-label="Zooma in">+</button><button class="ib" data-z="-1" aria-label="Zooma ut">−</button><button class="ib" data-z="0" aria-label="Visa hela spåret">⤢</button></div>';
  const tiles = el.querySelector(".tiles"), svg = el.querySelector("svg"), imgs = {};

  const render = () => {
    const w = W(), z = view.z, n = 2 ** z, x0 = view.cx - w / 2, y0 = view.cy - MAP_H / 2, used = {};
    for(let tx = Math.floor(x0 / MAP_TILE); tx <= Math.floor((x0 + w) / MAP_TILE); tx++){
      for(let ty = Math.floor(y0 / MAP_TILE); ty <= Math.floor((y0 + MAP_H) / MAP_TILE); ty++){
        if(ty < 0 || ty >= n) continue;
        const k = z + "/" + (((tx % n) + n) % n) + "/" + ty, key = k + "@" + tx;
        used[key] = 1;
        let im = imgs[key];
        if(!im){ im = imgs[key] = document.createElement("img"); im.alt = ""; im.decoding = "async"; im.src = "/api/tile/" + k; tiles.appendChild(im); }
        im.style.transform = "translate(" + Math.round(tx * MAP_TILE - x0) + "px," + Math.round(ty * MAP_TILE - y0) + "px)";
      }
    }
    Object.keys(imgs).forEach(k => { if(!used[k]){ imgs[k].remove(); delete imgs[k]; } });
    const P = p => [mercX(p.lon, z) - x0, mercY(p.lat, z) - y0];
    const d = line.map((p, i) => (i ? "L" : "M") + P(p).map(v => v.toFixed(1)).join(" ")).join("");
    const s = P(pts[0]), e = P(pts[pts.length - 1]);
    const dot = (c, fill, r) => '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="' + r + '" fill="' + fill + '" stroke="#fff" stroke-width="2"/>';
    svg.setAttribute("width", w); svg.setAttribute("height", MAP_H); svg.setAttribute("viewBox", "0 0 " + w + " " + MAP_H);
    svg.innerHTML = '<path d="' + d + '" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>' +
      '<path d="' + d + '" fill="none" stroke="#d0342c" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dot(e, "#17211e", 6) + dot(s, "#2f9e5b", 6) + (mark ? dot(P(mark), "#1d64b0", 7) : "");
  };

  const zoom = dz => {
    if(!dz){ view = fitView(); render(); return; }
    const z = Math.min(18, Math.max(2, view.z + dz)); if(z === view.z) return;
    const f = 2 ** (z - view.z); view = { z, cx: view.cx * f, cy: view.cy * f }; render();
  };
  el.querySelector(".mapbtns").onclick = e => { const b = e.target.closest("[data-z]"); if(b){ e.stopPropagation(); zoom(+b.dataset.z); } };
  el.querySelector(".mapbtns").onpointerdown = e => e.stopPropagation();

  // Dra för att flytta, tryck för att se punkten närmast spåret
  let drag = null;
  el.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false }; el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing"; };
  el.onpointermove = e => {
    if(!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if(Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if(drag.moved){ view.cx = drag.cx - dx; view.cy = drag.cy - dy; render(); }
  };
  el.onpointerup = el.onpointercancel = e => {
    const was = drag; drag = null; el.style.cursor = "";
    if(!was || was.moved || e.type === "pointercancel") return;
    const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const x0 = view.cx - W() / 2, y0 = view.cy - MAP_H / 2;
    let best = null, bd = Infinity;
    pts.forEach(p => { const d = (mercX(p.lon, view.z) - x0 - px) ** 2 + (mercY(p.lat, view.z) - y0 - py) ** 2; if(d < bd){ bd = d; best = p; } });
    if(!best || bd > 40 * 40) return;
    mark = best; render();
    const run = x.grp === "run" || x.type === "walking" || x.type === "hiking";
    const parts = [Math.round((best.t - t0) / 60000) + " min"];
    if(best.dist != null) parts.push(num(best.dist / 1000, 2) + " km");
    if(best.hr) parts.push(best.hr + " bpm");
    if(best.alt != null) parts.push(num(best.alt) + " m ö.h.");
    if(best.spd > 0.3) parts.push(run ? paceTxt(best.spd) : num(best.spd * 3.6, 1) + " km/h");
    const ro = $("#map-ro"); if(ro) ro.innerHTML = '<b>' + esc(parts[0]) + '</b>' + (parts.length > 1 ? ' · ' + esc(parts.slice(1).join(" · ")) : '');
  };
  const onResize = () => { if(!document.body.contains(el)){ window.removeEventListener("resize", onResize); return; } render(); };
  window.addEventListener("resize", onResize);
  render();
}

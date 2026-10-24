// ---------- Diagram (SVG) ----------
function niceMax(v){ if(v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v/p; return (n<=1?1:n<=2?2:n<=5?5:10)*p; }
function W(el){ return Math.max(260, Math.round(el.clientWidth || 320)); }

// Staplar per kategori. series: [{color, vals}], staplas ovanpå varandra.
function barChart(el, labels, series, opt){
  opt = opt || {};
  const w = W(el), h = opt.h || 170, L = 38, R = 6, T = 8, B = 20, n = labels.length;
  if(!n){ el.innerHTML = '<div class="note">Ingen data.</div>'; return; }
  const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.vals[i] || 0), 0));
  const max = opt.max || niceMax(Math.max(...totals, opt.minMax || 0, opt.ref || 0));
  const bw = (w-L-R)/n, gap = Math.max(1, Math.min(6, bw*0.25));
  const y = v => T + (h-T-B) * (1 - v/max);
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
  for(let k = 0; k <= 3; k++){ const v = max*k/3, yy = y(v); s += '<line class="grid" x1="' + L + '" x2="' + (w-R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L-5) + '" y="' + (yy+3) + '" text-anchor="end">' + esc(opt.fmt ? opt.fmt(v) : num(v)) + '</text>'; }
  labels.forEach((lb, i) => {
    const x = L + i*bw + gap/2; let acc = 0;
    series.forEach(se => { const v = se.vals[i] || 0; if(!v) return; const y1 = y(acc+v), y0 = y(acc); s += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + (bw-gap).toFixed(1) + '" height="' + Math.max(0.5, y0-y1).toFixed(1) + '" fill="' + se.color + '" rx="2"/>'; acc += v; });
    if(opt.sel === i) s += '<rect x="' + (x-1) + '" y="' + T + '" width="' + (bw-gap+2) + '" height="' + (h-T-B) + '" fill="none" stroke="var(--ink)" stroke-width="1" rx="3"/>';
    const every = Math.ceil(n / Math.max(1, Math.floor((w-L)/34)));
    if(i % every === 0 || (i === n-1 && n < 14)) s += '<text x="' + (x+(bw-gap)/2) + '" y="' + (h-5) + '" text-anchor="middle">' + esc(lb) + '</text>';
  });
  if(opt.ref != null && opt.ref <= max){ const yy = y(opt.ref); s += '<line x1="' + L + '" x2="' + (w-R) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--ink)" stroke-opacity=".5" stroke-dasharray="4 3"/>'; }
  s += '</svg>';
  el.innerHTML = s;
  el.querySelector("svg").onclick = ev => {
    const r = ev.currentTarget.getBoundingClientRect(); const px = (ev.clientX - r.left)*w/r.width;
    const i = Math.floor((px-L)/bw); if(i >= 0 && i < n && opt.onPick){ opt.sel = i; barChart(el, labels, series, opt); opt.onPick(i); }
  };
}

// Punkter över tid med glidande snitt. pts: [{x:Date, y:Number, ref, color}]
function lineChart(el, pts, opt){
  opt = opt || {};
  if(pts.length < 2){ el.innerHTML = '<div class="note">För få värden i perioden.</div>'; return; }
  const w = W(el), h = opt.h || 170, L = 40, R = 8, T = 10, B = 20;
  const xs = pts.map(p => +p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0+1;
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if(opt.band){ y0 = Math.min(y0, opt.band[0]); y1 = Math.max(y1, opt.band[1]); }
  const padY = (y1-y0)*0.12 || 1; y0 -= padY; y1 += padY;
  const X = v => L + (w-L-R) * ((v-x0)/((x1-x0)||1));
  const Y = v => opt.invert ? T + (h-T-B)*((v-y0)/(y1-y0)) : T + (h-T-B)*(1-(v-y0)/(y1-y0));
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
  for(let k = 0; k <= 3; k++){ const v = y0+(y1-y0)*k/3, yy = Y(v); s += '<line class="grid" x1="' + L + '" x2="' + (w-R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L-5) + '" y="' + (yy+3) + '" text-anchor="end">' + esc(opt.fmt ? opt.fmt(v) : num(v)) + '</text>'; }
  [0, 0.5, 1].forEach(f => { const t = x0+(x1-x0)*f; s += '<text x="' + X(t) + '" y="' + (h-5) + '" text-anchor="' + (f===0?"start":f===1?"end":"middle") + '">' + shortDate(new Date(t)) + '</text>'; });
  if(opt.band){ const a = Y(opt.band[0]), b = Y(opt.band[1]); s += '<rect x="' + L + '" width="' + (w-L-R) + '" y="' + Math.min(a,b) + '" height="' + Math.abs(a-b) + '" fill="var(--good)" fill-opacity=".12"/>'; }
  const k = opt.raw ? 1 : Math.max(3, Math.min(8, Math.round(pts.length/6)));
  const roll = pts.map((p, i) => { const win = pts.slice(Math.max(0, i-k+1), i+1); return [X(+p.x), Y(win.reduce((a,b) => a+b.y, 0)/win.length)]; });
  s += '<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + roll.map(p => p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ") + '"/>';
  pts.forEach((p, i) => { s += '<circle cx="' + X(+p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (opt.sel===i?5:3) + '" fill="' + (p.color||"var(--accent)") + '" fill-opacity="' + (opt.sel===i?1:.55) + '"' + (opt.sel===i?' stroke="var(--ink)" stroke-width="1.5"':'') + '/>'; });
  s += '</svg>';
  el.innerHTML = s;
  el.querySelector("svg").onclick = ev => {
    const r = ev.currentTarget.getBoundingClientRect(); const px = (ev.clientX-r.left)*w/r.width, py = (ev.clientY-r.top)*h/r.height;
    let best = -1, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(X(+p.x)-px, (Y(p.y)-py)*0.5); if(d < bd){ bd = d; best = i; } });
    if(best >= 0 && opt.onPick){ opt.sel = best; lineChart(el, pts, opt); opt.onPick(pts[best]); }
  };
}

// Flera linjer över datum. series: [{name, color, pts:[{x,y}], dash, dots, width}]
// opt.bandSeries: {lo:[{x,y}], hi:[{x,y}]} ritas som ett fält. opt.zero ritar nollinjen.
function multiLine(el, series, opt){
  opt = opt || {};
  const all = series.flatMap(s => s.pts).filter(p => p.y != null && isFinite(p.y));
  if(all.length < 2){ el.innerHTML = '<div class="note">För få värden i perioden.</div>'; return; }
  const w = W(el), h = opt.h || 170, L = 40, R = 8, T = 10, B = 20;
  let x0 = Math.min(...all.map(p => +p.x)), x1 = Math.max(...all.map(p => +p.x));
  if(opt.from) x0 = Math.min(x0, +opt.from);
  if(x1 === x0) x1 = x0 + DAY;
  const bandPts = opt.bandSeries ? opt.bandSeries.lo.concat(opt.bandSeries.hi).filter(p => p.y != null) : [];
  let y0 = Math.min(...all.map(p => p.y), ...bandPts.map(p => p.y)), y1 = Math.max(...all.map(p => p.y), ...bandPts.map(p => p.y));
  if(opt.zero){ y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  if(opt.min != null) y0 = Math.min(y0, opt.min);
  const padY = (y1-y0)*0.1 || 1; y0 -= padY; y1 += padY;
  const X = v => L + (w-L-R)*((v-x0)/(x1-x0));
  const Y = v => T + (h-T-B)*(1-(v-y0)/(y1-y0));
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
  for(let k = 0; k <= 3; k++){ const v = y0+(y1-y0)*k/3, yy = Y(v); s += '<line class="grid" x1="' + L + '" x2="' + (w-R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L-5) + '" y="' + (yy+3) + '" text-anchor="end">' + esc(opt.fmt ? opt.fmt(v) : num(v)) + '</text>'; }
  [0, 0.5, 1].forEach(f => { const t = x0+(x1-x0)*f; s += '<text x="' + X(t) + '" y="' + (h-5) + '" text-anchor="' + (f===0?"start":f===1?"end":"middle") + '">' + esc(opt.xfmt ? opt.xfmt(t) : shortDate(new Date(t))) + '</text>'; });
  if(opt.zero){ s += '<line x1="' + L + '" x2="' + (w-R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--muted)" stroke-width="1"/>'; }
  if(opt.bandSeries){
    const lo = opt.bandSeries.lo.filter(p => p.y != null), hi = opt.bandSeries.hi.filter(p => p.y != null);
    if(lo.length > 1 && hi.length > 1) s += '<polygon fill="var(--good)" fill-opacity=".13" points="' + hi.map(p => X(+p.x).toFixed(1)+","+Y(p.y).toFixed(1)).concat(lo.slice().reverse().map(p => X(+p.x).toFixed(1)+","+Y(p.y).toFixed(1))).join(" ") + '"/>';
  }
  series.forEach(se => {
    const pts = se.pts.filter(p => p.y != null && isFinite(p.y));
    if(se.dots) pts.forEach(p => { s += '<circle cx="' + X(+p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="2.5" fill="' + se.color + '" fill-opacity=".55"/>'; });
    if(!se.dots || se.line){
      // Bryt linjen vid luckor större än två dagar
      let seg = [], segs = [];
      pts.forEach((p, i) => { if(i && +p.x - +pts[i-1].x > (se.gap || 2.5*DAY)){ segs.push(seg); seg = []; } seg.push(p); });
      segs.push(seg);
      segs.filter(g => g.length > 1).forEach(g => { s += '<polyline fill="none" stroke="' + se.color + '" stroke-width="' + (se.width||2.2) + '"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + ' stroke-linejoin="round" stroke-linecap="round" points="' + g.map(p => X(+p.x).toFixed(1)+","+Y(p.y).toFixed(1)).join(" ") + '"/>'; });
    }
  });
  if(opt.selX != null){ const xx = X(+opt.selX); s += '<line x1="' + xx + '" x2="' + xx + '" y1="' + T + '" y2="' + (h-B) + '" stroke="var(--ink)" stroke-opacity=".5"/>'; }
  s += '</svg>';
  el.innerHTML = s;
  el.querySelector("svg").onclick = ev => {
    const r = ev.currentTarget.getBoundingClientRect(); const px = (ev.clientX-r.left)*w/r.width;
    const t = x0 + (px-L)/(w-L-R)*(x1-x0);
    let best = null, bd = Infinity; all.forEach(p => { const d = Math.abs(+p.x - t); if(d < bd){ bd = d; best = p.x; } });
    if(best != null && opt.onPick){ opt.selX = best; multiLine(el, series, opt); opt.onPick(best); }
  };
}

function zoneBar(z, thin){
  const t = z ? sum(z) : 0;
  if(!t) return '<div class="zbar' + (thin?" thin":"") + '"></div>';
  return '<div class="zbar' + (thin?" thin":"") + '" aria-label="Pulszoner">' + z.map((v, i) => v ? '<span style="width:' + (v/t*100).toFixed(2) + '%;background:' + ZC[i] + '"></span>' : "").join("") + '</div>';
}
function legend(items){ return '<div class="legend">' + items.map(([c, t, dash]) => '<span><i style="background:' + c + (dash ? ';height:3px;vertical-align:3px' : '') + '"></i>' + esc(t) + '</span>').join("") + '</div>'; }

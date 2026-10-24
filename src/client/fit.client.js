// ---------- FIT-filen: puls och fart sekund för sekund ----------
// Garmin skickar originalfilen, oftast som zip. Sidan packar upp den och läser record-meddelanden
// (global 20): tid (253), puls (3), fart (6 eller 73) och distans (5).
async function unzipFirst(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  if(!(u8[0] === 0x50 && u8[1] === 0x4b)) return buf;               // inte zip
  let eocd = -1;
  for(let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  if(eocd < 0) throw new Error("Trasig zip-fil");
  const cd = dv.getUint32(eocd + 16, true);
  if(dv.getUint32(cd, true) !== 0x02014b50) throw new Error("Trasig zip-fil");
  const method = dv.getUint16(cd + 10, true), csize = dv.getUint32(cd + 20, true), lho = dv.getUint32(cd + 42, true);
  const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
  const data = u8.slice(start, start + csize);
  if(method === 0) return data.buffer;
  if(method !== 8) throw new Error("Okänd komprimering i zip-filen");
  if(typeof DecompressionStream === "undefined") throw new Error("Webbläsaren kan inte packa upp filen");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).arrayBuffer();
}

function parseFit(buf){
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const hsize = u8[0];
  if(hsize < 12 || String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== ".FIT") throw new Error("Inte en FIT-fil");
  const end = Math.min(u8.length, hsize + dv.getUint32(4, true));
  const defs = {}, recs = [];
  let p = hsize, lastTs = 0;
  const FIT_EPOCH = 631065600; // 1989-12-31 i Unix-sekunder
  const rd = (off, size, le) => size === 1 ? dv.getUint8(off) : size === 2 ? dv.getUint16(off, le) : size === 4 ? dv.getUint32(off, le) : null;
  const invalid = (v, size) => v == null || (size === 1 && v === 0xFF) || (size === 2 && v === 0xFFFF) || (size === 4 && v === 0xFFFFFFFF);
  while(p < end){
    const h = u8[p++];
    let local, tsOffset = null;
    if(h & 0x80){ local = (h >> 5) & 3; tsOffset = h & 0x1F; }
    else if(h & 0x40){
      local = h & 0x0F;
      const le = u8[p+1] === 0, glob = dv.getUint16(p+2, le), n = u8[p+4];
      p += 5;
      const fields = [];
      for(let i = 0; i < n; i++){ fields.push({ num: u8[p], size: u8[p+1] }); p += 3; }
      let devSize = 0;
      if(h & 0x20){ const nd = u8[p++]; for(let i = 0; i < nd; i++){ devSize += u8[p+1]; p += 3; } }
      defs[local] = { glob, le, fields, devSize };
      continue;
    } else local = h & 0x0F;
    const d = defs[local];
    if(!d) throw new Error("FIT-filen saknar en definition");
    if(d.glob === 20){
      const r = {};
      let off = p;
      for(const f of d.fields){
        const v = rd(off, f.size, d.le);
        if(!invalid(v, f.size)){
          if(f.num === 253) r.ts = v;
          else if(f.num === 3 && f.size === 1) r.hr = v;
          else if(f.num === 6 && f.size === 2) r.spd = v/1000;
          else if(f.num === 73 && f.size === 4) r.spd = v/1000;
          else if(f.num === 5 && f.size === 4) r.dist = v/100;
        }
        off += f.size;
      }
      if(r.ts == null && tsOffset != null){ let t = (lastTs & ~0x1F) + tsOffset; if(tsOffset < (lastTs & 0x1F)) t += 0x20; r.ts = t; }
      if(r.ts != null){ lastTs = r.ts; r.t = (r.ts + FIT_EPOCH)*1000; recs.push(r); }
    } else {
      // Håll tidsstämpeln aktuell för komprimerade huvuden
      let off = p;
      for(const f of d.fields){ if(f.num === 253 && f.size === 4){ const v = rd(off, 4, d.le); if(!invalid(v, 4)) lastTs = v; } off += f.size; }
    }
    p += d.fields.reduce((s, f) => s + f.size, 0) + d.devSize;
  }
  return recs;
}

// Banister TRIMP (män): minuter × HRr × 0,64·e^(1,92·HRr), HRr = (puls − vila)/(max − vila)
function banister(recs, rest, max){
  if(!rest || !max || max <= rest) return null;
  let t = 0, n = 0;
  for(let i = 1; i < recs.length; i++){
    const a = recs[i-1], b = recs[i];
    if(a.hr == null) continue;
    const dt = (b.t - a.t)/60000; if(dt <= 0 || dt > 0.5) continue;
    const r = Math.min(1, Math.max(0, (a.hr - rest)/(max - rest)));
    t += dt*r*0.64*Math.exp(1.92*r); n++;
  }
  return n ? t : null;
}

// Aerob avkoppling: hur mycket fart per puls sjunker från första till andra halvan (TrainingPeaks)
function decoupling(recs){
  const ok = recs.filter(r => r.hr > 60 && r.spd > 0.5);
  if(ok.length < 120) return null;
  const durMin = (ok[ok.length-1].t - ok[0].t)/60000;
  if(durMin < 20) return null;
  const mid = ok[0].t + (ok[ok.length-1].t - ok[0].t)/2;
  const half = arr => mean(arr.map(r => r.spd))/mean(arr.map(r => r.hr));
  const a = half(ok.filter(r => r.t < mid)), b = half(ok.filter(r => r.t >= mid));
  return { pct: (a - b)/a*100, first: a*60, second: b*60, minutes: durMin };
}

const FITC = {};
async function loadFit(id){
  if(FITC[id]) return FITC[id];
  const r = await fetch("/api/fit/" + id);
  if(!r.ok){ let j = null; try{ j = await r.json(); }catch(e){} throw new Error((j && j.error) || ("HTTP " + r.status)); }
  const recs = parseFit(await unzipFirst(await r.arrayBuffer()));
  FITC[id] = recs;
  return recs;
}

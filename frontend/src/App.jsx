import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as api from './api.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmtDate(s) { return new Date(s+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }
function fmtDateShort(s) { return new Date(s+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"}); }
function fmtRange(dates) {
  if (!dates?.length) return "";
  const s = [...dates].sort();
  return s.length === 1 ? fmtDate(s[0]) : `${fmtDate(s[0])} — ${fmtDate(s[s.length-1])}`;
}
function fmtRangeShort(dates) {
  if (!dates?.length) return "";
  const s = [...dates].sort();
  return s.length === 1 ? fmtDateShort(s[0]) : `${fmtDateShort(s[0])} — ${fmtDateShort(s[s.length-1])}`;
}
function getCountry(v) {
  if (!v?.address && !v?.name) return "Unknown";
  const a = (v.address || "").toLowerCase();
  const n = (v.name || "").toLowerCase();
  if (a.includes("finland") || a.includes("helsinki")) return "Finland";
  if (a.includes("uk") || a.includes("united kingdom") || a.includes("london")) return "UK";
  if (a.includes("germany") || a.includes("berlin")) return "Germany";
  if (a.includes("portugal") || a.includes("lisbon") || a.includes("cascais")) return "Portugal";
  if (a.includes("poland") || a.includes("warsaw") || a.includes("gdynia")) return "Poland";
  if (a.includes("latvia") || a.includes("riga")) return "Latvia";
  if (a.includes("czech") || a.includes("prague")) return "Czech Republic";
  if (a.includes("belgium") || a.includes("brussels") || a.includes("antwerp")) return "Belgium";
  if (a.includes("санкт-петербург") || a.includes("с.-петербург") || a.includes("спб")) return "Russia (SPb)";
  if (a.includes("сочи")) return "Russia (Sochi)";
  if (a.includes("москва") || a.includes("красногорск") || a.includes("тушино")) return "Russia (Moscow)";
  if (v.lat > 59.7 && v.lat < 60.2 && v.lng > 29.5 && v.lng < 31.0) return "Russia (SPb)";
  if (v.lat > 55.5 && v.lat < 56.1 && v.lng > 37.0 && v.lng < 38.0) return "Russia (Moscow)";
  if (a || v.lat) return "Russia";
  return "Unknown";
}
function pureCountry(label) {
  if (label.startsWith("Russia")) return "Russia";
  return label;
}

// ─── Theme ───
function ThemeProvider({ children, dark }) {
  useEffect(() => {
    const vars = dark ? {
      "--bg-main":"#121212","--bg-card":"#1e1e1e","--bg-surface":"#181818","--bg-hover":"#252525",
      "--text-primary":"#e4e2d8","--text-secondary":"#8a8880","--text-tertiary":"#5c5b56",
      "--border":"#2a2a28","--border-hover":"#3a3a38","--accent":"#E8693B","--accent-dim":"#3a2218",
    } : {
      "--bg-main":"#faf9f6","--bg-card":"#ffffff","--bg-surface":"#f0f0ec","--bg-hover":"#e8e8e4",
      "--text-primary":"#1a1a18","--text-secondary":"#888880","--text-tertiary":"#bbbbaa",
      "--border":"#e5e5e0","--border-hover":"#d0d0c8","--accent":"#D85A30","--accent-dim":"#FAECE7",
    };
    Object.entries(vars).forEach(([k,v]) => document.documentElement.style.setProperty(k,v));
  }, [dark]);
  return children;
}

// ─── Stat Bar Chart (pure CSS) ───
function BarChart({ data, maxBars = 20, onClick }) {
  const sorted = [...data].sort((a,b) => b.count - a.count).slice(0, maxBars);
  const max = Math.max(...sorted.map(d => d.count), 1);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"3px" }}>
      {sorted.map((d,i) => (
        <div key={d.name} onClick={onClick?()=>onClick(d.name):undefined} style={{ display:"flex", alignItems:"center", gap:"8px", fontSize:"11px", cursor:onClick?"pointer":"default", borderRadius:"4px", padding:"1px 0", transition:"background .1s" }} onMouseEnter={e=>{if(onClick)e.currentTarget.style.background="var(--bg-hover)"}} onMouseLeave={e=>{e.currentTarget.style.background="transparent"}}>
          <span style={{ width:"clamp(80px, 30%, 140px)", textAlign:"right", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:onClick?"var(--text-primary)":"var(--text-secondary)", flexShrink:0, fontWeight:onClick?500:400 }} title={d.name}>{d.name}</span>
          <div style={{ flex:1, height:"18px", background:"var(--bg-surface)", borderRadius:"3px", overflow:"hidden", minWidth:"40px" }}>
            <div style={{ height:"100%", width:`${(d.count/max)*100}%`, background:`var(--accent)`, borderRadius:"3px", opacity: 0.7 + 0.3*(d.count/max), transition:"width .3s" }} />
          </div>
          <span style={{ width:"28px", fontSize:"10px", color:"var(--text-secondary)", textAlign:"right", flexShrink:0 }}>{d.count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Stats Dashboard ───
function StatsDashboard({ events, venues, onSelectArtist, onSelectYear, onSelectCountry, onSelectFestival }) {
  const [selectedYear, setSelectedYear] = useState(null);

  const stats = useMemo(() => {
    const byYear = {}, byArtist = {}, byCountry = {}, byFestival = {};
    let totalArtists = new Set();
    events.forEach(e => {
      const y = e.dates[0]?.slice(0,4);
      byYear[y] = (byYear[y]||0) + 1;
      e.artists.forEach(a => { byArtist[a] = (byArtist[a]||0)+1; totalArtists.add(a); });
      const v = venues.find(x => x.id === e.venueId);
      const c = getCountry(v);
      byCountry[c] = (byCountry[c]||0)+1;
      if (e.festivalName) byFestival[e.festivalName] = (byFestival[e.festivalName]||0)+1;
    });
    return { byYear, byArtist, byCountry, byFestival, totalArtists: totalArtists.size };
  }, [events, venues]);

  const yearStats = useMemo(() => {
    if (!selectedYear) return null;
    const yEvents = events.filter(e => e.dates[0]?.startsWith(selectedYear));
    const artists = {}, venueCounts = {}, countries = {};
    yEvents.forEach(e => {
      e.artists.forEach(a => { artists[a] = (artists[a]||0)+1; });
      const v = venues.find(x => x.id === e.venueId);
      if (v) { venueCounts[v.name] = (venueCounts[v.name]||0)+1; countries[getCountry(v)] = (countries[getCountry(v)]||0)+1; }
    });
    return { events: yEvents, gigs: yEvents.filter(e=>e.type==="gig").length, fests: yEvents.filter(e=>e.type==="festival").length, artists, venueCounts, countries, uniqueArtists: Object.keys(artists).length };
  }, [selectedYear, events, venues]);

  const yearData = Object.entries(stats.byYear).sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=>({name,count}));
  const maxY = Math.max(...yearData.map(d=>d.count),1);
  const gigs = events.filter(e=>e.type==="gig").length;
  const fests = events.filter(e=>e.type==="festival").length;

  const metricStyle = { background:"var(--bg-surface)", borderRadius:"10px", padding:"12px 14px", flex:"1 1 100px", minWidth:0 };
  const metricLabel = { fontSize:"10px", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.8px", color:"var(--text-secondary)", marginBottom:"4px" };
  const metricValue = { fontSize:"22px", fontWeight:600, color:"var(--text-primary)" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
        <div style={metricStyle}><div style={metricLabel}>Total events</div><div style={metricValue}>{events.length}</div></div>
        <div style={metricStyle}><div style={metricLabel}>Gigs</div><div style={metricValue}>{gigs}</div></div>
        <div style={metricStyle}><div style={metricLabel}>Festivals</div><div style={metricValue}>{fests}</div></div>
        <div style={metricStyle}><div style={metricLabel}>Artists seen</div><div style={metricValue}>{stats.totalArtists}</div></div>
        <div style={metricStyle}><div style={metricLabel}>Venues</div><div style={metricValue}>{venues.length}</div></div>
        <div style={metricStyle}><div style={metricLabel}>Countries</div><div style={metricValue}>{new Set(Object.keys(stats.byCountry).map(pureCountry)).size}</div></div>
      </div>

      <div>
        <h3 style={{ fontSize:"13px", fontWeight:600, margin:"0 0 10px", color:"var(--text-primary)" }}>Events by year <span style={{fontWeight:400,fontSize:"11px",color:"var(--text-tertiary)"}}>(click a bar)</span></h3>
        <div style={{ display:"flex", alignItems:"flex-end", gap:"3px", height:"120px" }}>
          {yearData.map(d => (
            <div key={d.name} onClick={()=>setSelectedYear(selectedYear===d.name?null:d.name)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:"3px", minWidth:0, cursor:"pointer" }}>
              <span style={{ fontSize:"9px", color:"var(--text-secondary)" }}>{d.count}</span>
              <div style={{ width:"100%", maxWidth:"32px", height:`${(d.count/maxY)*90}px`, background:selectedYear===d.name?"var(--text-primary)":"var(--accent)", borderRadius:"3px 3px 0 0", opacity:selectedYear===d.name?1:0.8, transition:"all .15s" }} />
              <span style={{ fontSize:"8px", color:selectedYear===d.name?"var(--text-primary)":"var(--text-tertiary)", fontWeight:selectedYear===d.name?700:400, transform:"rotate(-45deg)", whiteSpace:"nowrap" }}>{d.name.slice(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Year detail panel */}
      {selectedYear && yearStats && <div style={{ background:"var(--bg-surface)", borderRadius:"12px", padding:"18px 20px", border:"1px solid var(--border)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
          <h3 style={{ fontSize:"16px", fontWeight:600, margin:0, color:"var(--text-primary)" }}>{selectedYear}</h3>
          <button onClick={()=>setSelectedYear(null)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:"16px", color:"var(--text-tertiary)", padding:"4px" }}>✕</button>
        </div>
        <div style={{ display:"flex", gap:"10px", flexWrap:"wrap", marginBottom:"16px" }}>
          <div style={{...metricStyle,padding:"10px 14px"}}><div style={{...metricLabel,fontSize:"9px"}}>Events</div><div style={{...metricValue,fontSize:"18px"}}>{yearStats.events.length}</div></div>
          <div style={{...metricStyle,padding:"10px 14px"}}><div style={{...metricLabel,fontSize:"9px"}}>Gigs</div><div style={{...metricValue,fontSize:"18px"}}>{yearStats.gigs}</div></div>
          <div style={{...metricStyle,padding:"10px 14px"}}><div style={{...metricLabel,fontSize:"9px"}}>Festivals</div><div style={{...metricValue,fontSize:"18px"}}>{yearStats.fests}</div></div>
          <div style={{...metricStyle,padding:"10px 14px"}}><div style={{...metricLabel,fontSize:"9px"}}>Artists</div><div style={{...metricValue,fontSize:"18px"}}>{yearStats.uniqueArtists}</div></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(250px, 1fr))", gap:"16px" }}>
          <div>
            <h4 style={{ fontSize:"12px", fontWeight:600, margin:"0 0 8px", color:"var(--text-primary)" }}>Top artists in {selectedYear}</h4>
            <BarChart data={Object.entries(yearStats.artists).map(([name,count])=>({name,count}))} maxBars={10} onClick={onSelectArtist} />
          </div>
          <div>
            <h4 style={{ fontSize:"12px", fontWeight:600, margin:"0 0 8px", color:"var(--text-primary)" }}>Venues in {selectedYear}</h4>
            <BarChart data={Object.entries(yearStats.venueCounts).map(([name,count])=>({name,count}))} maxBars={10} onClick={(name)=>{onSelectArtist(name)}} />
          </div>
        </div>
        {Object.keys(yearStats.countries).length > 1 && <div style={{marginTop:"14px"}}>
          <h4 style={{ fontSize:"12px", fontWeight:600, margin:"0 0 8px", color:"var(--text-primary)" }}>Countries in {selectedYear}</h4>
          <BarChart data={Object.entries(yearStats.countries).map(([name,count])=>({name,count}))} onClick={onSelectCountry} />
        </div>}
        <div style={{marginTop:"14px"}}>
          <Btn onClick={()=>onSelectYear(selectedYear)} style={{fontSize:"11px",padding:"6px 14px"}}>View all {selectedYear} events on timeline →</Btn>
        </div>
      </div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:"20px" }}>
        <div>
          <h3 style={{ fontSize:"13px", fontWeight:600, margin:"0 0 10px", color:"var(--text-primary)" }}>Top artists <span style={{fontWeight:400,fontSize:"11px",color:"var(--text-tertiary)"}}>(click to filter)</span></h3>
          <BarChart data={Object.entries(stats.byArtist).map(([name,count])=>({name,count}))} maxBars={15} onClick={onSelectArtist} />
        </div>
        <div>
          <h3 style={{ fontSize:"13px", fontWeight:600, margin:"0 0 10px", color:"var(--text-primary)" }}>By country / city <span style={{fontWeight:400,fontSize:"11px",color:"var(--text-tertiary)"}}>(click to filter)</span></h3>
          <BarChart data={Object.entries(stats.byCountry).map(([name,count])=>({name,count}))} onClick={onSelectCountry} />
        </div>
      </div>

      {Object.keys(stats.byFestival).length > 0 && <div>
        <h3 style={{ fontSize:"13px", fontWeight:600, margin:"0 0 10px", color:"var(--text-primary)" }}>Recurring festivals <span style={{fontWeight:400,fontSize:"11px",color:"var(--text-tertiary)"}}>(click to filter)</span></h3>
        <BarChart data={Object.entries(stats.byFestival).filter(([,c])=>c>1).map(([name,count])=>({name,count}))} maxBars={15} onClick={onSelectFestival} />
      </div>}
    </div>
  );
}

// ─── Map ───
function MapView({ venues, events }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const markersRef = useRef([]);
  useEffect(() => {
    if (mapInst.current || !mapRef.current) return;
    const map = L.map(mapRef.current, { scrollWheelZoom:true, attributionControl:false}).setView([55.75,37.62],5);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{
      attribution:'&copy; OSM &copy; CARTO', subdomains:"abcd", maxZoom:19
    }).addTo(map);
    var myAttrControl = L.control.attribution().addTo(map);
    myAttrControl.setPrefix('<a href="https://leafletjs.com/">Leaflet</a>');

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: ''
      }).addTo(map);
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);
  useEffect(() => {
    if (!mapInst.current) return;
    markersRef.current.forEach(m => m.remove()); markersRef.current = [];
    const counts = {}; events.forEach(e => { counts[e.venueId]=(counts[e.venueId]||0)+1; });
    const valid = venues.filter(v => v.lat && v.lng);
    valid.forEach(venue => {
      const count = counts[venue.id]||0;
      const sz = Math.max(10,Math.min(28,8+count*2));
      const icon = L.divIcon({ className:"x", iconSize:[sz,sz], iconAnchor:[sz/2,sz/2],
        html:`<div style="width:${sz}px;height:${sz}px;background:#D85A30;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:700">${count||""}</div>`
      });
      const vEv = events.filter(e => e.venueId===venue.id).sort((a,b) => b.dates[0].localeCompare(a.dates[0]));
      const evHtml = vEv.slice(0,6).map(e => `<div style="margin:2px 0;font-size:11px;line-height:1.3">${e.type==="festival"?"🎪":"🎸"} ${e.artists.slice(0,2).join(", ")}${e.artists.length>2?"…":""}<br><span style="opacity:.5">${fmtRangeShort(e.dates)}</span></div>`).join("")+(vEv.length>6?`<div style="font-size:10px;opacity:.5">+${vEv.length-6} more</div>`:"");
      const popup = `<div style="min-width:180px;max-width:260px"><strong style="font-size:13px">${venue.name}</strong>${venue.address?`<div style="font-size:10px;opacity:.5;margin:2px 0">${venue.address}</div>`:""}<div style="border-top:1px solid #eee;padding-top:3px;margin-top:3px">${evHtml}</div></div>`;
      markersRef.current.push(L.marker([venue.lat,venue.lng],{icon}).addTo(mapInst.current).bindPopup(popup));
    });
    if (valid.length>1) mapInst.current.fitBounds(L.latLngBounds(valid.map(v=>[v.lat,v.lng])),{padding:[40,40],maxZoom:11});
  }, [venues, events]);
  return <div ref={mapRef} style={{ width:"100%", height:"100%", borderRadius:"12px" }} />;
}

// ─── Mini Map for venue detail ───
function VenueMiniMap({ lat, lng, name }) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (inst.current || !ref.current) return;
    const map = L.map(ref.current, { scrollWheelZoom:false, zoomControl:false, dragging:false, attributionControl:false }).setView([lat,lng], 14);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{
      attribution:'', subdomains:"abcd", maxZoom:19
    }).addTo(map);
    var myAttrControl = L.control.attribution().addTo(map);
    myAttrControl.setPrefix('<a href="https://leafletjs.com/">Leaflet</a>');
    const icon = L.divIcon({ className:"x", iconSize:[16,16], iconAnchor:[8,8],
      html:'<div style="width:16px;height:16px;background:#D85A30;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>'
    });
    L.marker([lat,lng],{icon}).addTo(map).bindPopup(name);
    inst.current = map;
    return () => { map.remove(); inst.current = null; };
  }, [lat, lng, name]);
  return <div ref={ref} style={{width:"100%",height:"100%"}} />;
}

// ─── Forms ───
function VenueForm({ venue, onSave, onCancel }) {
  const [f,setF] = useState({name:venue?.name||"",formerNames:venue?.formerNames?.join(", ")||"",address:venue?.address||"",lat:venue?.lat?.toString()||"",lng:venue?.lng?.toString()||"",closed:venue?.closed||false});
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <Field label="Venue name *" value={f.name} onChange={v=>set("name",v)} placeholder="e.g. Paradiso" />
      <Field label="Former name(s)" value={f.formerNames} onChange={v=>set("formerNames",v)} placeholder="Comma-separated" />
      <Field label="Address" value={f.address} onChange={v=>set("address",v)} placeholder="Full address" />
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:"10px"}}>
        <Field label="Latitude" value={f.lat} onChange={v=>set("lat",v)} placeholder="55.7558" type="number" />
        <Field label="Longitude" value={f.lng} onChange={v=>set("lng",v)} placeholder="37.6173" type="number" />
      </div>
      <label style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"12px",color:"var(--text-secondary)",cursor:"pointer"}}>
        <input type="checkbox" checked={f.closed} onChange={e=>set("closed",e.target.checked)} style={{accentColor:"var(--accent)"}} />
        Venue is permanently closed
      </label>
      <div style={{display:"flex",gap:"8px"}}>
        <Btn primary onClick={()=>{if(!f.name.trim())return;onSave({id:venue?.id||genId(),name:f.name.trim(),formerNames:f.formerNames.split(",").map(s=>s.trim()).filter(Boolean),address:f.address.trim(),lat:parseFloat(f.lat)||0,lng:parseFloat(f.lng)||0,closed:f.closed})}}>{venue?"Update":"Add venue"}</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function EventForm({ event, venues, onSave, onCancel }) {
  const [f,setF] = useState({type:event?.type||"gig",venueId:event?.venueId||"",dates:event?.dates?.join(", ")||"",artists:event?.artists?.join(", ")||"",sfm:event?.setlistFmUrl||"",lfm:event?.lastFmUrl||"",notes:event?.notes||"",festivalName:event?.festivalName||"",imageUrl:event?.imageUrl||"",tags:event?.tags?.join(", ")||""});
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <div><label style={lbl}>Type</label><div style={{display:"flex",gap:"6px"}}>
        {["gig","festival"].map(t => <Pill key={t} active={f.type===t} onClick={()=>set("type",t)}>{t==="gig"?"🎸 Gig":"🎪 Festival"}</Pill>)}
      </div></div>
      {f.type === "festival" && <Field label="Festival name" value={f.festivalName} onChange={v=>set("festivalName",v)} placeholder="e.g. Пикник Афиши, Park Live, Flow Festival" />}
      <div><label style={lbl}>Venue *</label>
        <select style={inp} value={f.venueId} onChange={e=>set("venueId",e.target.value)}>
          <option value="">Select…</option>
          {[...venues].sort((a,b)=>a.name.localeCompare(b.name)).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <Field label="Date(s) *" value={f.dates} onChange={v=>set("dates",v)} placeholder="2024-03-15 or 2024-08-16, 2024-08-17" />
      <Field label="Artists *" value={f.artists} onChange={v=>set("artists",v)} placeholder="Radiohead, The Smile" />
      <Field label="Tags" value={f.tags} onChange={v=>set("tags",v)} placeholder="rock, post-punk, electronic (comma-separated)" />
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:"10px"}}>
        <Field label="setlist.fm" value={f.sfm} onChange={v=>set("sfm",v)} placeholder="https://setlist.fm/…" />
        <Field label="last.fm" value={f.lfm} onChange={v=>set("lfm",v)} placeholder="https://last.fm/…" />
      </div>
      <Field label="Image URL" value={f.imageUrl} onChange={v=>set("imageUrl",v)} placeholder="https://example.com/photo.jpg" />
      <div><label style={lbl}>Notes / comments</label>
        <textarea style={{...inp,minHeight:"60px",resize:"vertical",fontFamily:"inherit"}} value={f.notes} onChange={e=>set("notes",e.target.value)} placeholder="Personal notes about this event…" />
      </div>
      <div style={{display:"flex",gap:"8px"}}>
        <Btn primary onClick={()=>{if(!f.venueId||!f.dates.trim()||!f.artists.trim())return;onSave({id:event?.id||genId(),type:f.type,venueId:f.venueId,dates:f.dates.split(",").map(s=>s.trim()).filter(Boolean),artists:f.artists.split(",").map(s=>s.trim()).filter(Boolean),setlistFmUrl:f.sfm.trim(),lastFmUrl:f.lfm.trim(),notes:f.notes.trim(),festivalName:f.festivalName.trim(),imageUrl:f.imageUrl.trim(),tags:f.tags.split(",").map(s=>s.trim()).filter(Boolean)})}}>{event?"Update":"Add event"}</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ─── Merge Venues ───
function MergeVenues({ venues, events, onMerge }) {
  const [target,setTarget] = useState("");
  const [sources,setSources] = useState(new Set());
  const [venueSearch,setVenueSearch] = useState("");
  const [confirmed,setConfirmed] = useState(false);
  const counts = useMemo(()=>{const c={};events.forEach(e=>{c[e.venueId]=(c[e.venueId]||0)+1});return c},[events]);
  const sortedV = useMemo(()=>{let l=[...venues].sort((a,b)=>a.name.localeCompare(b.name));if(venueSearch){const q=venueSearch.toLowerCase();l=l.filter(v=>v.name.toLowerCase().includes(q)||v.address.toLowerCase().includes(q))}return l},[venues,venueSearch]);
  const suggestions = useMemo(()=>{
    const groups=[],used=new Set(),vl=[...venues].sort((a,b)=>a.name.localeCompare(b.name));
    for(let i=0;i<vl.length;i++){if(used.has(vl[i].id))continue;const sim=[];const nA=vl[i].name.toLowerCase().replace(/[^a-zа-яё0-9]/gi,"");
    for(let j=i+1;j<vl.length;j++){if(used.has(vl[j].id))continue;const nB=vl[j].name.toLowerCase().replace(/[^a-zа-яё0-9]/gi,"");
    if(nA===nB||nA.includes(nB)||nB.includes(nA)||(nA.length>4&&nB.length>4&&lev(nA,nB)<=3))sim.push(vl[j])}
    if(sim.length>0){groups.push({primary:vl[i],duplicates:sim});used.add(vl[i].id);sim.forEach(s=>used.add(s.id))}}return groups},[venues]);
  const tv=venues.find(v=>v.id===target),sv=venues.filter(v=>sources.has(v.id)),totalAff=sv.reduce((s,v)=>s+(counts[v.id]||0),0);
  const applySuggestion=(g)=>{const all=[g.primary,...g.duplicates].sort((a,b)=>{const ca=counts[a.id]||0,cb=counts[b.id]||0;if(cb!==ca)return cb-ca;if(b.lat&&!a.lat)return 1;if(a.lat&&!b.lat)return -1;return 0});setTarget(all[0].id);setSources(new Set(all.slice(1).map(v=>v.id)));setConfirmed(false)};
  const toggleSource=(id)=>{setSources(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n});setConfirmed(false)};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
      {suggestions.length>0&&<div>
        <h4 style={{margin:"0 0 10px",fontSize:"13px",fontWeight:600,color:"var(--text-primary)"}}>Potential duplicates</h4>
        <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
          {suggestions.map((g,i)=><div key={i} style={{background:"var(--accent-dim)",border:"1px solid var(--border)",borderRadius:"10px",padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
            <div style={{fontSize:"12px",color:"var(--text-primary)"}}>
              <span style={{fontWeight:600}}>{g.primary.name}</span><span style={{opacity:.5}}> ({counts[g.primary.id]||0})</span>
              <span style={{margin:"0 6px",opacity:.3}}>↔</span>
              {g.duplicates.map((d,j)=><span key={j}>{j>0&&", "}<span style={{fontWeight:500}}>{d.name}</span><span style={{opacity:.5}}> ({counts[d.id]||0})</span></span>)}
            </div>
            <Btn onClick={()=>applySuggestion(g)} style={{padding:"4px 12px",fontSize:"10px",whiteSpace:"nowrap"}}>Select</Btn>
          </div>)}
        </div>
      </div>}
      <div>
        <h4 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:600,color:"var(--text-primary)"}}>Target venue (keep)</h4>
        <select style={inp} value={target} onChange={e=>{setTarget(e.target.value);setSources(p=>{const n=new Set(p);n.delete(e.target.value);return n});setConfirmed(false)}}>
          <option value="">Choose…</option>
          {sortedV.map(v=><option key={v.id} value={v.id}>{v.name} ({counts[v.id]||0} events){v.lat?"":" — no coords"}</option>)}
        </select>
      </div>
      {target&&<div>
        <h4 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:600,color:"var(--text-primary)"}}>Merge into "{tv?.name}"</h4>
        <input style={{...inp,fontSize:"12px",marginBottom:"8px"}} placeholder="Filter…" value={venueSearch} onChange={e=>setVenueSearch(e.target.value)} />
        <div style={{maxHeight:"240px",overflow:"auto",border:"1px solid var(--border)",borderRadius:"10px"}}>
          {sortedV.filter(v=>v.id!==target).map(v=>{const sel=sources.has(v.id);return(
            <div key={v.id} onClick={()=>toggleSource(v.id)} style={{padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:"10px",borderBottom:"1px solid var(--border)",background:sel?"var(--accent-dim)":"transparent"}}>
              <div style={{width:"16px",height:"16px",borderRadius:"3px",border:sel?"2px solid var(--accent)":"2px solid var(--border-hover)",background:sel?"var(--accent)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {sel&&<span style={{color:"#fff",fontSize:"10px",fontWeight:700}}>✓</span>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:"12px",fontWeight:500,color:"var(--text-primary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.name}</div>
                <div style={{fontSize:"10px",color:"var(--text-secondary)"}}>{v.address||"No address"} · {counts[v.id]||0} events</div>
              </div>
            </div>)})}
        </div>
      </div>}
      {target&&sources.size>0&&<div style={{background:"var(--accent-dim)",border:"1px solid var(--accent)",borderRadius:"10px",padding:"14px 16px"}}>
        <div style={{fontSize:"12px",color:"var(--text-primary)",lineHeight:1.6}}>
          <div>Keep: <strong>{tv?.name}</strong> ({counts[target]||0} events)</div>
          <div>Merge: {sv.map(v=><span key={v.id} style={{display:"inline-block",background:"var(--bg-surface)",padding:"1px 7px",borderRadius:"4px",margin:"2px 3px 2px 0",fontSize:"11px",fontWeight:500}}>{v.name} ({counts[v.id]||0})</span>)}</div>
          <div style={{marginTop:"4px"}}>{totalAff} events reassigned. Source names become former names.</div>
        </div>
        <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
          {!confirmed?<Btn primary onClick={()=>setConfirmed(true)}>Confirm merge</Btn>:<Btn primary onClick={()=>{onMerge(target,[...sources]);setTarget("");setSources(new Set());setConfirmed(false)}} style={{background:"#A32D2D"}}>Merge now</Btn>}
          <Btn onClick={()=>{setSources(new Set());setConfirmed(false)}}>Cancel</Btn>
        </div>
      </div>}
    </div>
  );
}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;const d=Array.from({length:m+1},(_,i)=>i);for(let j=1;j<=n;j++){let p=d[0];d[0]=j;for(let i=1;i<=m;i++){const t=d[i];d[i]=a[i-1]===b[j-1]?p:1+Math.min(p,d[i],d[i-1]);p=t}}return d[m]}

// ─── UI primitives ───
const lbl = {display:"block",fontSize:"10px",fontWeight:600,color:"var(--text-secondary)",marginBottom:"4px",textTransform:"uppercase",letterSpacing:"0.5px"};
const inp = {width:"100%",padding:"9px 11px",fontSize:"13px",border:"1px solid var(--border)",borderRadius:"8px",background:"var(--bg-card)",color:"var(--text-primary)",outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
function Field({label,value,onChange,placeholder,type}){return<div><label style={lbl}>{label}</label><input style={inp} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} step={type==="number"?"any":undefined}/></div>}
function Btn({children,primary,onClick,style:sx}){return<button onClick={onClick} style={{padding:"9px 18px",fontSize:"12px",fontWeight:500,border:primary?"none":"1px solid var(--border)",borderRadius:"8px",cursor:"pointer",fontFamily:"inherit",background:primary?"var(--accent)":"transparent",color:primary?"#fff":"var(--text-secondary)",...sx}}>{children}</button>}
function Pill({children,active,onClick}){return<button onClick={onClick} style={{padding:"7px 14px",fontSize:"12px",fontWeight:500,border:"1px solid",borderColor:active?"var(--accent)":"var(--border)",borderRadius:"20px",cursor:"pointer",fontFamily:"inherit",background:active?"var(--accent)":"var(--bg-surface)",color:active?"#fff":"var(--text-secondary)"}}>{children}</button>}
const card = {background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:"12px",padding:"16px 18px"};

// ─── Main App ───
export default function App() {
  const [venues,setVenues] = useState([]);
  const [events,setEvents] = useState([]);
  const [loading,setLoading] = useState(true);
  const [dark,setDark] = useState(false);
  const [view,setView] = useState("stats");
  const [adminTab,setAdminTab] = useState("events");
  const [editVenue,setEditVenue] = useState(null);
  const [editEvent,setEditEvent] = useState(null);
  const [showForm,setShowForm] = useState(false);
  const [filterType,setFilterType] = useState("all");
  const [filterYear,setFilterYear] = useState("all");
  const [search,setSearch] = useState("");
  const [countryFilter,setCountryFilter] = useState("");
  const [expandedEvent,setExpandedEvent] = useState(null);
  const [timelineGroupBy,setTimelineGroupBy] = useState("date");
  const [detailPanel,setDetailPanel] = useState(null); // {type:"artist",name} or {type:"venue",id}
  const [adminMode,setAdminMode] = useState(false);

  // Admin access: ?admin in URL or Ctrl+Shift+A keyboard shortcut
  useEffect(()=>{
    if(typeof window!=="undefined"&&(window.location?.search?.includes("admin")||window.location?.hash?.includes("admin")))setAdminMode(true);
    const handler=(e)=>{if(e.ctrlKey&&e.shiftKey&&e.key==="A"){e.preventDefault();setAdminMode(p=>!p)}};
    document.addEventListener("keydown",handler);
    return()=>document.removeEventListener("keydown",handler);
  },[]);

  useEffect(()=>{(async()=>{
    try {
      const [v,e] = await Promise.all([api.fetchVenues(), api.fetchEvents()]);
      setVenues(v);setEvents(e);
    } catch(err) { console.error("Failed to load data:", err); }
    const savedTheme = localStorage.getItem('giglog-theme');
    if(savedTheme !== null) setDark(savedTheme === 'true');
    setLoading(false);
  })()},[]);

  useEffect(()=>{localStorage.setItem('giglog-theme', dark)},[dark]);

  const updV = useCallback(nv=>{setVenues(nv)},[]);
  const updE = useCallback(ne=>{setEvents(ne)},[]);
  const saveVenue=async(v)=>{
    try{
      if(venues.find(x=>x.id===v.id)){await api.updateVenue(v.id,v);updV(venues.map(x=>x.id===v.id?v:x))}
      else{const created=await api.createVenue(v);updV([...venues,created])}
    }catch(err){alert("Save failed: "+err.message);return}
    setEditVenue(null);setShowForm(false)};
  const saveEvent=async(e)=>{
    try{
      if(events.find(x=>x.id===e.id)){await api.updateEvent(e.id,e);updE(events.map(x=>x.id===e.id?e:x))}
      else{const created=await api.createEvent(e);updE([...events,created])}
    }catch(err){alert("Save failed: "+err.message);return}
    setEditEvent(null);setShowForm(false)};
  const mergeVenues=async(tid,sids)=>{
    try{
      const result=await api.mergeVenuesAPI(tid,sids);
      // Reload data after merge
      const [v,e]=await Promise.all([api.fetchVenues(),api.fetchEvents()]);
      setVenues(v);setEvents(e);
    }catch(err){alert("Merge failed: "+err.message)}
  };

  const years = useMemo(()=>{const ys=new Set();events.forEach(e=>e.dates.forEach(d=>ys.add(d.slice(0,4))));return[...ys].sort().reverse()},[events]);
  const filtered = useMemo(()=>{
    let f=[...events];
    if(filterType!=="all")f=f.filter(e=>e.type===filterType);
    if(filterYear!=="all")f=f.filter(e=>e.dates.some(d=>d.startsWith(filterYear)));
    if(countryFilter){f=f.filter(e=>{const v=venues.find(x=>x.id===e.venueId);return getCountry(v)===countryFilter})}
    if(search){const q=search.toLowerCase();f=f.filter(e=>{const v=venues.find(x=>x.id===e.venueId);return e.artists.some(a=>a.toLowerCase().includes(q))||v?.name.toLowerCase().includes(q)||e.dates.some(d=>d.includes(q))||(e.festivalName||"").toLowerCase().includes(q)||(e.notes||"").toLowerCase().includes(q)||(e.tags||[]).some(t=>t.toLowerCase().includes(q))})}
    return f.sort((a,b)=>b.dates[0].localeCompare(a.dates[0]));
  },[events,venues,filterType,filterYear,search,countryFilter]);

  // Group by festival
  const festivalGroups = useMemo(()=>{
    if(timelineGroupBy!=="festival")return null;
    const groups={};const ungrouped=[];
    filtered.forEach(e=>{if(e.festivalName){if(!groups[e.festivalName])groups[e.festivalName]=[];groups[e.festivalName].push(e)}else ungrouped.push(e)});
    return{groups:Object.entries(groups).sort((a,b)=>b[1][0].dates[0].localeCompare(a[1][0].dates[0])),ungrouped};
  },[filtered,timelineGroupBy]);

  const stats = useMemo(()=>{const ua=new Set();events.forEach(e=>e.artists.forEach(a=>ua.add(a)));return{total:events.length,gigs:events.filter(e=>e.type==="gig").length,fests:events.filter(e=>e.type==="festival").length,venues:venues.length,artists:ua.size}},[events,venues]);

  if(loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}><span style={{color:"var(--text-secondary)"}}>Loading…</span></div>;

  const EventRow = ({ev, compact = true}) => {
    const venue = venues.find(v=>v.id===ev.venueId);
    const expanded = expandedEvent === ev.id;
    const artistClick = (e, name) => { e.stopPropagation(); setDetailPanel({type:"artist",name}); };
    const venueClick = (e, v) => { e.stopPropagation(); setDetailPanel({type:"venue",id:v.id}); };
    const tagClick = (e, tag) => { e.stopPropagation(); setSearch(tag); setView("timeline"); setFilterType("all"); setFilterYear("all"); setCountryFilter(""); };
    return (
      <div onClick={()=>setExpandedEvent(expanded?null:ev.id)} style={{...card,padding:compact?"8px 14px":"16px 18px",cursor:"pointer",borderColor:expanded?"var(--accent)":"var(--border)",transition:"border-color .15s"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:"8px",flexWrap:"wrap"}}>
          <span style={{fontSize:"9px",fontWeight:700,textTransform:"uppercase",letterSpacing:".8px",padding:"2px 6px",borderRadius:"3px",background:ev.type==="festival"?"#3a2218":"#1a2e22",color:ev.type==="festival"?"#E8693B":"#4aba6a",flexShrink:0}}>{ev.type==="festival"?"FEST":"GIG"}</span>
          <span style={{fontSize:"11px",color:"var(--text-tertiary)",flexShrink:0}}>{fmtRangeShort(ev.dates)}</span>
          <span style={{fontSize:"13px",fontWeight:500,color:"var(--text-primary)",flex:"1 1 200px",minWidth:0,lineHeight:1.4}}>
            {ev.festivalName ? <span style={{color:"var(--accent)"}}>{ev.festivalName}: </span> : ""}
            {ev.artists.slice(0,4).map((a,i)=><span key={i}>{i>0?", ":""}<span onClick={e=>artistClick(e,a)} style={{cursor:"pointer",borderBottom:"1px dotted var(--text-tertiary)"}} onMouseEnter={e=>e.target.style.color="var(--accent)"} onMouseLeave={e=>e.target.style.color="inherit"}>{a}</span></span>)}{ev.artists.length>4?"…":""}
          </span>
          <span style={{display:"flex",alignItems:"center",gap:"4px",flexShrink:0}}>
            <span onClick={venue?e=>venueClick(e,venue):undefined} style={{fontSize:"11px",color:"var(--text-tertiary)",cursor:venue?"pointer":"default",borderBottom:venue?"1px dotted var(--text-tertiary)":"none"}}>{venue?.name}{venue?.closed?" 🚫":""}</span>
            {ev.tags?.length>0&&<span style={{fontSize:"9px",color:"var(--text-tertiary)"}}>🏷</span>}
            {(ev.setlistFmUrl||ev.lastFmUrl)&&<span style={{fontSize:"10px",color:"var(--text-tertiary)"}}>🔗</span>}
          </span>
        </div>
        {expanded && <div style={{marginTop:"10px",paddingTop:"10px",borderTop:"1px solid var(--border)"}}>
          {ev.imageUrl&&<div style={{marginBottom:"10px"}}><img src={ev.imageUrl} alt="" style={{maxWidth:"100%",maxHeight:"240px",borderRadius:"8px",objectFit:"cover"}} onError={e=>{e.target.style.display="none"}} /></div>}
          <div style={{fontSize:"12px",color:"var(--text-secondary)",lineHeight:1.6}}>
            <div><strong>Artists:</strong> {ev.artists.map((a,i)=><span key={i}>{i>0?", ":""}<span onClick={e=>artistClick(e,a)} style={{cursor:"pointer",color:"var(--text-primary)",borderBottom:"1px dotted var(--accent)"}} onMouseEnter={e=>e.target.style.color="var(--accent)"} onMouseLeave={e=>e.target.style.color="var(--text-primary)"}>{a}</span></span>)}</div>
            <div><strong>Venue:</strong> <span onClick={venue?e=>venueClick(e,venue):undefined} style={{cursor:venue?"pointer":"default",color:"var(--text-primary)",borderBottom:venue?"1px dotted var(--accent)":"none"}}>{venue?.name}</span>{venue?.closed?<span style={{color:"var(--accent)",fontSize:"10px",marginLeft:"6px"}}>CLOSED</span>:""}{venue?.address?`, ${venue.address}`:""}</div>
            <div><strong>Date:</strong> {fmtRange(ev.dates)}</div>
            {ev.festivalName&&<div><strong>Festival:</strong> {ev.festivalName}</div>}
            {ev.tags?.length>0&&<div style={{display:"flex",gap:"4px",flexWrap:"wrap",marginTop:"4px"}}>{ev.tags.map((t,i)=><span key={i} onClick={e=>tagClick(e,t)} style={{fontSize:"10px",padding:"2px 8px",borderRadius:"10px",background:"var(--bg-surface)",color:"var(--text-secondary)",cursor:"pointer",border:"1px solid var(--border)"}}>{t}</span>)}</div>}
            {ev.notes&&<div style={{marginTop:"6px",padding:"8px 10px",background:"var(--bg-surface)",borderRadius:"8px",fontStyle:"italic",color:"var(--text-primary)",fontSize:"12px"}}>{ev.notes}</div>}
            <div style={{display:"flex",gap:"6px",marginTop:"8px"}}>
              {ev.setlistFmUrl&&<a href={ev.setlistFmUrl} target="_blank" rel="noopener" onClick={e=>e.stopPropagation()} style={{padding:"3px 8px",fontSize:"10px",borderRadius:"4px",border:"1px solid var(--border)",color:"var(--text-secondary)",textDecoration:"none"}}>setlist.fm ↗</a>}
              {ev.lastFmUrl&&<a href={ev.lastFmUrl} target="_blank" rel="noopener" onClick={e=>e.stopPropagation()} style={{padding:"3px 8px",fontSize:"10px",borderRadius:"4px",border:"1px solid var(--border)",color:"var(--text-secondary)",textDecoration:"none"}}>last.fm ↗</a>}
            </div>
          </div>
        </div>}
      </div>
    );
  };

  return (
    <ThemeProvider dark={dark}>
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",color:"var(--text-primary)",background:"var(--bg-main)",transition:"background .2s, color .2s"}}>
      <header style={{padding:"16px clamp(12px, 4vw, 28px) 14px",borderBottom:"1px solid var(--border)",background:"var(--bg-card)"}}>
        <div style={{maxWidth:"1100px",margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"10px"}}>
          <div>
            <h1 style={{margin:0,fontSize:"24px",fontFamily:"'DM Serif Display',serif",fontWeight:400,letterSpacing:"-0.5px"}}>gig·log</h1>
            <p style={{margin:"1px 0 0",fontSize:"11px",color:"var(--text-secondary)"}}>{stats.total} events · {stats.artists} artists · {stats.venues} venues</p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <nav style={{display:"flex",gap:"2px",background:"var(--bg-surface)",borderRadius:"10px",padding:"3px"}}>
              {[["stats","Stats"],["timeline","Timeline"],["map","Map"],...(adminMode?[["admin","Admin"]]:[])].map(([k,l])=>(
                <button key={k} onClick={()=>setView(k)} style={{padding:"6px 14px",fontSize:"11px",fontWeight:500,border:"none",borderRadius:"7px",cursor:"pointer",fontFamily:"inherit",background:view===k?"var(--bg-card)":"transparent",color:view===k?"var(--text-primary)":"var(--text-secondary)",boxShadow:view===k?"0 1px 3px rgba(0,0,0,.08)":"none"}}>{l}</button>
              ))}
            </nav>
            <button onClick={()=>setDark(!dark)} style={{width:"32px",height:"32px",borderRadius:"8px",border:"1px solid var(--border)",background:"var(--bg-surface)",cursor:"pointer",fontSize:"14px",display:"flex",alignItems:"center",justifyContent:"center"}} title={dark?"Light mode":"Dark mode"}>{dark?"☀":"🌙"}</button>
          </div>
        </div>
      </header>

      <main style={{maxWidth:"1100px",margin:"0 auto",padding:"20px clamp(12px, 4vw, 28px)"}}>

        {view === "stats" && <StatsDashboard events={events} venues={venues}
          onSelectArtist={(name)=>{setSearch(name);setView("timeline");setFilterType("all");setFilterYear("all");setCountryFilter("")}}
          onSelectYear={(y)=>{setFilterYear(y);setView("timeline");setSearch("");setFilterType("all");setCountryFilter("")}}
          onSelectCountry={(country)=>{
            // Build a set of venue IDs that belong to this country/city
            const matchingVenueIds = new Set(venues.filter(v => getCountry(v) === country).map(v => v.id));
            // Use a special search prefix to trigger venue-ID-based filtering
            setCountryFilter(country);
            setView("timeline");setFilterType("all");setFilterYear("all");setSearch("");
          }}
          onSelectFestival={(name)=>{setSearch(name);setView("timeline");setFilterType("festival");setFilterYear("all");setTimelineGroupBy("festival");setCountryFilter("")}}
        />}

        {view === "timeline" && <div>
          <div style={{display:"flex",gap:"6px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
            <input style={{...inp,flex:"1 1 160px",maxWidth:"220px",fontSize:"11px",padding:"7px 10px"}} placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} />
            <select style={{...inp,width:"auto",fontSize:"11px",padding:"7px 10px"}} value={filterYear} onChange={e=>setFilterYear(e.target.value)}>
              <option value="all">All years</option>{years.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            {[["all","All"],["gig","Gigs"],["festival","Festivals"]].map(([k,l])=>(<Pill key={k} active={filterType===k} onClick={()=>setFilterType(k)}>{l}</Pill>))}
            {countryFilter&&<span onClick={()=>setCountryFilter("")} style={{fontSize:"11px",padding:"5px 12px",borderRadius:"14px",background:"var(--accent)",color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px"}}>📍 {countryFilter} <span style={{fontSize:"13px",lineHeight:1}}>×</span></span>}
            <div style={{marginLeft:"auto",display:"flex",gap:"4px",alignItems:"center"}}>
              <span style={{fontSize:"10px",color:"var(--text-tertiary)"}}>Group:</span>
              {[["date","By date"],["festival","By festival"]].map(([k,l])=>(
                <button key={k} onClick={()=>setTimelineGroupBy(k)} style={{padding:"4px 10px",fontSize:"10px",border:"1px solid var(--border)",borderRadius:"5px",cursor:"pointer",fontFamily:"inherit",background:timelineGroupBy===k?"var(--accent)":"transparent",color:timelineGroupBy===k?"#fff":"var(--text-secondary)"}}>{l}</button>
              ))}
            </div>
            <span style={{fontSize:"10px",color:"var(--text-tertiary)"}}>{filtered.length} events</span>
          </div>

          {timelineGroupBy === "date" && <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
            {filtered.length===0&&<div style={{textAlign:"center",padding:"40px",color:"var(--text-secondary)"}}>No events found</div>}
            {filtered.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>}

          {timelineGroupBy === "festival" && festivalGroups && <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            {festivalGroups.groups.map(([fname,evts])=>(
              <div key={fname}>
                <h3 style={{fontSize:"14px",fontWeight:600,margin:"0 0 6px",color:"var(--accent)",display:"flex",alignItems:"center",gap:"8px"}}>
                  🎪 {fname} <span style={{fontSize:"11px",fontWeight:400,color:"var(--text-tertiary)"}}>{evts.length} editions</span>
                </h3>
                <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                  {evts.sort((a,b)=>b.dates[0].localeCompare(a.dates[0])).map(ev=><EventRow key={ev.id} ev={ev} />)}
                </div>
              </div>
            ))}
            {festivalGroups.ungrouped.length>0&&<div>
              <h3 style={{fontSize:"14px",fontWeight:600,margin:"0 0 6px",color:"var(--text-secondary)"}}>🎸 Gigs & other events</h3>
              <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                {festivalGroups.ungrouped.sort((a,b)=>b.dates[0].localeCompare(a.dates[0])).map(ev=><EventRow key={ev.id} ev={ev} />)}
              </div>
            </div>}
          </div>}
        </div>}

        {view === "map" && <div>
          <div style={{height:"540px",borderRadius:"12px",overflow:"hidden",border:"1px solid var(--border)"}}>
            <MapView venues={venues} events={events}/>
          </div>
          <p style={{marginTop:"10px",fontSize:"10px",color:"var(--text-tertiary)"}}>{venues.filter(v=>v.lat).length}/{venues.length} venues on map. Click markers for details.</p>
        </div>}

        {view === "admin" && adminMode && <div>
          {/* Admin token */}
          <div style={{marginBottom:"12px",display:"flex",gap:"8px",alignItems:"center"}}>
            <label style={{fontSize:"11px",color:"var(--text-secondary)",whiteSpace:"nowrap"}}>Admin token:</label>
            <input type="password" style={{...inp,maxWidth:"200px",fontSize:"11px",padding:"6px 10px"}} placeholder="Enter admin token…"
              defaultValue={localStorage.getItem('giglog-admin-token')||''} onChange={e=>api.setAdminToken(e.target.value)} />
          </div>
          <div style={{display:"flex",gap:"4px",marginBottom:"16px",flexWrap:"wrap"}}>
            {[["events",`Events (${events.length})`],["venues",`Venues (${venues.length})`],["merge","Merge venues"]].map(([k,l])=>(
              <Btn key={k} primary={adminTab===k} onClick={()=>{setAdminTab(k);setShowForm(false);setEditVenue(null);setEditEvent(null)}} style={adminTab===k?{background:"var(--accent)",color:"#fff",border:"none"}:{}}>{l}</Btn>
            ))}
          </div>
          {adminTab!=="merge"&&!showForm&&<Btn primary onClick={()=>{setShowForm(true);setEditVenue(null);setEditEvent(null)}} style={{marginBottom:"16px"}}>+ Add {adminTab==="events"?"event":"venue"}</Btn>}
          {adminTab!=="merge"&&showForm&&<div style={{...card,marginBottom:"16px",borderColor:"var(--accent)"}}>
            <h3 style={{margin:"0 0 12px",fontSize:"14px",fontWeight:600}}>{adminTab==="events"?(editEvent?"Edit event":"New event"):(editVenue?"Edit venue":"New venue")}</h3>
            {adminTab==="events"?<EventForm key={editEvent?.id||"new"} event={editEvent} venues={venues} onSave={saveEvent} onCancel={()=>{setShowForm(false);setEditEvent(null)}} />:<VenueForm key={editVenue?.id||"new"} venue={editVenue} onSave={saveVenue} onCancel={()=>{setShowForm(false);setEditVenue(null)}} />}
          </div>}
          {adminTab==="merge"&&<div style={card}><MergeVenues venues={venues} events={events} onMerge={mergeVenues} /></div>}

          {adminTab==="events"&&<div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
            {[...events].sort((a,b)=>b.dates[0].localeCompare(a.dates[0])).map(ev=>{const venue=venues.find(v=>v.id===ev.venueId);return<div key={ev.id} style={{...card,padding:"8px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:"180px"}}>
                  <div style={{fontSize:"12px",fontWeight:500}}>{ev.type==="festival"?"🎪":"🎸"} {ev.festivalName?<span style={{color:"var(--accent)"}}>{ev.festivalName}: </span>:""}{ev.artists.slice(0,3).join(", ")}{ev.artists.length>3?"…":""}</div>
                  <div style={{fontSize:"10px",color:"var(--text-secondary)",marginTop:"1px"}}>{venue?.name} · {fmtRangeShort(ev.dates)}{ev.notes?` · 📝`:""}</div>
                </div>
                <div style={{display:"flex",gap:"4px"}}>
                  <Btn onClick={()=>{setEditEvent(ev);setShowForm(true)}} style={{padding:"3px 10px",fontSize:"10px"}}>Edit</Btn>
                  <Btn onClick={()=>(async()=>{try{await api.deleteEvent(ev.id);updE(events.filter(e=>e.id!==ev.id))}catch(err){alert('Delete failed: '+err.message)}})()} style={{padding:"3px 10px",fontSize:"10px",color:"#c44",borderColor:"#c44"}}>Del</Btn>
                </div>
              </div>
            </div>})}
          </div>}

          {adminTab==="venues"&&<div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
            {[...venues].sort((a,b)=>a.name.localeCompare(b.name)).map(venue=>{const ct=events.filter(e=>e.venueId===venue.id).length;return<div key={venue.id} style={{...card,padding:"8px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:"180px"}}>
                  <div style={{fontSize:"12px",fontWeight:500}}>{venue.name}{venue.closed?<span style={{fontSize:"9px",color:"#c44",marginLeft:"6px",fontWeight:600}}>CLOSED</span>:""}{venue.formerNames?.length?<span style={{fontSize:"10px",fontWeight:400,opacity:.5}}> (fka {venue.formerNames.join(", ")})</span>:""}</div>
                  <div style={{fontSize:"10px",color:"var(--text-secondary)",marginTop:"1px"}}>{venue.address||"No address"} · {ct} events{venue.lat?"":" · No coords"}</div>
                </div>
                <div style={{display:"flex",gap:"4px"}}>
                  <Btn onClick={()=>{setEditVenue(venue);setShowForm(true)}} style={{padding:"3px 10px",fontSize:"10px"}}>Edit</Btn>
                  <Btn onClick={()=>{(async()=>{try{await api.deleteVenue(venue.id);updV(venues.filter(v=>v.id!==venue.id));updE(events.filter(e=>e.venueId!==venue.id))}catch(err){alert('Delete failed: '+err.message)}})()}} style={{padding:"3px 10px",fontSize:"10px",color:"#c44",borderColor:"#c44"}}>Del</Btn>
                </div>
              </div>
            </div>})}
          </div>}

          <div style={{marginTop:"24px",padding:"12px 16px",borderRadius:"10px",background:"var(--bg-surface)",fontSize:"10px",color:"var(--text-secondary)"}}>
            <strong style={{fontWeight:600,color:"var(--text-primary)"}}>Data management</strong>
            <p style={{margin:"4px 0 0"}}>{venues.length} venues, {events.length} events.</p>
            <div style={{display:"flex",gap:"6px",marginTop:"8px",flexWrap:"wrap"}}>
              <Btn onClick={async()=>{const [v,e]=await Promise.all([api.fetchVenues(),api.fetchEvents()]);setVenues(v);setEvents(e)}} style={{padding:"4px 10px",fontSize:"9px"}}>Reload from server</Btn>
              <Btn onClick={async()=>{try{const data=await api.exportJSON();const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="giglog-export.json";a.click();URL.revokeObjectURL(url)}catch(err){alert("Export failed: "+err.message)}}} style={{padding:"4px 10px",fontSize:"9px"}}>Export JSON</Btn>
              <Btn onClick={()=>{const a=document.createElement("a");a.href="/api/admin/export?format=csv";a.download="giglog-events.csv";const token=localStorage.getItem("giglog-admin-token")||"";if(token){fetch("/api/admin/export?format=csv",{headers:{"X-Admin-Token":token}}).then(r=>r.blob()).then(b=>{const url=URL.createObjectURL(b);a.href=url;a.click();URL.revokeObjectURL(url)}).catch(err=>alert("Export failed: "+err.message))}}} style={{padding:"4px 10px",fontSize:"9px"}}>Export CSV</Btn>
              <Btn onClick={()=>{const input=document.createElement("input");input.type="file";input.accept=".json";input.onchange=async(e)=>{const file=e.target.files[0];if(!file)return;try{const text=await file.text();const data=JSON.parse(text);if(!data.venues&&!data.events){alert("Invalid format: needs {venues, events}");return}if(!confirm(`Import ${data.venues?.length||0} venues and ${data.events?.length||0} events? Existing data will be updated.`))return;const result=await api.importData(data);alert(`Done! Venues: ${result.venues.upserted} upserted. Events: ${result.events.upserted} upserted.`);const [v,ev]=await Promise.all([api.fetchVenues(),api.fetchEvents()]);setVenues(v);setEvents(ev)}catch(err){alert("Import failed: "+err.message)}};input.click()}} style={{padding:"4px 10px",fontSize:"9px"}}>Import JSON</Btn>
            </div>
          </div>
        </div>}
      </main>

      {/* ─── Detail Panel (Artist / Venue) ─── */}
      {detailPanel && <div onClick={()=>setDetailPanel(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:1000,display:"flex",justifyContent:"flex-end"}}>
        <div onClick={e=>e.stopPropagation()} style={{width:"min(480px,90vw)",height:"100vh",background:"var(--bg-card)",borderLeft:"1px solid var(--border)",overflowY:"auto",padding:"24px"}}>
          <button onClick={()=>setDetailPanel(null)} style={{float:"right",background:"none",border:"none",fontSize:"20px",cursor:"pointer",color:"var(--text-tertiary)",padding:"4px"}}>✕</button>

          {detailPanel.type === "artist" && (() => {
            const name = detailPanel.name;
            const artistEvents = events.filter(e => e.artists.includes(name)).sort((a,b) => a.dates[0].localeCompare(b.dates[0]));
            const firstSeen = artistEvents[0];
            const lastSeen = artistEvents[artistEvents.length-1];
            const venueIds = [...new Set(artistEvents.map(e => e.venueId))];
            const festivalCount = artistEvents.filter(e => e.type === "festival").length;
            return <div>
              <h2 style={{margin:"0 0 4px",fontSize:"20px",fontWeight:600,color:"var(--text-primary)"}}>{name}</h2>
              <p style={{margin:"0 0 16px",fontSize:"12px",color:"var(--text-secondary)"}}>
                {artistEvents.length} event{artistEvents.length!==1?"s":""} · {venueIds.length} venue{venueIds.length!==1?"s":""}{festivalCount>0?` · ${festivalCount} festival${festivalCount!==1?"s":""}`:""}</p>
              <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap"}}>
                <div style={{background:"var(--bg-surface)",borderRadius:"8px",padding:"10px 14px",flex:"1 1 100px"}}><div style={{fontSize:"9px",fontWeight:600,textTransform:"uppercase",color:"var(--text-secondary)"}}>First seen</div><div style={{fontSize:"13px",fontWeight:500,color:"var(--text-primary)",marginTop:"2px"}}>{firstSeen?fmtDate(firstSeen.dates[0]):"—"}</div></div>
                <div style={{background:"var(--bg-surface)",borderRadius:"8px",padding:"10px 14px",flex:"1 1 100px"}}><div style={{fontSize:"9px",fontWeight:600,textTransform:"uppercase",color:"var(--text-secondary)"}}>Last seen</div><div style={{fontSize:"13px",fontWeight:500,color:"var(--text-primary)",marginTop:"2px"}}>{lastSeen?fmtDate(lastSeen.dates[lastSeen.dates.length-1]):"—"}</div></div>
              </div>
              <h3 style={{fontSize:"13px",fontWeight:600,margin:"0 0 8px",color:"var(--text-primary)"}}>All appearances</h3>
              <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                {[...artistEvents].reverse().map(ev => {
                  const v = venues.find(x => x.id === ev.venueId);
                  return <div key={ev.id} style={{padding:"8px 12px",background:"var(--bg-surface)",borderRadius:"8px",fontSize:"12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontWeight:500,color:"var(--text-primary)"}}>{fmtRangeShort(ev.dates)}</span>
                      <span style={{fontSize:"9px",fontWeight:700,textTransform:"uppercase",padding:"2px 6px",borderRadius:"3px",background:ev.type==="festival"?"#3a2218":"#1a2e22",color:ev.type==="festival"?"#E8693B":"#4aba6a"}}>{ev.type}</span>
                    </div>
                    <div style={{color:"var(--text-secondary)",marginTop:"2px"}}>{v?.name}{v?.closed?" 🚫":""}{ev.festivalName?` (${ev.festivalName})`:""}</div>
                    {ev.artists.length > 1 && <div style={{color:"var(--text-tertiary)",marginTop:"2px",fontSize:"11px"}}>with {ev.artists.filter(a=>a!==name).slice(0,5).join(", ")}{ev.artists.length>6?"…":""}</div>}
                  </div>;
                })}
              </div>
              <div style={{marginTop:"14px"}}><Btn onClick={()=>{setSearch(name);setView("timeline");setFilterType("all");setFilterYear("all");setCountryFilter("");setDetailPanel(null)}} style={{fontSize:"11px",padding:"6px 14px"}}>View on timeline →</Btn></div>
            </div>;
          })()}

          {detailPanel.type === "venue" && (() => {
            const venue = venues.find(v => v.id === detailPanel.id);
            if (!venue) return <div>Venue not found</div>;
            const venueEvents = events.filter(e => e.venueId === venue.id).sort((a,b) => a.dates[0].localeCompare(b.dates[0]));
            const allArtists = {};
            venueEvents.forEach(e => e.artists.forEach(a => { allArtists[a] = (allArtists[a]||0)+1; }));
            const topArtists = Object.entries(allArtists).sort((a,b) => b[1]-a[1]).slice(0,10);
            return <div>
              <h2 style={{margin:"0 0 2px",fontSize:"20px",fontWeight:600,color:"var(--text-primary)"}}>{venue.name}{venue.closed?<span style={{fontSize:"12px",color:"var(--accent)",marginLeft:"8px"}}>CLOSED</span>:""}</h2>
              {venue.formerNames?.length>0&&<div style={{fontSize:"11px",color:"var(--text-tertiary)",marginBottom:"4px"}}>Formerly: {venue.formerNames.join(", ")}</div>}
              {venue.address&&<div style={{fontSize:"12px",color:"var(--text-secondary)",marginBottom:"16px"}}>{venue.address}</div>}
              <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap"}}>
                <div style={{background:"var(--bg-surface)",borderRadius:"8px",padding:"10px 14px",flex:"1 1 100px"}}><div style={{fontSize:"9px",fontWeight:600,textTransform:"uppercase",color:"var(--text-secondary)"}}>Events</div><div style={{fontSize:"18px",fontWeight:600,color:"var(--text-primary)",marginTop:"2px"}}>{venueEvents.length}</div></div>
                <div style={{background:"var(--bg-surface)",borderRadius:"8px",padding:"10px 14px",flex:"1 1 100px"}}><div style={{fontSize:"9px",fontWeight:600,textTransform:"uppercase",color:"var(--text-secondary)"}}>Artists</div><div style={{fontSize:"18px",fontWeight:600,color:"var(--text-primary)",marginTop:"2px"}}>{Object.keys(allArtists).length}</div></div>
                <div style={{background:"var(--bg-surface)",borderRadius:"8px",padding:"10px 14px",flex:"1 1 100px"}}><div style={{fontSize:"9px",fontWeight:600,textTransform:"uppercase",color:"var(--text-secondary)"}}>First visit</div><div style={{fontSize:"13px",fontWeight:500,color:"var(--text-primary)",marginTop:"2px"}}>{venueEvents[0]?fmtDate(venueEvents[0].dates[0]):"—"}</div></div>
              </div>
              {venue.lat!==0&&<div style={{height:"180px",borderRadius:"10px",overflow:"hidden",marginBottom:"16px",border:"1px solid var(--border)"}}><VenueMiniMap lat={venue.lat} lng={venue.lng} name={venue.name} /></div>}
              {topArtists.length>0&&<div style={{marginBottom:"16px"}}><h3 style={{fontSize:"13px",fontWeight:600,margin:"0 0 8px",color:"var(--text-primary)"}}>Top artists here</h3>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>{topArtists.map(([name,count])=><span key={name} onClick={()=>setDetailPanel({type:"artist",name})} style={{fontSize:"11px",padding:"3px 10px",borderRadius:"12px",background:"var(--bg-surface)",color:"var(--text-secondary)",cursor:"pointer",border:"1px solid var(--border)"}}>{name} ({count})</span>)}</div>
              </div>}
              <h3 style={{fontSize:"13px",fontWeight:600,margin:"0 0 8px",color:"var(--text-primary)"}}>All events</h3>
              <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                {[...venueEvents].reverse().map(ev => (
                  <div key={ev.id} style={{padding:"8px 12px",background:"var(--bg-surface)",borderRadius:"8px",fontSize:"12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontWeight:500,color:"var(--text-primary)"}}>{fmtRangeShort(ev.dates)}</span>
                      <span style={{fontSize:"9px",fontWeight:700,textTransform:"uppercase",padding:"2px 6px",borderRadius:"3px",background:ev.type==="festival"?"#3a2218":"#1a2e22",color:ev.type==="festival"?"#E8693B":"#4aba6a"}}>{ev.type}</span>
                    </div>
                    <div style={{color:"var(--text-secondary)",marginTop:"2px"}}>{ev.festivalName?<span style={{color:"var(--accent)"}}>{ev.festivalName}: </span>:""}{ev.artists.slice(0,4).join(", ")}{ev.artists.length>4?"…":""}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:"14px"}}><Btn onClick={()=>{setSearch(venue.name);setView("timeline");setFilterType("all");setFilterYear("all");setCountryFilter("");setDetailPanel(null)}} style={{fontSize:"11px",padding:"6px 14px"}}>View on timeline →</Btn></div>
            </div>;
          })()}
        </div>
      </div>}
    </div>
    </ThemeProvider>
  );
}

'use strict';
/* Web GIS hanya memuat, menata gaya, dan menampilkan hasil analisis QGIS.
   Tidak ada buffering, overlay, NNA, atau network analysis di browser. */

const BINJAI_CENTER = [3.60022639, 98.48921976];

const CONFIG = {
  map: { center: BINJAI_CENTER, zoom: 12, buildingMinZoom: 14 },
  // Isi dengan API key gratis dari https://carto.com/basemaps/apikey/ agar basemap
  // CartoDB Dark Matter tampil tanpa watermark "API KEY REQUIRED" (lihat README).
  cartoApiKey: "",
  data: {
    boundary: "./data/batas_kecamatan_binjai.geojson",
    hospitals: "./data/rumah_sakit_binjai.geojson",
    roads: "./data/jalan_binjai.geojson",
    rivers: "./data/sungai_binjai.geojson",
    buildings: "./data/building_binjai.geojson",
    buffer01: "./data/buffer_0_1km.geojson",
    buffer12: "./data/buffer_1_2km.geojson",
    buffer23: "./data/buffer_2_3km.geojson"
  },
  research: {
    nna: { observedMeanDistance: 1058.43419295521, expectedMeanDistance: 708.25741346653, nearestNeighborRatio: 1.49442021055, zScore: 2.99107358921, pattern: "Menyebar" },
    buildings: {
      total: null, accessible: null, inaccessible: null,
      accessiblePercentage: null, inaccessiblePercentage: null,
      zones: { "0-1 km": null, ">1-2 km": null, ">2-3 km": null, ">3 km": null }
    }
  }
};

const ZONES = {
  "0-1 km":  { label: "0–1 km",  color: "#2e7d32" },
  ">1-2 km": { label: ">1–2 km", color: "#f9a825" },
  ">2-3 km": { label: ">2–3 km", color: "#ef6c00" },
  ">3 km":   { label: ">3 km (tidak terjangkau)", color: "#c62828" }
};

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const BASEMAPS = {
  // Layanan resmi Esri, gratis untuk penggunaan wajar tanpa API key. Attribution wajib tetap tampil.
  satellite: () => L.tileLayer(ESRI_IMAGERY, { maxZoom: 19, attribution: 'Tiles © Esri — Earthstar Geographics' }),
  openStreetMap: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
  // CARTO mewajibkan API key gratis sejak 2026 (lihat README poin 14). Tanpa key, tile tetap tampil
  // tetapi diberi watermark "API KEY REQUIRED" oleh CARTO sendiri.
  cartoDarkMatter: () => {
    const k = CONFIG.cartoApiKey; 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=cb1_425i_1_0bdb48977817b3ea3331d0b3'
    const q = k ? `?key= ${encodeURIComponent(k)}` : '';
    return L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=cb1_425i_1_0bdb48977817b3ea3331d0b3${q}`, { maxZoom: 20, attribution: '© OpenStreetMap contributors © CARTO' });
  }
};

/* ---------- Helper ---------- */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const NA = 'Belum tersedia';
const num = (v, d = 2) => v == null || v === '' ? NA : (typeof v === 'number' ? v.toLocaleString('id-ID', { maximumFractionDigits: d }) : String(v));
const pct = v => v == null ? NA : v.toLocaleString('id-ID', { maximumFractionDigits: 2 }) + '%';
const setAll = (attr, key, txt) => document.querySelectorAll(`[${attr}="${key}"]`).forEach(e => e.textContent = txt);
function notify(msg, type = 'err') {
  const d = document.createElement('div'); d.textContent = msg; if (type === 'info') d.className = 'info';
  $('toast').appendChild(d); setTimeout(() => d.remove(), 9000);
}
async function loadJSON(key, name) {
  try {
    const r = await fetch(CONFIG.data[key]);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.features)) throw new Error('Struktur GeoJSON tidak valid');
    return j;
  } catch (e) {
    console.error(`Gagal memuat ${name}:`, e);
    notify(`Layer ${name} gagal dimuat. Periksa nama file atau struktur GeoJSON.`);
    return null;
  }
}

/* ---------- Popup ---------- */
function hospitalPopup(p) {
  const g = k => esc(p[k] ?? NA);
  const link = (t, u) => { const s = safeUrl(u); return s ? `<a class="lnk" href="${esc(s)}" target="_blank" rel="noopener noreferrer">${t}</a>` : ''; };
  return `<div class="pop"><h3>${g('Nama')}</h3>
    <p><b>Kecamatan:</b><br>${g('Kecamatan')}</p><p><b>Alamat:</b><br>${g('Alamat')}</p>
    <p><b>Jenis RS:</b><br>${g('Jenis RS')}</p><p><b>Kelas RS:</b><br>${g('Kelas RS')}</p>
    <p><b>Kepemilikan:</b><br>${g('Kepemilikan')}</p>
    <p><b>Koordinat:</b><br>Y: ${g('Y')}<br>X: ${g('X')}</p>
    ${link('Profil Rumah Sakit', p['Link Profi'])}${link('Buka Google Maps', p['Link Gmaps'])}</div>`;
}
function buildingPopup(p) {
  const z = ZONES[p['Zona_Akses']];
  return `<div class="pop"><h3>Building Footprint</h3><p><b>Confidence:</b> ${esc(num(p['Confidence']))}</p>
    <p><b>Luas:</b> ${esc(num(p['Luas(m2)']))} m²</p><p><b>Zona Keterjangkauan:</b> ${esc(z ? z.label : (p['Zona_Akses'] ?? NA))}</p></div>`;
}
function getBuildingStyle(feature) {
  const z = ZONES[feature.properties && feature.properties['Zona_Akses']];
  const c = z ? z.color : '#9e9e9e';
  return { pane: 'bld', color: c, weight: 0.5, fillColor: c, fillOpacity: 0.75 };
}

/* Kategori jaringan jalan & sungai dibaca dari feature.properties.Remark (data BIG apa adanya, tanpa mengarang kategori). */
const ROAD_STYLES = {
  'Jalan Arteri': { color: '#ff8f00', weight: 3 },
  'Jalan Lokal':  { color: '#ffffff', weight: 1.8 },
  'Jalan Lain':   { color: '#b0bec5', weight: 1 }
};
const RIVER_STYLES = {
  'Sungai':            { color: '#0288d1', weight: 3 },
  'Sungai Satu Garis': { color: '#4fc3f7', weight: 1.5, dashArray: '5 4' }
};
function getRoadStyle(feature) {
  const r = feature.properties && feature.properties.Remark;
  return { pane: 'rd', opacity: 0.85, ...(ROAD_STYLES[r] || ROAD_STYLES['Jalan Lain']) };
}
function getRiverStyle(feature) {
  const r = feature.properties && feature.properties.Remark;
  return { pane: 'riv', opacity: 0.9, ...(RIVER_STYLES[r] || RIVER_STYLES['Sungai']) };
}

/* ---------- Statistik (hanya membaca angka QGIS / menghitung atribut) ---------- */
let bData = null;
function resolveStats() {
  const c = CONFIG.research.buildings;
  let z = c.zones;
  const hasCfg = Object.values(z).every(v => v != null);
  if (!hasCfg) {
    if (!bData) return null;
    z = {}; Object.keys(ZONES).forEach(k => z[k] = 0);
    bData.features.forEach(f => { const k = f.properties && f.properties['Zona_Akses']; if (k in z) z[k]++; });
  }
  const sum = Object.values(z).reduce((a, b) => a + b, 0);
  const total = c.total ?? sum, inacc = c.inaccessible ?? z['>3 km'], acc = c.accessible ?? (total - inacc);
  return { z, total, acc, inacc,
    pa: c.accessiblePercentage ?? (total ? acc / total * 100 : null),
    pi: c.inaccessiblePercentage ?? (total ? inacc / total * 100 : null),
    src: hasCfg ? 'Sumber angka: hasil analisis QGIS (CONFIG.research.buildings).' : 'Sumber angka: rekapitulasi atribut Zona_Akses pada building_binjai.geojson (hasil klasifikasi QGIS).' };
}
let chart;
function renderStats() {
  const s = resolveStats();
  if (!s) return;
  setAll('data-s', 'total', num(s.total, 0)); setAll('data-s', 'acc', num(s.acc, 0)); setAll('data-s', 'inacc', num(s.inacc, 0));
  setAll('data-s', 'pa', pct(s.pa)); setAll('data-s', 'pi', pct(s.pi));
  $('statSrc').textContent = s.src;
  $('zoneBody').innerHTML = Object.keys(ZONES).map(k =>
    `<tr><td><i class="lgsw" style="display:inline-block;width:10px;height:10px;background:${ZONES[k].color};margin-right:6px"></i>${ZONES[k].label}</td><td>${num(s.z[k], 0)}</td><td>${s.total ? pct(s.z[k] / s.total * 100) : NA}</td></tr>`).join('');
  if (typeof Chart === 'undefined') return;
  const keys = Object.keys(ZONES);
  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'bar',
    data: { labels: keys.map(k => ZONES[k].label), datasets: [{ data: keys.map(k => s.z[k]), backgroundColor: keys.map(k => ZONES[k].color) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
      title: { display: true, text: 'Distribusi Building Berdasarkan Zona Keterjangkauan' },
      tooltip: { callbacks: { label: c => `${c.parsed.y.toLocaleString('id-ID')} building (${(c.parsed.y / s.total * 100).toFixed(2)}%)` } } },
      scales: { y: { beginAtZero: true } } }
  });
}
function renderNNA() {
  const n = CONFIG.research.nna;
  Object.keys(n).forEach(k => setAll('data-n', k, num(n[k], 4)));
}

/* ---------- Aplikasi ---------- */
(function main() {
  const map = L.map('map', { center: CONFIG.map.center, zoom: CONFIG.map.zoom, zoomControl: false, preferCanvas: true });
  const satellite = BASEMAPS.satellite().addTo(map);
  const baseLayers = { 'Esri World Imagery': satellite, 'OpenStreetMap': BASEMAPS.openStreetMap(), 'CartoDB Dark Matter': BASEMAPS.cartoDarkMatter() };

  ['buf', 'bld', 'riv', 'rd'].forEach((n, i) => { map.createPane(n).style.zIndex = 405 + i * 5; });

  /* Kontrol: kanan atas (zoom, reset, fullscreen, layer), kanan bawah (lokasi), kiri bawah (skala) */
  L.control.zoom({ position: 'topright' }).addTo(map);
  const ctl = (pos, html, title, fn) => {
    const C = L.Control.extend({ onAdd() {
      const b = L.DomUtil.create('a', 'leaflet-bar leaflet-control map-btn'); b.href = '#'; b.innerHTML = html; b.title = title; b.setAttribute('role', 'button'); b.setAttribute('aria-label', title);
      L.DomEvent.disableClickPropagation(b); L.DomEvent.on(b, 'click', e => { L.DomEvent.preventDefault(e); fn(); }); return b; } });
    return new C({ position: pos }).addTo(map);
  };
  ctl('topright', '⌂', 'Reset View', () => map.setView(BINJAI_CENTER, CONFIG.map.zoom));
  ctl('topright', '⛶', 'Layar penuh', () => { document.fullscreenElement ? document.exitFullscreen() : $('app').requestFullscreen && $('app').requestFullscreen(); });
  document.addEventListener('fullscreenchange', () => setTimeout(() => map.invalidateSize(), 200));

  /* Layer */
  const boundaryStyle = { color: '#ffd54f', weight: 2, fillColor: '#ffffff', fillOpacity: 0.03 };
  const boundary = L.geoJSON(null, { style: () => boundaryStyle, onEachFeature: (f, l) => {
    const p = f.properties || {};
    l.bindPopup(`<div class="pop"><h3>${esc(p['Nama Kecamatan'] ?? NA)}</h3><p><b>Luas (Ha):</b> ${esc(p['Luas(Ha)'] ?? NA)}</p></div>`);
    if (p['Nama Kecamatan']) l.bindTooltip(esc(p['Nama Kecamatan']), { permanent: true, direction: 'center', className: 'kec-label' });
    l.on({ mouseover: e => e.target.setStyle({ fillOpacity: 0.2, weight: 3 }), mouseout: e => e.target.setStyle(boundaryStyle) });
  } });

  const HOS = [];
  const hosIcon = L.divIcon({ className: '', html: '<div class="hos">+</div>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
  const hospitals = L.geoJSON(null, {
    pointToLayer: (f, ll) => L.marker(ll, { icon: hosIcon, title: (f.properties || {}).Nama }),
    onEachFeature: (f, l) => { const p = f.properties || {}; l.bindPopup(() => hospitalPopup(p), { maxWidth: 300 });
      HOS.push({ name: p.Nama ?? NA, kec: p.Kecamatan ?? '', text: `${p.Nama ?? ''} ${p.Kecamatan ?? ''} ${p.Alamat ?? ''}`.toLowerCase(), layer: l }); }
  });

  const roads = L.geoJSON(null, { style: getRoadStyle, onEachFeature: (f, l) => {
    l.bindTooltip(esc((f.properties || {}).Remark ?? NA), { sticky: true });
    l.on({ mouseover: e => e.target.setStyle({ weight: getRoadStyle(f).weight + 2.5 }), mouseout: e => e.target.setStyle(getRoadStyle(f)) });
  } });
  const rivers = L.geoJSON(null, { style: getRiverStyle, onEachFeature: (f, l) => {
    l.bindPopup(`<div class="pop"><h3>Sungai</h3><p>${esc((f.properties || {}).Remark ?? NA)}</p></div>`);
    l.on({ mouseover: e => e.target.setStyle({ weight: getRiverStyle(f).weight + 2 }), mouseout: e => e.target.setStyle(getRiverStyle(f)) });
  } });

  const bufLayer = (label, color) => {
    const st = { pane: 'buf', color, weight: 1, fillColor: color, fillOpacity: 0.22 };
    return L.geoJSON(null, { style: () => st, onEachFeature: (f, l) => {
      l.bindTooltip('Buffer ' + label, { sticky: true });
      l.on({ mouseover: e => e.target.setStyle({ fillOpacity: 0.4 }), mouseout: e => e.target.setStyle(st) }); } });
  };
  const buf01 = bufLayer('0–1 km', ZONES['0-1 km'].color), buf12 = bufLayer('>1–2 km', ZONES['>1-2 km'].color), buf23 = bufLayer('>2–3 km', ZONES['>2-3 km'].color);

  /* Building: satu layer, dirender hanya pada zoom >= buildingMinZoom, gaya berdasarkan Zona_Akses */
  const bWrap = L.layerGroup(); let bGeo = null;
  function syncB() {
    const wanted = map.hasLayer(bWrap), show = wanted && map.getZoom() >= CONFIG.map.buildingMinZoom;
    if (show && bData && !bGeo) bGeo = L.geoJSON(bData, { style: getBuildingStyle, onEachFeature: (f, l) => l.bindPopup(() => buildingPopup(f.properties || {})) });
    if (bGeo) show ? bWrap.addLayer(bGeo) : bWrap.removeLayer(bGeo);
    $('bHint').hidden = !(wanted && !show);
  }
  bWrap.on('add remove', syncB); map.on('zoomend', syncB);

  const overlays = {
    'Batas Administrasi': boundary, 'Rumah Sakit': hospitals, 'Jaringan Jalan': roads, 'Sungai': rivers,
    'Building Footprint': bWrap, 'Buffer 0–1 km': buf01, 'Buffer >1–2 km': buf12, 'Buffer >2–3 km': buf23
  };
  L.control.layers(baseLayers, overlays, { position: 'topright', collapsed: true }).addTo(map);
  boundary.addTo(map); hospitals.addTo(map);

  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  /* Legenda dinamis */
  const sw = (c, t) => `<div><i class="sw" style="background:${c}"></i>${t}</div>`;
  const ln = (c, t) => `<div><i class="sw ln" style="border-color:${c}"></i>${t}</div>`;
  const LEG = {
    'Batas Administrasi': ln('#ffd54f', 'Batas Administrasi'),
    'Rumah Sakit': '<div><i class="sw" style="background:#d32f2f;border-radius:50%"></i>Rumah Sakit</div>',
    'Jaringan Jalan': '<h4>Jaringan Jalan</h4>' + Object.entries(ROAD_STYLES).map(([k, v]) => ln(v.color, k)).join(''),
    'Sungai': '<h4>Sungai</h4>' + Object.entries(RIVER_STYLES).map(([k, v]) => ln(v.color, k)).join(''),
    'Building Footprint': '<h4>Building berdasarkan Zona Akses</h4>' + Object.keys(ZONES).map(k => sw(ZONES[k].color, ZONES[k].label)).join(''),
    'Buffer 0–1 km': sw(ZONES['0-1 km'].color + '55', 'Buffer 0–1 km'), 'Buffer >1–2 km': sw(ZONES['>1-2 km'].color + '55', 'Buffer >1–2 km'), 'Buffer >2–3 km': sw(ZONES['>2-3 km'].color + '55', 'Buffer >2–3 km')
  };
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => { const d = L.DomUtil.create('details', 'legend'); d.open = window.innerWidth > 768; L.DomEvent.disableClickPropagation(d); return d; };
  legend.addTo(map);
  function syncLegend() {
    legend.getContainer().innerHTML = '<summary>Legenda</summary>' + Object.keys(overlays).filter(k => map.hasLayer(overlays[k])).map(k => LEG[k]).join('');
  }

  /* Daftar layer di sidebar */
  const list = $('layerList');
  Object.keys(overlays).forEach(k => {
    const lb = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.k = k;
    cb.onchange = () => cb.checked ? map.addLayer(overlays[k]) : map.removeLayer(overlays[k]);
    lb.append(cb, ' ' + k); list.appendChild(lb);
  });
  function syncUI() {
    list.querySelectorAll('input').forEach(cb => cb.checked = map.hasLayer(overlays[cb.dataset.k]));
    syncLegend();
    map.getContainer().classList.toggle('hide-kec', map.getZoom() < 12);
  }
  map.on('overlayadd overlayremove zoomend', syncUI); syncUI();

  /* Search rumah sakit (data yang sudah dimuat; tanpa geocoding eksternal) */
  const S = L.Control.extend({ onAdd() {
    const d = L.DomUtil.create('div', 'search-box');
    d.innerHTML = '<input id="q" type="search" placeholder="Cari nama, kecamatan, atau alamat RS" aria-label="Cari rumah sakit" autocomplete="off"><ul id="qr"></ul>';
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; } });
  new S({ position: 'topleft' }).addTo(map);
  $('q').addEventListener('input', e => {
    const t = e.target.value.trim().toLowerCase(), ul = $('qr'); ul.innerHTML = ''; if (!t) return;
    const res = HOS.filter(h => h.text.includes(t)).slice(0, 8);
    if (!res.length) { ul.innerHTML = '<li class="none">Tidak ditemukan</li>'; return; }
    res.forEach(h => { const li = document.createElement('li'); li.textContent = h.name + (h.kec ? ' — ' + h.kec : '');
      li.onclick = () => { if (!map.hasLayer(hospitals)) hospitals.addTo(map); map.setView(h.layer.getLatLng(), 16); h.layer.openPopup(); ul.innerHTML = ''; $('q').value = h.name; };
      ul.appendChild(li); });
  });

  /* Geolokasi (tidak disimpan) */
  let me;
  ctl('bottomright', '◎', 'Lokasi Saya', () => map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true }));
  map.on('locationfound', e => {
    if (me) me.remove();
    me = L.layerGroup([L.circle(e.latlng, { radius: e.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.1 }),
      L.marker(e.latlng, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [14, 14] }) }).bindPopup(`Posisi Anda (akurasi ± ${Math.round(e.accuracy)} m)`)]).addTo(map);
  });
  map.on('locationerror', () => notify('Lokasi tidak dapat diakses. Periksa izin lokasi pada browser.'));

  /* Sidebar & navigasi */
  const mobile = () => window.innerWidth <= 768;
  if (mobile()) document.body.classList.add('sb-closed');
  const toggle = open => { document.body.classList.toggle('sb-closed', open === undefined ? undefined : !open); setTimeout(() => map.invalidateSize(), 300); };
  $('menuBtn').onclick = () => toggle();
  document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    if (a.hasAttribute('data-map')) { if (mobile()) toggle(false); return; }
    toggle(true); const t = document.querySelector(a.getAttribute('href'));
    setTimeout(() => t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }));

  renderNNA(); renderStats();

  /* Muat data (tidak memblokir aplikasi bila ada yang gagal) */
  const add = (key, name, layer, after) => loadJSON(key, name).then(d => { if (d) { layer.addData(d); after && after(d); } });
  add('boundary', 'batas administrasi', boundary);
  add('hospitals', 'rumah sakit', hospitals, d => setAll('data-s', 'hospitals', String(d.features.length)));
  add('roads', 'jaringan jalan', roads); add('rivers', 'sungai', rivers);
  add('buffer01', 'buffer 0–1 km', buf01); add('buffer12', 'buffer >1–2 km', buf12); add('buffer23', 'buffer >2–3 km', buf23);
  loadJSON('buildings', 'building footprint').then(d => { if (d) { bData = d; renderStats(); syncB(); } });
})();
// Tile layers (matches the reference site options)
const tileLayers = {
  cartodb: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors & © CARTO'
  }),
  street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri'
  }),
  subway_transport: L.tileLayer('https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey={apikey}', {
    attribution: '© OpenStreetMap contributors & © Thunderforest',
    apikey: '' // Optionally add a Thunderforest API key if you have one
  })
};

let map;
let plainMarkerLayer; // restaurants: 10px + label
let dotLayer;        // restaurants: 5px dots
let innPlainLayer;   // inns: 10px + label
let innDotLayer;     // inns: 5px dots
const DENSE_ZOOM_THRESHOLD = 12;
const HYST_N_ENTER = 1800; // enter dense when exceeding
const HYST_N_EXIT = 1400;  // exit dense when below
const DENSE_POINT_THRESHOLD = 1000; // fallback safeguard
let denseMode = false; // default to label mode when possible
let activeCategory = 'food';
let krcLayer;
let allPoints = [];      // restaurants
let innAllPoints = [];   // inns
let userLocationMarker = null;
let userAccuracyCircle = null;
let hasUserLocation = false;

const DEFAULT_CSV_PATH = 'restaurant.csv';
const KRC_CSV_PATH = 'krc.csv';
const INN_CSV_PATH = 'inn.csv';
// Density-based rendering; dot layer for dense view

// 색상을 더 어둡게 만드는 함수
function getDarkerColor(color) {
  // 간단한 색상 매핑
  const colorMap = {
    '#556B45': '#3F4F33', // 진한 녹색 -> 더 진한 녹색
    '#722F37': '#5A252A', // 와인색 -> 더 어두운 와인색
    '#d7263d': '#B01E30'  // 빨간색 -> 더 어두운 빨간색
  };
  return colorMap[color] || '#5D4037'; // 기본값: 어두운 브라운
}

function colorKeyFromColor(color) {
  const c = String(color).toLowerCase();
  if (c === '#556b45') return 'green';
  if (c === '#722f37') return 'wine';
  if (c === '#d7263d') return 'red';
  return 'green';
}

// 주소 정제 함수 - 네이버지도 검색에 최적화
function cleanAddress(address) {
  if (!address) return '';

  let cleaned = address.trim();

  // 불필요한 부분 제거
  cleaned = cleaned
    // 상세주소 제거 (몇층, 호수 등)
    .replace(/\s*\d+층.*$/, '')
    .replace(/\s*\d+호.*$/, '')
    .replace(/\s*\(.*?\)/g, '') // 괄호 안 내용 제거
    .replace(/\s*\[.*?\]/g, '') // 대괄호 안 내용 제거
    // 건물명이 너무 길면 제거 (20자 이상)
    .replace(/\s+.{20,}$/, '')
    // 연속된 공백 정리
    .replace(/\s+/g, ' ')
    .trim();

  // 시/도 + 구/군 + 동/읍/면 + 주요 도로명/건물명 정도만 남기기
  const parts = cleaned.split(' ');
  if (parts.length > 4) {
    // 앞의 4개 부분만 사용 (시/도, 구/군, 동, 상세주소 일부)
    cleaned = parts.slice(0, 4).join(' ');
  }

  return cleaned;
}

// 네이버지도 앱 연동 함수
function openNaverMap(address, name) {
  if (!address && !name) {
    alert('주소 정보가 없습니다.');
    return;
  }

  // 검색 정확도를 높이기 위해 식당이름과 주소를 함께 조합
  let query = '';

  if (name && address) {
    // 주소 정제: 상세주소 제거 및 핵심 주소만 추출
    const cleanedAddress = cleanAddress(address);
    // 둘 다 있는 경우: "식당이름 주소" 형태로 검색
    query = `${name} ${cleanedAddress}`;
  } else if (address) {
    // 주소만 있는 경우
    query = cleanAddress(address);
  } else {
    // 이름만 있는 경우
    query = name;
  }

  const encodedQuery = encodeURIComponent(query);

  // 디버깅용 콘솔 출력
  console.log('네이버지도 검색 쿼리:', query);
  console.log('원본 - 이름:', name, '주소:', address);

  // 모바일 기기 체크
  const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile) {
    // 모바일에서는 네이버지도 앱 스킴 사용
    const naverMapAppUrl = `nmap://search?query=${encodedQuery}`;
    const naverMapWebUrl = `https://map.naver.com/v5/search/${encodedQuery}`;

    // 앱 실행 시도
    window.location.href = naverMapAppUrl;

    // 앱이 설치되지 않은 경우를 대비해 웹 버전으로 fallback
    setTimeout(() => {
      window.open(naverMapWebUrl, '_blank');
    }, 1000);
  } else {
    // 데스크톱에서는 웹 버전 네이버지도 열기
    const naverMapWebUrl = `https://map.naver.com/v5/search/${encodedQuery}`;
    window.open(naverMapWebUrl, '_blank');
  }
}

// Basic helpers
function toNumber(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  // Handle numbers with commas (e.g., "127,1234")
  s = s.replace(/,/g, '');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeKey(k) {
  return String(k || '')
    .replace(/^\ufeff/, '') // strip BOM
    .trim()
    .toLowerCase();
}

function normalizeCoord(val) {
  if (!Number.isFinite(val)) return NaN;
  const a = Math.abs(val);
  if (a <= 180) return val;
  // Heuristic: microdegrees -> degrees (1e7)
  if (a > 1e6 && a < 2e9) {
    const d = val / 1e7;
    if (Math.abs(d) <= 180) return d;
  }
  // Fallback: try /1e6
  if (a > 1e5 && a < 2e9) {
    const d = val / 1e6;
    if (Math.abs(d) <= 180) return d;
  }
  return NaN;
}

function resolveLatLng(row) {
  // Build normalized index: lowercased key -> original key
  const idx = {};
  for (const k of Object.keys(row)) idx[normalizeKey(k)] = k;

  // Candidate key-pairs in preference order
  const pairs = [
    // Prefer decimal x/y if present
    { lat: ['y', 'y좌표'], lon: ['x', 'x좌표'] },
    // Korean labels
    { lat: ['위도'], lon: ['경도'] },
    // English labels
    { lat: ['lat'], lon: ['lon', 'lng', 'long'] },
    { lat: ['latitude'], lon: ['longitude'] }
  ];

  for (const p of pairs) {
    let latKey, lonKey;
    for (const s of p.lat) if (!latKey && idx[s]) latKey = idx[s];
    for (const s of p.lon) if (!lonKey && idx[s]) lonKey = idx[s];
    if (!latKey || !lonKey) continue;
    let lat = toNumber(row[latKey]);
    let lon = toNumber(row[lonKey]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Normalize into plausible degrees
    lat = normalizeCoord(lat);
    lon = normalizeCoord(lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return [lat, lon];
    }
  }
  return null;
}

function getField(row, candidates, fallback = '') {
  const idx = {};
  const keys = Object.keys(row);
  for (const k of keys) idx[normalizeKey(k)] = k;
  for (const c of candidates) {
    const key = idx[normalizeKey(c)] || c;
    if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  // Fuzzy includes for mojibake headers (e.g., '식당이�')
  const includes = candidates.filter(c => /[\u3131-\uD79D]/.test(c));
  if (includes.length) {
    for (const k of keys) {
      for (const needle of includes) {
        if (k.includes(needle)) {
          const v = row[k];
          if (v != null && String(v).trim() !== '') return String(v).trim();
        }
      }
    }
  }
  return fallback;
}

function createDivIcon(labelText, color, showThumb) {
  const safe = String(labelText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return L.divIcon({
    className: '',
    html: `
      <div class="marker-icon">
        <div class="tiny-dot" style="color:${color}"></div>
        ${showThumb ? '<div class="dot-badge">👍</div>' : ''}
      </div>
      ${safe ? `<div class="marker-label" style="color:${color}">${safe}</div>` : ''}
    `,
    iconSize: [10, 10],
    iconAnchor: [5, 5]
  });
}

function createKrcIcon(labelText) {
  const safe = String(labelText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const html = `
    <div class="marker-icon">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="#d7263d" aria-hidden="true">
        <path d="M12 2l2.9 6.2 6.8.6-5 4.4 1.5 6.7L12 16.9 5.8 20l1.5-6.7-5-4.4 6.8-.6L12 2z"/>
      </svg>
    </div>
    ${safe ? `<div class="marker-label krc-label">${safe}</div>` : ''}
  `;
  return L.divIcon({ className: '', html, iconSize: [10,10], iconAnchor: [5,5] });
}

function popupKrcHtml(name, address) {
  const safeName = String(name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeAddr = String(address || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  return `
    <div class="popup-card" style="padding:10px 14px; min-width:220px;">
      ${safeName ? `<div class="popup-title" style="margin-bottom:6px;">${safeName}</div>` : ''}
      ${safeAddr ? `
        <div class="popup-info-item" style="margin-bottom:10px;">
          <div class="popup-icon">📍</div>
          <div class="popup-text">${safeAddr}</div>
        </div>
      ` : ''}
      <div class="popup-actions">
        <button class="popup-action-btn secondary" onclick="openNaverMap('${safeAddr}', '${safeName}')">네이버지도</button>
      </div>
    </div>
  `;
}

function attachLabelOnAdd() { /* labels disabled for tiny markers */ }

function createClusterDotIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div class="small-dot" style="color:${color}"></div>`,
    iconSize: [5, 5],
    iconAnchor: [2.5, 2.5]
  });
}

function popupHtml(props, color, categoryLabel = '식당') {
  const name = props.name || '';
  const menu = props.menu || '';
  const address = props.address || '';
  const visits = props.visits || '';
  const markerColor = color || '#556B45';
  const darkerColor = getDarkerColor(markerColor);

  return `
    <div class="popup-container">
      <div class="popup-card">
        <button class="popup-close">×</button>

        <div class="popup-header">
          <div class="popup-title">${name || '이름 없음'}</div>
          ${menu ? `<div class="popup-subtitle">${menu}</div>` : ''}
          <span class="popup-category-badge">${categoryLabel}</span>
        </div>

        <div class="popup-divider"></div>

        <div class="popup-content">
          ${address ? `
            <div class="popup-info-item">
              <div class="popup-icon">●</div>
              <div class="popup-text">${address}</div>
            </div>
          ` : ''}

          

          ${visits !== '' ? `
            <div class="popup-info-item">
              <div class="popup-icon">★</div>
              <div class="popup-text">방문횟수: ${visits}회</div>
            </div>
          ` : ''}
        </div>

        <div class="popup-actions">
          <button class="popup-action-btn secondary" onclick="openNaverMap('${address}', '${name}')">네이버지도</button>
        </div>
      </div>
    </div>
  `;
}

function addPoint(lat, lon, props) {
  // Determine color by visit count
  const visitsRaw = props.visits;
  const visits = toNumber(visitsRaw);
  let color = '#556B45'; // default: more saturated/dark green
  if (Number.isFinite(visits)) {
    if (visits > 100) color = '#d7263d'; // red
    else if (visits > 10) color = '#722F37'; // wine color (was pink)
  }

  // Dense-mode marker: lightweight canvas circle (5px base, zoom-scaled)
  const mDot = L.circleMarker([lat, lon], {
    radius: 2.5,
    fillColor: color,
    fillOpacity: 1,
    stroke: false,
    interactive: false
  });
  if (!dotLayer) dotLayer = L.layerGroup();
  dotLayer.addLayer(mDot);

  // Save point; plain marker is created on-demand in sparse mode
  const label = props.name || '';
  const showThumb = Number.isFinite(visits) && visits > 100;
  allPoints.push({ lat, lon, props, color, label, showThumb, plainMarker: null, dotMarker: mDot });
}

// density toggle removed; clustering handles aggregation

function initTileButtons() {
  const grid = document.querySelector('.map-tile-control');
  if (!grid) return;
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.tile-btn');
    if (!btn) return;
    const type = btn.getAttribute('data-tile');
    if (!tileLayers[type]) return;
    // Update active
    document.querySelectorAll('.tile-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Swap layer
    currentTile.remove();
    currentTile = tileLayers[type];
    currentTile.addTo(map);
  });
}

let currentTile = null;

async function init() {
  map = L.map('map', { preferCanvas: true }).setView([36.5, 127.8], 7); // Center Korea
  currentTile = tileLayers.cartodb;
  currentTile.addTo(map);

  // Initialize layers for density switching (per-category)
  plainMarkerLayer = L.layerGroup();
  dotLayer = L.layerGroup();
  innPlainLayer = L.layerGroup();
  innDotLayer = L.layerGroup();
  krcLayer = L.layerGroup().addTo(map);

  initTileButtons();

  // 하단 내비게이션: 카테고리 선택 (맛집/숙박만 데이터 표시)
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (!btn) return;
      bottomNav.querySelectorAll('.nav-item').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      activeCategory = btn.getAttribute('data-cat') || 'food';
      updateClusterVisibility();
    });
  }

  // 하단 검색창: 행정구역(시/도, 시/군/구, 읍/면/동/리)만 검색 → 해당 영역으로 이동
  const searchForm = document.querySelector('.bottom-search .search-form');
  const searchInput = document.querySelector('.bottom-search .search-input');
  if (searchForm && searchInput) {
    async function geocodeAdminOnce(q) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&addressdetails=1&extratags=1&limit=8&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ko' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      const allowed = new Set(['4','5','6','7','8','9','10']);
      const inKR = (r) => (r.address && r.address.country_code === 'kr') || (String(r.display_name||'').includes('대한민국'));
      const isAdminBoundary = (r) => r.class === 'boundary' && r.type === 'administrative' && (
        (r.extratags && r.extratags.admin_level && allowed.has(String(r.extratags.admin_level))) ||
        (r.admin_level && allowed.has(String(r.admin_level)))
      );
      const isPlace = (r) => r.class === 'place' && ['city','county','district','town','village','hamlet','suburb','municipality'].includes(String(r.type));
      const admins = (list || []).filter(r => inKR(r) && isAdminBoundary(r));
      if (admins.length) return admins;
      const places = (list || []).filter(r => inKR(r) && isPlace(r));
      return places;
    }
    async function geocodeAdmin(q) {
      let r = await geocodeAdminOnce(q);
      if (!r || r.length === 0) {
        // retry with country bias appended
        r = await geocodeAdminOnce(`${q} 대한민국`);
      }
      return r;
    }
    async function onSearch(e) {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (!q) return;
      searchForm.classList.add('loading');
      try {
        const results = await geocodeAdmin(q);
        const r = results[0];
        if (!r) {
          alert('행정구역(시/도, 시/군/구, 읍/면/동/리)만 검색할 수 있습니다.');
          return;
        }
        if (r && r.boundingbox) {
          const [south, north, west, east] = r.boundingbox.map(Number);
          const bounds = L.latLngBounds([ [south, west], [north, east] ]);
          if (bounds.isValid()) {
            map.fitBounds(bounds.pad(0.05));
            return;
          }
        }
        if (r && r.lat && r.lon) {
          map.setView([Number(r.lat), Number(r.lon)], Math.max(map.getZoom(), 12), { animate: true });
        }
      } catch(err) {
        console.warn('Search error', err);
        alert('검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      } finally {
        searchForm.classList.remove('loading');
      }
    }
    searchForm.addEventListener('submit', onSearch);
  }

  // 클러스터 토글 버튼 바인딩
  function pointsInViewCount() {
    if (!map) return allPoints.length;
    const b = map.getBounds();
    let c = 0;
    for (const p of allPoints) {
      if (b.contains([p.lat, p.lon])) c++;
      if (c > DENSE_POINT_THRESHOLD) break;
    }
    return c;
  }

  function pointsInViewCountInn() {
    if (!map) return innAllPoints.length;
    const b = map.getBounds();
    let c = 0;
    for (const p of innAllPoints) {
      if (b.contains([p.lat, p.lon])) c++;
      if (c > DENSE_POINT_THRESHOLD) break;
    }
    return c;
  }

  function refreshPlainMarkersInView() {
    if (!map || !plainMarkerLayer) return;
    plainMarkerLayer.clearLayers();
    const b = map.getBounds();

    // Grid-based label selection to avoid clutter
    const cellSize = 64; // px
    const z = map.getZoom();
    const labelsPerCell = (z <= 12 ? 1 : z === 13 ? 1 : z === 14 ? 2 : z === 15 ? 3 : 4);
    const globalMax = (z <= 12 ? 120 : z === 13 ? 180 : z === 14 ? 300 : 450);

    // Collect candidates by cell
    const cells = new Map();
    const toKey = (x, y) => `${x}|${y}`;
    for (const p of allPoints) {
      if (!b.contains([p.lat, p.lon])) continue;
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      const cx = Math.floor(pt.x / cellSize);
      const cy = Math.floor(pt.y / cellSize);
      const key = toKey(cx, cy);
      const visitsNum = toNumber(p.props.visits);
      const score = Number.isFinite(visitsNum) ? visitsNum : 0;
      const arr = cells.get(key) || [];
      arr.push({ p, pt, score });
      cells.set(key, arr);
    }

    // Collision detection helper (approximate label bbox)
    const rects = [];
    const intersects = (a, b) => !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
    const selected = [];

    // Iterate cells and pick top labelsPerCell by score
    for (const [, arr] of cells) {
      arr.sort((A, B) => (B.score - A.score) || (String(B.p.label).localeCompare(String(A.p.label))));
      let taken = 0;
      for (const it of arr) {
        if (taken >= labelsPerCell) break;
        const { p, pt } = it;
        // Estimate label dimensions
        const len = (p.label || '').length;
        const w = Math.min(220, 16 + 7 * len);
        const h = 16;
        const yOffset = 20; // label is below the marker
        const r = { x1: pt.x - w / 2, y1: pt.y + yOffset, x2: pt.x + w / 2, y2: pt.y + yOffset + h };
        let ok = true;
        for (const ex of rects) { if (intersects(r, ex)) { ok = false; break; } }
        if (!ok) continue;
        rects.push(r);
        selected.push(p);
        taken++;
        if (selected.length >= globalMax) break;
      }
      if (selected.length >= globalMax) break;
    }

    // Add selected markers (build on-demand)
    for (const p of selected) {
      if (!p.plainMarker) {
        const htmlColor = p.color;
        p.plainMarker = L.marker([p.lat, p.lon], { icon: createDivIcon(p.label, htmlColor, p.showThumb), markerColor: htmlColor });
        const popupHtmlStr = popupHtml(p.props, htmlColor, '식당');
        const theme = `theme-${colorKeyFromColor(htmlColor)}`;
        const popupPlain = L.popup({ className: `custom-popup ${theme}`, closeButton: false });
        popupPlain.setContent(popupHtmlStr);
        p.plainMarker.bindPopup(popupPlain);
        p.plainMarker.on('popupopen', () => {
          const closeBtn = document.querySelector('.popup-close');
          if (closeBtn) closeBtn.addEventListener('click', () => p.plainMarker && p.plainMarker.closePopup());
        });
      }
      plainMarkerLayer.addLayer(p.plainMarker);
    }
  }

  function refreshInnPlainMarkersInView() {
    if (!map || !innPlainLayer) return;
    innPlainLayer.clearLayers();
    const b = map.getBounds();
    const cellSize = 64;
    const z = map.getZoom();
    const labelsPerCell = (z <= 12 ? 1 : z === 13 ? 1 : z === 14 ? 2 : z === 15 ? 3 : 4);
    const globalMax = (z <= 12 ? 120 : z === 13 ? 180 : z === 14 ? 300 : 450);

    const cells = new Map();
    const toKey = (x,y)=>`${x}|${y}`;
    for (const p of innAllPoints) {
      if (!b.contains([p.lat, p.lon])) continue;
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      const cx = Math.floor(pt.x / cellSize);
      const cy = Math.floor(pt.y / cellSize);
      const key = toKey(cx, cy);
      const score = 0;
      const arr = cells.get(key) || [];
      arr.push({ p, pt, score });
      cells.set(key, arr);
    }
    const rects = [];
    const intersects = (a,b)=>!(a.x2<b.x1||a.x1>b.x2||a.y2<b.y1||a.y1>b.y2);
    const selected = [];
    for (const [,arr] of cells) {
      arr.sort((A,B)=> (B.score-A.score) || (String(B.p.label).localeCompare(String(A.p.label))));
      let taken=0;
      for (const it of arr){
        if (taken>=labelsPerCell) break;
        const {p, pt} = it;
        const len = (p.label||'').length;
        const w = Math.min(220, 16 + 7*len);
        const h = 16;
        const yOffset = 20;
        const r = { x1: pt.x - w/2, y1: pt.y + yOffset, x2: pt.x + w/2, y2: pt.y + yOffset + h };
        let ok = true; for (const ex of rects){ if (intersects(r,ex)){ ok=false; break; } }
        if (!ok) continue;
        rects.push(r); selected.push(p); taken++;
        if (selected.length>=globalMax) break;
      }
      if (selected.length>=globalMax) break;
    }
    // Fallback: if nothing selected (e.g., very small viewport or degenerate layout), pick first few in-bounds
    if (selected.length === 0) {
      const fallback = [];
      for (const p of innAllPoints) {
        if (!b.contains([p.lat, p.lon])) continue;
        fallback.push(p);
        if (fallback.length >= 40) break;
      }
      selected.push(...fallback);
    }

    for (const p of selected){
      if (!p.plainMarker){
        const htmlColor = p.color;
        p.plainMarker = L.marker([p.lat,p.lon], { icon: createDivIcon(p.label, htmlColor, false), markerColor: htmlColor });
        const popupHtmlStr = popupHtml(p.props, htmlColor, '숙박');
        const theme = `theme-${colorKeyFromColor(htmlColor)}`;
        const pop = L.popup({ className: `custom-popup ${theme}`, closeButton: false });
        pop.setContent(popupHtmlStr);
        p.plainMarker.bindPopup(pop);
        p.plainMarker.on('popupopen', ()=>{
          const closeBtn = document.querySelector('.popup-close');
          if (closeBtn) closeBtn.addEventListener('click', ()=> p.plainMarker && p.plainMarker.closePopup());
        });
      }
      innPlainLayer.addLayer(p.plainMarker);
    }
  }

  function updateClusterVisibility() {
    const z = map.getZoom();
    // Hide all overlays to start
    if (map.hasLayer(dotLayer)) map.removeLayer(dotLayer);
    if (map.hasLayer(plainMarkerLayer)) map.removeLayer(plainMarkerLayer);
    if (map.hasLayer(innDotLayer)) map.removeLayer(innDotLayer);
    if (map.hasLayer(innPlainLayer)) map.removeLayer(innPlainLayer);

    if (activeCategory === 'food') {
      const n = pointsInViewCount();
      let wantDense;
      if (denseMode) wantDense = (z < DENSE_ZOOM_THRESHOLD) || (n > HYST_N_EXIT);
      else wantDense = (z < DENSE_ZOOM_THRESHOLD) || (n > HYST_N_ENTER);
      denseMode = wantDense;
      if (wantDense) {
        if (!map.hasLayer(dotLayer)) map.addLayer(dotLayer);
      } else {
        if (!map.hasLayer(dotLayer)) map.addLayer(dotLayer);
        if (!map.hasLayer(plainMarkerLayer)) map.addLayer(plainMarkerLayer);
        refreshPlainMarkersInView();
      }
    } else if (activeCategory === 'stay') {
      // Inns logic mirrors restaurants
      // Maintain separate denseMode for inns
      if (typeof window._denseModeInn === 'undefined') window._denseModeInn = false;
      const n = pointsInViewCountInn();
      let wantDense;
      if (window._denseModeInn) wantDense = (z < DENSE_ZOOM_THRESHOLD) || (n > HYST_N_EXIT);
      else wantDense = (z < DENSE_ZOOM_THRESHOLD) || (n > HYST_N_ENTER);
      window._denseModeInn = wantDense;
      if (wantDense) {
        if (!map.hasLayer(innDotLayer)) map.addLayer(innDotLayer);
      } else {
        if (!map.hasLayer(innDotLayer)) map.addLayer(innDotLayer);
        if (!map.hasLayer(innPlainLayer)) map.addLayer(innPlainLayer);
        refreshInnPlainMarkersInView();
      }
    } else {
      // tour/infra: leave only KRC overlay (handled separately); no restaurant/inn overlays
    }
  }
  // Initialize visibility + button state
  updateClusterVisibility();
  // Zoom-based base dot size scaling (all dots remain visible)
  let currentDotRadius = null;
  function desiredDotRadiusForZoom(z) {
    if (z <= 8) return 1.5;
    if (z <= 10) return 2.0;
    if (z <= 12) return 2.5;
    if (z <= 14) return 3.0;
    if (z <= 15) return 4.0;
    return 5.0;
  }
  function applyDotRadius() {
    const z = map.getZoom();
    const r = desiredDotRadiusForZoom(z);
    if (currentDotRadius === r) return;
    currentDotRadius = r;
    for (const p of allPoints) { if (p.dotMarker) p.dotMarker.setRadius(r); }
    for (const p of innAllPoints) { if (p.dotMarker) p.dotMarker.setRadius(r); }
  }
  function handleViewChange() {
    updateClusterVisibility();
    applyDotRadius();
    if (map.hasLayer(plainMarkerLayer)) refreshPlainMarkersInView();
    if (map.hasLayer(innPlainLayer)) refreshInnPlainMarkersInView();
  }
  map.on('zoomend moveend', handleViewChange);
  // initial dot radius
  setTimeout(applyDotRadius, 0);

  // Fixed 1px dots; no zoom-based scaling

  // 내 위치로 이동 버튼 바인딩
  const locateBtn = document.querySelector('.locate-btn');
  if (locateBtn) {
    locateBtn.addEventListener('click', () => {
      locateBtn.classList.add('loading');
      goToMyLocation().finally(() => locateBtn.classList.remove('loading'));
    });
  }

  // 시작 시 내 위치로 자동 이동 (권한 허용 시)
  goToMyLocation();

  const csvUrl = new URLSearchParams(location.search).get('csv') || DEFAULT_CSV_PATH;

  function finalizeView() {
    if (hasUserLocation) {
      // 사용자 위치로 이미 이동했으면 데이터 기준 fit을 생략
      return;
    }
    if (allPoints.length > 0) {
      try {
        const bounds = L.latLngBounds(allPoints.map(p => L.latLng(p.lat, p.lon)));
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
      } catch {}
    } else {
      console.warn('표시할 지점이 없습니다. CSV 헤더를 확인하세요. (위도/경도 또는 y/x)');
    }
  }

  function parseRows(rows) {
    let count = 0;
    rows.forEach((row) => {
      const ll = resolveLatLng(row);
      if (!ll) return;
      const [lat, lon] = ll;
      const name = getField(row, ['name', '이름', '식당이름', '식당', 'restaurant', 'title', '업체명', '상호명']);
      const menu = getField(row, ['menu', '메뉴', '카테고리', '카테', '요리']);
      const address = getField(row, ['address', '주소', '도로명주소', '지번주소']);
      const visits = getField(row, ['방문횟수', '방문횟', '방문', 'visit', 'visits', 'count', 'counts']);
      addPoint(lat, lon, { name, menu, address, visits });
      count++;
    });
    return count;
  }

  async function parseCsvFromUrl(url) {
    // Fetch as text to sanitize stray leading lines like ',,,,,,,' before the header
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let text = await res.text();
    // Normalize newlines
    text = text.replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    // Drop leading empty/comma-only lines until a plausible header appears
    const isNoise = (line) => {
      const t = line.trim();
      if (t === '') return true;
      // comma-only or quotes + commas
      if (/^[",]*$/.test(t)) return true;
      // many commas but no letters/digits
      if (/^(,\s*){3,}$/.test(t)) return true;
      return false;
    };
    // Also keep dropping until we see any of expected header tokens
    const headerTokens = ['x', 'y', 'lat', 'lon', 'lng', 'latitude', 'longitude', '위도', '경도'];
    while (lines.length > 0 && (isNoise(lines[0]) || !headerTokens.some(tok => lines[0].toLowerCase().includes(tok)))) {
      lines.shift();
    }
    const cleaned = lines.join('\n');
    const parsed = Papa.parse(cleaned, {
      header: true,
      skipEmptyLines: true
    });
    if (parsed.errors && parsed.errors.length) {
      console.warn('Papa parse warnings', parsed.errors.slice(0, 3));
    }
    return parsed.data || [];
  }

  try {
    const rows = await parseCsvFromUrl(csvUrl);
    const added = parseRows(rows);
    if (added === 0) {
      console.warn('No rows with valid coordinates found.');
    }
    finalizeView();
  } catch (err) {
    console.error('CSV load error', err);
    // 안내: file:// 로 열면 브라우저 보안상 restaurant.csv를 자동으로 읽을 수 없습니다.
    // 간단 서버로 열어주세요. 예) python3 -m http.server 8000
  }

  // Load KRC points as red stars (10px)
  function addKrcPoint(lat, lon, props) {
    const name = props.name || '';
    const address = props.address || '';
    const m = L.marker([lat, lon], { icon: createKrcIcon(name) });
    // KRC popup: address + Naver button, themed red
    const p = L.popup({ className: 'custom-popup theme-red', closeButton: false });
    p.setContent(popupKrcHtml(name, address));
    m.bindPopup(p);
    // close button hook if ever added (reuse existing close-button logic if needed)
    if (krcLayer) krcLayer.addLayer(m);
  }
  function parseKrcRows(rows) {
    let count = 0;
    rows.forEach((row) => {
      const ll = resolveLatLng(row);
      if (!ll) return;
      const [lat, lon] = ll;
      const name = getField(row, ['구분', 'name', '이름', '지점', '지사']);
      const address = getField(row, ['주소', 'address']);
      addKrcPoint(lat, lon, { name, address });
      count++;
    });
    return count;
  }
  try {
    const krcRows = await parseCsvFromUrl(KRC_CSV_PATH);
    const krcAdded = parseKrcRows(krcRows);
    if (krcAdded === 0) console.warn('No KRC points found in', KRC_CSV_PATH);
  } catch (err) {
    console.warn('KRC CSV load error', err);
  }

  // Load INN points (숙박) similar to restaurants
  function addInnPoint(lat, lon, props) {
    // visits-based color: <10 green, >=10 wine, >=100 red
    const v = toNumber(props.visits);
    let color = '#556B45';
    if (Number.isFinite(v)) {
      if (v >= 100) color = '#d7263d';
      else if (v >= 10) color = '#722F37';
    }
    const mDot = L.circleMarker([lat, lon], { radius: 2.5, fillColor: color, fillOpacity: 1, stroke: false, interactive: false });
    innDotLayer.addLayer(mDot);
    const label = props.name || '';
    innAllPoints.push({ lat, lon, props, color, label, showThumb: false, plainMarker: null, dotMarker: mDot });
  }
  function parseInnRows(rows) {
    let count = 0;
    rows.forEach((row) => {
      const ll = resolveLatLng(row);
      if (!ll) return;
      const [lat, lon] = ll;
      let name = getField(row, ['name', '이름', '시설명', '숙소명', '업체명']);
      if (!name) {
        // Fallback: second column value as inn name
        const keys = Object.keys(row);
        if (keys.length >= 2) {
          const k = keys[1];
          if (row[k] != null && String(row[k]).trim() !== '') name = String(row[k]).trim();
        }
      }
      const address = getField(row, ['address', '주소', '도로명주소', '지번주소']);
      const visits = getField(row, ['방문횟수', '방문', 'count', 'counts', 'visits', 'visit']);
      addInnPoint(lat, lon, { name, address, visits });
      count++;
    });
    return count;
  }
  try {
    const innRows = await parseCsvFromUrl(INN_CSV_PATH);
    const innAdded = parseInnRows(innRows);
    if (innAdded === 0) console.warn('No INN points found in', INN_CSV_PATH);
  } catch (err) {
    console.warn('INN CSV load error', err);
  }
}

document.addEventListener('DOMContentLoaded', init);

// Geolocation: 내 위치로 이동
function goToMyLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치 정보를 지원하지 않습니다.');
      return resolve();
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const latlng = [latitude, longitude];

        // 기존 마커/정확도 원 제거
        if (userLocationMarker) {
          map.removeLayer(userLocationMarker);
          userLocationMarker = null;
        }
        if (userAccuracyCircle) {
          map.removeLayer(userAccuracyCircle);
          userAccuracyCircle = null;
        }

        // 위치 마커 및 정확도 원 추가
        userLocationMarker = L.circleMarker(latlng, {
          radius: 6,
          color: '#1976d2',
          weight: 2,
          fillColor: '#1976d2',
          fillOpacity: 0.9
        }).addTo(map);
        if (Number.isFinite(accuracy) && accuracy > 10) {
          userAccuracyCircle = L.circle(latlng, {
            radius: Math.min(accuracy, 200),
            color: '#1976d2',
            weight: 1,
            fillColor: '#1976d2',
            fillOpacity: 0.1
          }).addTo(map);
        }

        // 보기 이동
        map.setView(latlng, Math.max(map.getZoom(), 15), { animate: true });
        hasUserLocation = true;
        resolve();
      },
      (err) => {
        console.warn('Geolocation error', err);
        alert('위치 정보를 가져오지 못했습니다. 위치 권한을 확인해 주세요.');
        resolve();
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
    );
  });
}

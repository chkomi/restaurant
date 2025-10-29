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
let normalLayerGroup;
let dotLayerGroup;
let allPoints = [];
let currentMode = 'dot';

const DEFAULT_CSV_PATH = 'restaurant.csv';
const DENSE_ZOOM_THRESHOLD = 11; // below this, show dots instead of labeled markers
const DOT_RADIUS = 1.5; // fixed dot radius when in dot mode

// 색상을 더 어둡게 만드는 함수
function getDarkerColor(color) {
  // 간단한 색상 매핑
  const colorMap = {
    '#6B8E5A': '#556B45', // 녹색 -> 더 어두운 녹색
    '#722F37': '#5A252A', // 와인색 -> 더 어두운 와인색
    '#d7263d': '#B01E30'  // 빨간색 -> 더 어두운 빨간색
  };
  return colorMap[color] || '#5D4037'; // 기본값: 어두운 브라운
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

function createDivIcon(labelText, color) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="circle-marker small" style="background:${color}"></div>`,
    iconSize: [17, 17],
    iconAnchor: [8.5, 8.5]
  });
  // Attach label after add
  icon._labelText = labelText;
  return icon;
}

function attachLabelOnAdd(marker, label) {
  marker.on('add', () => {
    const el = marker._icon;
    if (!el) return;
    let labelEl = el.querySelector('.marker-label');
    if (!labelEl) {
      labelEl = document.createElement('div');
      labelEl.className = 'marker-label';
      el.appendChild(labelEl);
    }
    labelEl.textContent = label;
    // Color label to match marker
    const color = marker.options && marker.options.markerColor;
    if (color) labelEl.style.color = color;
  });
}

function popupHtml(props, color) {
  const name = props.name || '';
  const menu = props.menu || '';
  const address = props.address || '';
  const visits = props.visits || '';
  const markerColor = color || '#6B8E5A';
  const darkerColor = getDarkerColor(markerColor);

  return `
    <div class="custom-popup" style="--marker-color: ${markerColor}; --marker-color-dark: ${darkerColor}">
      <div class="popup-card">
        <button class="popup-close">×</button>

        <div class="popup-header">
          <div class="popup-title">${name || '이름 없음'}</div>
          <div class="popup-subtitle">${name || 'Restaurant'}</div>
          <span class="popup-category-badge">식당</span>
        </div>

        <div class="popup-divider"></div>

        <div class="popup-content">
          ${address ? `
            <div class="popup-info-item">
              <div class="popup-icon">📍</div>
              <div class="popup-text">${address}</div>
            </div>
          ` : ''}

          ${menu ? `
            <div class="popup-info-item">
              <div class="popup-icon">ℹ️</div>
              <div class="popup-text">${menu}</div>
            </div>
          ` : ''}

          ${visits !== '' ? `
            <div class="popup-info-item">
              <div class="popup-icon">⭐</div>
              <div class="popup-text">방문횟수: ${visits}회</div>
            </div>
          ` : ''}
        </div>

        <div class="popup-actions">
          <button class="popup-action-btn secondary" onclick="openNaverMap('${address}', '${name}')">상세정보</button>
        </div>
      </div>
    </div>
  `;
}

function addPoint(lat, lon, props) {
  // Determine color by visit count
  const visitsRaw = props.visits;
  const visits = toNumber(visitsRaw);
  let color = '#6B8E5A'; // default green
  if (Number.isFinite(visits)) {
    if (visits > 100) color = '#d7263d'; // red
    else if (visits > 10) color = '#722F37'; // wine color (was pink)
  }

  // Normal marker with label (attach on-demand)
  const label = props.name || '';
  const m = L.marker([lat, lon], { icon: createDivIcon(label, color), markerColor: color });
  attachLabelOnAdd(m, label);

  // Bind popup with close button functionality
  const popup = L.popup({ className: 'custom-popup', closeButton: false });
  popup.setContent(popupHtml(props, color));
  m.bindPopup(popup);

  // Add close button functionality after popup opens
  m.on('popupopen', () => {
    const closeBtn = document.querySelector('.popup-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        m.closePopup();
      });
    }
  });

  // Tiny dot for dense/low zoom
  const dot = L.circleMarker([lat, lon], {
    radius: DOT_RADIUS,
    stroke: false,
    fill: true,
    fillColor: color,
    fillOpacity: 1
  });

  // Bind popup with close button functionality for dots too
  const dotPopup = L.popup({ className: 'custom-popup', closeButton: false });
  dotPopup.setContent(popupHtml(props, color));
  dot.bindPopup(dotPopup);

  // Add close button functionality for dots
  dot.on('popupopen', () => {
    const closeBtn = document.querySelector('.popup-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        dot.closePopup();
      });
    }
  });

  allPoints.push({ normal: m, dot, lat, lon });
}

const DENSE_POINT_THRESHOLD = 1200;

function refreshNormalMarkersInView() {
  if (!map) return;
  normalLayerGroup.clearLayers();
  const bounds = map.getBounds();
  const MAX_NORMAL = 1500;
  let added = 0;
  for (const p of allPoints) {
    if (added >= MAX_NORMAL) break;
    const ll = L.latLng(p.lat, p.lon);
    if (bounds.contains(ll)) {
      normalLayerGroup.addLayer(p.normal);
      added++;
    }
  }
}

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

function setMode(mode) {
  if (mode === currentMode) {
    if (mode === 'normal') {
      refreshNormalMarkersInView();
    } else {
      // Ensure dots are actually populated when staying in dot mode
      dotLayerGroup.clearLayers();
      for (const p of allPoints) dotLayerGroup.addLayer(p.dot);
      if (!map.hasLayer(dotLayerGroup)) map.addLayer(dotLayerGroup);
    }
    return;
  }
  if (mode === 'dot') {
    // switch to dots
    if (map.hasLayer(normalLayerGroup)) map.removeLayer(normalLayerGroup);
    dotLayerGroup.clearLayers();
    for (const p of allPoints) dotLayerGroup.addLayer(p.dot);
    if (!map.hasLayer(dotLayerGroup)) map.addLayer(dotLayerGroup);
  } else {
    // switch to normal
    if (map.hasLayer(dotLayerGroup)) map.removeLayer(dotLayerGroup);
    if (!map.hasLayer(normalLayerGroup)) map.addLayer(normalLayerGroup);
    refreshNormalMarkersInView();
  }
  currentMode = mode;
}

let togglePending = false;
function toggleDensityMode() {
  if (togglePending) return;
  togglePending = true;
  requestAnimationFrame(() => {
    togglePending = false;
    const z = map.getZoom();
    const dense = z < DENSE_ZOOM_THRESHOLD || pointsInViewCount() > DENSE_POINT_THRESHOLD;
    setMode(dense ? 'dot' : 'normal');
  });
}

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

  normalLayerGroup = L.layerGroup();
  dotLayerGroup = L.layerGroup().addTo(map);

  map.on('zoomend moveend', toggleDensityMode);

  initTileButtons();

  const csvUrl = new URLSearchParams(location.search).get('csv') || DEFAULT_CSV_PATH;

  function finalizeView() {
    toggleDensityMode();
    if (allPoints.length > 0) {
      try {
        const bounds = L.latLngBounds(allPoints.map(p => p.normal.getLatLng()));
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
}

document.addEventListener('DOMContentLoaded', init);

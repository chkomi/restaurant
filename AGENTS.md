# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: Entry point for the Leaflet-based map UI.
- `app.js`: Core client logic (CSV parsing, map layers, interactions).
- `styles.css`: Minimal styling for the map and controls.
- `restaurant.csv` and `data/restaurants.csv`: Source datasets (root is the default).
- `upstream/`: Reference snapshot used for comparison or fallback.
- `krc.csv`: KRC locations rendered as red star markers with labels and a simple popup.

## Build, Test, and Development Commands
- Run locally: `python3 -m http.server 5173` then open `http://localhost:5173`.
- Quick open (less reliable due to CORS): double‑click `index.html`.
- Deploy (static hosting): serve the repo root; no build step is required.

## Coding Style & Naming Conventions
- JavaScript: 2‑space indent, semicolons, single quotes, trailing commas avoided.
- Variables/functions: `camelCase`; files: lowercase with dashes or simple names (e.g., `app.js`).
- Keep map/config constants near the top of `app.js` and document non‑obvious values.
- Prefer small, pure helpers; avoid global state except for map/layer handles already used.

## Testing Guidelines
- Frameworks: none yet; rely on manual QA.
- Manual checks: load map, switch tile layers, zoom to trigger dot/label modes, click markers, verify Naver Map link opens with a cleaned address.
- Data validations: confirm CSV headers resolve (lat/lon/name/address) and malformed rows are skipped.

## Rendering Strategy (Performance + Readability)
- **Base Dots (always):** Every restaurant point is drawn as a canvas `circleMarker` on `dotLayer`. Radius scales with zoom so presence is always hinted.
  - z≤8: 1.5px, z≤10: 2.0px, z≤12: 2.5px, z≤14: 3.0px, z≤15: 4.0px, z>15: 5.0px.
- **Labeled Markers (overlay):** In sparse mode, a subset of points get 10px dot + name label via `DivIcon` on `plainMarkerLayer` with color‑themed popup.
- **Mode Switching (hysteresis):** Use zoom and in‑view count to avoid flicker.
  - Enter dense (dots only): z < 12 OR `N_view` > 1800
  - Exit to sparse (labels allowed): z ≥ 12 AND `N_view` < 1400
- **Label Selection (grid + collision):** Screen grid of 64×64px; per cell allow up to K(z) labels (z: 12→1, 13→1, 14→2, 15→3, ≥16→4). Global cap Lmax(z): 12→120, 13→180, 14→300, ≥15→450. Prioritize by visits (desc), then stable name ordering. Approximate label bbox to avoid overlaps.
- **Updates:** On `zoomend/moveend` (debounced internally), maintain base dots, rebuild labeled overlay only within viewport.

## KRC Overlay
- **Icon:** 10px red star SVG with a red name label below.
- **Popup:** Minimal red‑themed popup with address and a “네이버지도” button.
- **Data mapping:** `구분` → name, `주소` → address; `x`/`y` or lat/lon columns for coordinates.

## Category Behavior (Bottom Nav)
- **맛집:** Applies density switching logic above (base dots always visible; labels in sparse mode).
- **숙박/관광/인프라:** Base dots remain visible to hint presence; labeled overlay is hidden.
  - If you want a pure basemap for these tabs, set `dotLayer` removal in `updateClusterVisibility()` for non‑food categories.

## Tunables (in `app.js` top)
- **Hysteresis:** `HYST_N_ENTER=1800`, `HYST_N_EXIT=1400`, `DENSE_ZOOM_THRESHOLD=12`.
- **Grid size:** 64px cells for label selection.
- **Per‑cell labels:** `labelsPerCell` as a function of zoom.
- **Global caps:** `globalMax` as a function of zoom.
- **Dot radius curve:** `desiredDotRadiusForZoom(z)` controls base dot size.

## Performance Notes
- **Canvas for dense dots** keeps rendering lightweight; no DOM/event overhead.
- **On-demand DOM** only for selected labels within viewport.
- **Debounced view updates** reduce thrashing during quick pans/zooms.

## Local Boundary Index (Admin Search)
- Purpose: Move the map to an administrative area (시/도, 시/군/구, 읍/면/동/리) without relying on external geocoders.
- File: `data/admin-index.json` — JSON array of items, each with
  - `name`: primary Korean name (e.g., `전라남도 나주시` or `나주시`)
  - `altNames`: optional array of alternative names (e.g., `나주시`, `Naju-si`)
  - `level`: optional numeric admin level (e.g., 4=시/도, 6=시/군/구, 8=읍/면/동, 10=리). Used only for tie‑breaks.
  - `bbox`: `[south, west, north, east]` in degrees
- Usage: On search submit, the app first tries a local match (normalized by trimming spaces and common suffixes). If a match is found, it calls `fitBounds` on the bbox. Otherwise it falls back to the online geocoder.
- How to populate:
  1) Obtain KR admin GeoJSONs (e.g., from 통계청/VWorld/행안부) for the levels you need.
  2) Convert each feature to a record with `name`/`altNames` and a precomputed bbox.
  3) Write them as a single JSON array to `data/admin-index.json`.
- Example record:
```
{
  "name": "나주시",
  "altNames": ["전남 나주시", "Naju-si"],
  "level": 6,
  "bbox": [34.897, 126.530, 35.151, 126.902]
}
```
- Note: The repository includes a tiny placeholder. Replace it with real data for full coverage.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (e.g., `feat:`, `fix:`, `refactor:`). Keep messages concise and scoped.
- Branches: prefer short topic branches per change.
- PRs: include a clear summary, linked issue (if any), screenshots/GIFs for UI changes, and test steps (how you verified).

## Security & Configuration Tips
- Tile keys: `tileLayers.subway_transport` supports a Thunderforest API key. Do not commit secrets; leave the key blank for local dev. For production, consider a restricted key and domain whitelisting.
- Large data: keep CSVs under version control; document schema changes in the PR.

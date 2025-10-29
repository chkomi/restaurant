# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: Entry point for the Leaflet-based map UI.
- `app.js`: Core client logic (CSV parsing, map layers, interactions).
- `styles.css`: Minimal styling for the map and controls.
- `restaurant.csv` and `data/restaurants.csv`: Source datasets (root is the default).
- `upstream/`: Reference snapshot used for comparison or fallback.

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

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (e.g., `feat:`, `fix:`, `refactor:`). Keep messages concise and scoped.
- Branches: prefer short topic branches per change.
- PRs: include a clear summary, linked issue (if any), screenshots/GIFs for UI changes, and test steps (how you verified).

## Security & Configuration Tips
- Tile keys: `tileLayers.subway_transport` supports a Thunderforest API key. Do not commit secrets; leave the key blank for local dev. For production, consider a restricted key and domain whitelisting.
- Large data: keep CSVs under version control; document schema changes in the PR.

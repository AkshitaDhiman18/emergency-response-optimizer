# AI Emergency Response & Route Optimizer (CodeStorm 2026)
Dispatcher decision-support prototype. **All data is simulated** (roads, responders, hospitals). The system recommends; the dispatcher decides.

## Run
    node server.js          # needs Node 18+, NO npm install
    open http://localhost:3000
    node --test test/engine.test.js   # 11 acceptance/unit tests
Env vars: PORT (default 3000), DB_FILE (default data/db.json). The map needs internet for OpenStreetMap tiles + Leaflet CDN.

## Structure
- engine/data.js      seed data + scoring config (edit weights here)
- engine/routing.js   Dijkstra shortest travel-time path (blocked edges removed, congestion factor)
- engine/prioritize.js rule-based explainable scoring (0-100) - NOT machine learning
- engine/plan.js      responder + hospital eligibility, scoring, ranking, conflict checks
- engine/service.js   validation, approvals/overrides, audit log, what-if simulation, analytics
- server.js           REST API + static site, JSON-file persistence (data/db.json)
- public/             website (Leaflet map, dashboard, simulator, analytics, guided demo)

## Honest limitations
Graph is a simulated 12-node network (not OSM road data). Persistence is a local JSON file (single user). Dijkstra only (A* not added). Frontend is vanilla JS, not React/TypeScript.

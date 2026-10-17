// Zero-dependency Node.js server: REST API + static website. Persistence: data/db.json (bundled local JSON store).
const http = require('http'), fs = require('fs'), path = require('path');
const S = require('./engine/service'), { buildPlans } = require('./engine/plan'), { CONFIG } = require('./engine/data');
const PORT = process.env.PORT || 3000, DB = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
let state; try { state = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { state = S.createState(); save(); }
function save() { fs.mkdirSync(path.dirname(DB), { recursive:true }); fs.writeFileSync(DB, JSON.stringify(state)); }
const view = () => { const plans = buildPlans(state); return { ...state, plans, analytics:S.analytics(state), config:CONFIG }; };
const routes = [
  ['GET', /^\/api\/state$/, () => view()],
  ['POST', /^\/api\/incidents$/, (m, b) => (S.submitIncident(state, b), S.snapshotEtas(state, 'new'), view())],
  ['POST', /^\/api\/incidents\/([\w-]+)\/assessment$/, (m, b) => (S.setAssessment(state, m[1], b), view())],
  ['POST', /^\/api\/incidents\/([\w-]+)\/approve$/, (m, b) => (S.approve(state, m[1], b), view())],
  ['POST', /^\/api\/incidents\/([\w-]+)\/reject$/, (m, b) => (S.reject(state, m[1], b.reason), view())],
  ['POST', /^\/api\/incidents\/([\w-]+)\/release$/, (m, b) => (S.release(state, m[1], b.reason), view())],
  ['POST', /^\/api\/incidents\/([\w-]+)\/status$/, (m, b) => (S.setStatus(state, m[1], b.status), view())],
  ['POST', /^\/api\/recalculate$/, () => (S.audit(state, '-', 'Plans recalculated'), S.envChanged(state, 'manual recalculation'), view())],
  ['POST', /^\/api\/responders\/([\w-]+)$/, (m, b) => (S.setResponder(state, m[1], b), view())],
  ['POST', /^\/api\/hospitals\/([\w-]+)$/, (m, b) => (S.setHospital(state, m[1], b), view())],
  ['POST', /^\/api\/roads\/([\w-]+)$/, (m, b) => (S.setRoad(state, m[1], b), view())],
  ['POST', /^\/api\/simulate$/, (m, b) => S.simulate(state, b)],
  ['POST', /^\/api\/simulate\/apply$/, (m, b) => (S.applyScenario(state, b), S.audit(state, '-', 'Scenario COMMITTED', b.type, 'applied'), S.envChanged(state, 'scenario'), view())],
  ['POST', /^\/api\/reset$/, () => (state = S.createState(), view())] ];
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
http.createServer((req, res) => {
  const url = req.url.split('?')[0], send = (c, o) => { res.writeHead(c, { 'Content-Type':'application/json' }); res.end(JSON.stringify(o)); };
  if (url.startsWith('/api/')) { let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
    const r = routes.find(([m, re]) => m === req.method && re.test(url)); if (!r) return send(404, { error:'Not found' });
    try { const out = r[2](url.match(r[1]), raw ? JSON.parse(raw) : {}); if (req.method === 'POST' && !url.endsWith('/simulate')) save(); send(200, out); }
    catch (e) { send(e.status || 500, { error:e.message }); } }); return; }
  const f = path.join(__dirname, 'public', url === '/' ? 'index.html' : url.replace(/\.\./g, ''));
  fs.readFile(f, (e, d) => e ? (res.writeHead(404), res.end('Not found')) : (res.writeHead(200, { 'Content-Type':MIME[path.extname(f)] || 'text/plain' }), res.end(d)));
}).listen(PORT, () => console.log(`AI Emergency Response & Route Optimizer running at http://localhost:${PORT}`));

// Business logic: state transitions, validation, audit trail, simulation, analytics. No HTTP and no UI in here.
const D = require('./data'), { prioritize, requirements, levelOf } = require('./prioritize');
const { buildPlans, ORDER, FINAL } = require('./plan'), { haversine } = D;
const TYPES = ['road_accident','cardiac','fire','injury','other'];
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clone = o => JSON.parse(JSON.stringify(o));
function audit(s, incidentId, action, previous, next, reason = '') { s.audit.unshift({ at:new Date().toISOString(), incidentId:incidentId||'-', action, previous:String(previous ?? '-'), next:String(next ?? '-'), reason }); }
function createState() {
  const s = { seq:1, incidents:[], responders:D.makeResponders(), hospitals:D.makeHospitals(), graph:D.makeGraph(), audit:[], metrics:{ recalcs:0 }, assignmentsLog:[] };
  for (const i of D.SEED_INCIDENTS) submitIncident(s, { ...i, locationNodeId:i.node }, true);
  s.audit = []; s.metrics.recalcs = 0; s.incidents.forEach(i => { i.etaHistory = []; }); snapshotEtas(s, 'baseline'); return s;
}
function snap(graph, lat, lng) { let best = null, bd = 1e9; for (const n of Object.values(graph.nodes)) { const d = haversine({ lat, lng }, n); if (d < bd) { bd = d; best = n.id; } } return { id:best, km:bd }; }
function submitIncident(s, b, quiet) {
  if (!TYPES.includes(b.type)) throw err('Select a valid incident type.');
  if (!b.description || b.description.trim().length < 5) throw err('Description is required (at least 5 characters).');
  const people = Number(b.people); if (!Number.isInteger(people) || people < 1 || people > 100) throw err('Number of people affected must be a whole number from 1 to 100.');
  let node = b.locationNodeId;
  if (!node) { if (typeof b.lat !== 'number' || typeof b.lng !== 'number') throw err('Select a location on the map or from the list.'); const sn = snap(s.graph, b.lat, b.lng);
    if (sn.km > 3) throw err(`Location is ${sn.km.toFixed(1)} km outside the simulated road network. Choose a location inside the map area.`); node = sn.id; }
  if (!s.graph.nodes[node]) throw err('Unknown location.');
  const inc = { id:`INC-${String(s.seq++).padStart(3, '0')}`, type:b.type, description:b.description.trim(), symptoms:(b.symptoms||'').trim(), people, node, createdAt:Date.now(), status:'Reported', assignment:null, etaHistory:[], note:'Demo incident (simulated)' };
  inc.assessment = prioritize(inc); inc.status = 'Assessed'; s.incidents.push(inc);
  if (!quiet) { audit(s, inc.id, 'Incident created', '-', `${inc.assessment.priority} (${inc.assessment.score})`, 'Rule-based assessment'); snapshotEtas(s, 'new incident'); }
  refreshStatuses(s); return inc;
}
function refreshStatuses(s) { const plans = buildPlans(s);
  for (const i of s.incidents) if (['Assessed','Recommended'].includes(i.status)) i.status = plans[i.id]?.feasible ? 'Recommended' : 'Assessed'; return plans; }
function snapshotEtas(s, reason) { const plans = buildPlans(s);
  for (const i of s.incidents) { if (FINAL.includes(i.status)) continue; const eta = plans[i.id]?.totalEta ?? null, last = i.etaHistory[i.etaHistory.length-1];
    if (!last || last.eta !== eta) i.etaHistory.push({ at:Date.now(), eta, reason }); } }
function envChanged(s, reason) { s.metrics.recalcs++; refreshStatuses(s); snapshotEtas(s, reason); }
const get = (s, id) => s.incidents.find(i => i.id === id) || (() => { throw err(`Incident ${id} not found`, 404); })();
function setAssessment(s, id, { priority, reason }) {
  const i = get(s, id); if (!ORDER.hasOwnProperty(priority)) throw err('Invalid priority.'); if (!reason?.trim()) throw err('A reason is required to change the assessment.');
  if (i.assignment) throw err('Release the current assignment before changing the assessment.');
  audit(s, id, 'Assessment corrected', i.assessment.priority, priority, reason); i.assessment.priority = priority; i.assessment.overridden = true;
  i.assessment.requirements = requirements(i, priority); envChanged(s, 'assessment corrected'); return i;
}
function approve(s, id, b = {}) {
  const i = get(s, id); if (!['Assessed','Recommended'].includes(i.status)) throw err(`Incident is ${i.status}; it cannot be approved now.`);
  const plan = buildPlans(s)[id], rec = plan.recommended; const rid = b.responderId || rec.responderId;
  if (!rid) throw err(`No eligible responder. ${plan.escalation || ''}`);
  const cand = plan.responders.find(c => c.id === rid); if (!cand?.eligible) throw err(`Responder ${rid} no longer satisfies the constraints: ${cand?.reasons[0] || 'unknown'}`);
  let hid = b.hospitalId || rec.hospitalId, deferred = false, hospOver = false;
  if (plan.hospitalNeeded) { if (hid === 'DEFER') { if (rec.hospitalId) throw err('A suitable hospital exists; choose it or give an override.'); deferred = true; hid = null; }
    else { if (!hid) throw err('No hospital meets all constraints. Choose "Defer hospital decision" with a reason.'); const hc = plan.hospitals.find(c => c.id === hid);
      if (!hc?.eligible) throw err(`Hospital ${hid} no longer satisfies the constraints: ${hc?.reasons[0] || 'unknown'}`); hospOver = hid !== rec.hospitalId; } } else hid = null;
  const over = rid !== rec.responderId || hospOver || deferred;
  if (over && !b.reason?.trim()) throw err('An override reason is required when selecting a non-recommended option.');
  const r = s.responders.find(x => x.id === rid); r.status = 'busy'; r.assignedTo = id;
  if (hid) s.hospitals.find(h => h.id === hid).available--;
  i.assignment = { responderId:rid, hospitalId:hid, hospitalDeferred:deferred, approvedAt:Date.now(), override:over, overrideReason:over ? b.reason : '', recommendedWas:`${rec.responderId||'-'} / ${rec.hospitalId||'-'}`, originalEta:plan.routes.toScene ? Math.round((cand.eta + (plan.routes.toHospital ? plan.routes.toHospital.min : 0))*10)/10 : null };
  i.status = 'Approved'; s.assignmentsLog.push(rid);
  audit(s, id, over ? 'Approved with OVERRIDE' : 'Approved recommendation', `${rec.responderId||'-'} / ${rec.hospitalId||'-'}`, `${rid} / ${hid || (deferred ? 'deferred' : 'n/a')}`, b.reason || 'Matches recommendation');
  envChanged(s, 'approval'); return i;
}
function reject(s, id, reason) { const i = get(s, id); if (!reason?.trim()) throw err('A rejection reason is required.');
  if (FINAL.includes(i.status) || i.assignment) throw err('Release the assignment first, or incident already closed.');
  audit(s, id, 'Report rejected', i.status, 'Rejected', reason); i.status = 'Rejected'; i.rejectReason = reason; envChanged(s, 'rejected'); return i; }
function release(s, id, reason = 'Dispatcher released assignment') { const i = get(s, id); if (!i.assignment) throw err('No assignment to release.');
  const a = i.assignment, r = s.responders.find(x => x.id === a.responderId); r.status = 'available'; r.assignedTo = null;
  if (a.hospitalId) s.hospitals.find(h => h.id === a.hospitalId).available++;
  audit(s, id, 'Assignment released', `${a.responderId} / ${a.hospitalId||'-'}`, 'unassigned', reason); i.assignment = null; i.status = 'Assessed'; envChanged(s, 'released'); return i; }
function setStatus(s, id, status) { const i = get(s, id), ok = { 'En route':'Approved', Completed:'En route' };
  if (!ok[status] || i.status !== ok[status]) throw err(`Cannot move from ${i.status} to ${status}.`);
  audit(s, id, 'Status updated', i.status, status);
  if (status === 'Completed') { const a = i.assignment, r = s.responders.find(x => x.id === a.responderId); r.status = 'available'; r.assignedTo = null;
    r.node = a.hospitalId ? s.hospitals.find(h => h.id === a.hospitalId).node : i.node; i.completedAt = Date.now(); }
  i.status = status; envChanged(s, 'status'); return i; }
function setResponder(s, id, { status, note }) { const r = s.responders.find(x => x.id === id); if (!r) throw err('Responder not found', 404);
  if (!['available','unavailable'].includes(status)) throw err('Status must be available or unavailable.');
  const prev = r.status, hit = r.assignedTo && s.incidents.find(i => i.id === r.assignedTo);
  if (status === 'unavailable' && hit) { audit(s, hit.id, 'Assignment INVALIDATED', r.id, 'unassigned', `${r.id} became unavailable`); hit.assignment = null; hit.status = 'Assessed'; }
  r.status = status; r.assignedTo = null; r.note = status === 'unavailable' ? (note || 'Marked unavailable by dispatcher') : '';
  audit(s, hit?.id, 'Responder status', `${id}: ${prev}`, status, note); envChanged(s, 'responder'); return r; }
function setHospital(s, id, { available, status }) { const h = s.hospitals.find(x => x.id === id); if (!h) throw err('Hospital not found', 404); const prev = `${h.available} beds, ${h.status}`;
  if (available !== undefined) { if (!Number.isInteger(available) || available < 0 || available > h.total) throw err(`Capacity must be 0-${h.total}.`); h.available = available; }
  if (status) { if (!['open','diverted','closed'].includes(status)) throw err('Invalid hospital status.'); h.status = status; }
  audit(s, '-', 'Hospital updated', `${id}: ${prev}`, `${h.available} beds, ${h.status}`); envChanged(s, 'hospital'); return h; }
function setRoad(s, id, { blocked, factor }) { const e = s.graph.edges.find(x => x.id === id); if (!e) throw err('Road not found', 404); const prev = `${e.blocked ? 'blocked' : 'open'} x${e.factor}`;
  if (blocked !== undefined) e.blocked = !!blocked; if (factor !== undefined) { if (![1, .5, .25].includes(factor)) throw err('Factor must be 1, 0.5 or 0.25'); e.factor = factor; }
  audit(s, '-', 'Road changed', `${e.name}: ${prev}`, `${e.blocked ? 'blocked' : 'open'} x${e.factor}`); envChanged(s, `road ${e.name}`); return e; }
// ---- What-if simulation: same engine, run on a CLONE (temporary) or on real state (commit) ----
function applyScenario(s, sc) {
  switch (sc.type) {
    case 'block_road': setRoad(s, sc.edgeId, { blocked:true }); break;
    case 'responder_unavailable': setResponder(s, sc.responderId, { status:'unavailable', note:'Simulated outage' }); break;
    case 'hospital_capacity': setHospital(s, sc.hospitalId, { available:Number(sc.available) }); break;
    case 'multi_incident': if (!Array.isArray(sc.incidents) || sc.incidents.length < 2) throw err('Provide at least two incidents.');
      sc.incidents.forEach(x => { const i = submitIncident(s, { people:1, symptoms:'', ...x }); audit(s, i.id, 'Incident created (scenario)', '-', i.assessment.priority); }); break;
    default: throw err('Unknown scenario type.');
  }
}
const sum = (p, s) => p ? { responder:p.recommended.responderId, hospital:p.recommended.hospitalId, eta:p.totalEta, km:p.totalKm, feasible:p.feasible, limitations:p.limitations } : null;
function simulate(s, sc) {
  const base = buildPlans(s), sim = clone(s); const before = new Set(sim.incidents.map(i => i.id)); applyScenario(sim, sc); const after = buildPlans(sim), rows = [];
  for (const i of sim.incidents) { if (FINAL.includes(i.status)) continue; const o = base[i.id], n = after[i.id], ch = [], causes = [];
    if (!o) ch.push('NEW incident added by scenario'); else {
      if (o.recommended.responderId !== n.recommended.responderId) { ch.push(`Responder ${o.recommended.responderId || 'none'} -> ${n.recommended.responderId || 'none'}`);
        const ex = n.responders.find(c => c.id === o.recommended.responderId); if (ex && !ex.eligible) causes.push(`${ex.id}: ${ex.reasons[0]}`); else if (ex?.contested) causes.push(`${ex.id}: ${ex.reasons.find(x => x.startsWith('Contested'))}`); }
      if (o.recommended.hospitalId !== n.recommended.hospitalId) { ch.push(`Hospital ${o.recommended.hospitalId || 'none'} -> ${n.recommended.hospitalId || 'none'}`);
        const ex = n.hospitals.find(c => c.id === o.recommended.hospitalId); if (ex && !ex.eligible) causes.push(`${ex.id}: ${ex.reasons[0]}`); }
      const ids = p => [...(p.routes.toScene?.edges || []), ...(p.routes.toHospital?.edges || [])].map(e => e.id).join(',');
      if (ids(o) !== ids(n)) ch.push('Route changed'); if (o.totalEta !== n.totalEta) ch.push(`ETA ${o.totalEta ?? 'n/a'} -> ${n.totalEta ?? 'n/a'} min`);
      if (o.feasible !== n.feasible) causes.push(n.feasible ? 'Plan became feasible' : (n.limitations[0] || 'Plan became infeasible')); }
    rows.push({ incidentId:i.id, isNew:!before.has(i.id), priority:i.assessment.priority, original:o ? sum(o) : null, simulated:sum(n), changes:ch, causes,
      routes:{ original:o ? { toScene:o.routes.toScene?.nodes, toHospital:o.routes.toHospital?.nodes } : null, simulated:{ toScene:n.routes.toScene?.nodes, toHospital:n.routes.toHospital?.nodes } } }); }
  const unassigned = rows.filter(r => !r.simulated.responder).map(r => r.incidentId);
  return { scenario:sc, temporary:true, rows, unassigned, blockedEdges:sim.graph.edges.filter(e => e.blocked).map(e => e.id) };
}
function analytics(s) { const plans = buildPlans(s), act = s.incidents.filter(i => !FINAL.includes(i.status)), by = { Critical:0, High:0, Medium:0, Low:0 };
  s.incidents.forEach(i => by[i.assessment.priority]++); const etas = act.map(i => plans[i.id]?.totalEta).filter(x => x != null);
  const used = {}; s.assignmentsLog.forEach(r => used[r] = (used[r]||0)+1);
  return { total:s.incidents.length, byPriority:by, completed:s.incidents.filter(i => i.status === 'Completed').length, pending:act.length, rejected:s.incidents.filter(i => i.status === 'Rejected').length,
    unassigned:act.filter(i => !i.assignment).length, avgEta: etas.length ? Math.round(etas.reduce((a, b) => a+b, 0)/etas.length*10)/10 : null, recalcs:s.metrics.recalcs,
    overrides:s.incidents.filter(i => i.assignment?.override).length + 0,
    utilization:{ busy:s.responders.filter(r => r.status === 'busy').length, available:s.responders.filter(r => r.status === 'available').length, unavailable:s.responders.filter(r => r.status === 'unavailable').length, total:s.responders.length, assignmentsPerResponder:used },
    etaRevisions:s.incidents.filter(i => i.etaHistory.filter(h => h.eta != null).length > 1).map(i => { const h = i.etaHistory.filter(x => x.eta != null); return { incidentId:i.id, original:h[0].eta, latest:h[h.length-1].eta }; }),
    note:'All figures are computed from simulated demo records. They are estimates, not real-world response performance.' }; }
module.exports = { createState, submitIncident, setAssessment, approve, reject, release, setStatus, setResponder, setHospital, setRoad, simulate, applyScenario, analytics, buildPlans, refreshStatuses, snapshotEtas, envChanged, audit, ORDER };

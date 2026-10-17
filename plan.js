// Allocation engine: eligibility -> scoring -> ranking, with cross-incident resource-conflict checks.
// Responder score = (1-wEta)*capabilityFit + wEta*etaScore ; etaScore = max(0, 100 - ETA_min*penalty). Weights depend on priority (config.js).
// Hospital score = .40*capabilityFit + .35*etaScore + .25*capacityScore ; capacityScore = min(100, freeBeds/total*200).
const { dijkstra } = require('./routing');
const { CONFIG } = require('./data');
const A = CONFIG.alloc, r1 = x => Math.round(x*10)/10;
const ORDER = { Critical:0, High:1, Medium:2, Low:3 }, FINAL = ['Completed','Rejected','Cancelled'];
const etaScore = (eta, p) => Math.max(0, 100 - eta*A.etaPenaltyPerMin[p]);

function evalResponders(state, inc, reserved) {
  const req = inc.assessment.requirements, p = inc.assessment.priority, w = A.respEta[p];
  const list = state.responders.map(r => {
    const c = { id:r.id, name:r.name, capabilities:r.capabilities, status:r.status, eligible:false, contested:null, reasons:[], eta:null, km:null, score:0 };
    const ok = req.responderAnyOf.some(x => r.capabilities.includes(x));
    c.capFit = r.capabilities.includes(req.preferred) ? 100 : ok ? 70 : 0;
    const route = dijkstra(state.graph, r.node, inc.node, r.speed);
    if (route.found) { c.eta = r1(route.min); c.km = r1(route.km); c.route = route; }
    if (r.status === 'unavailable') c.reasons.push(`Excluded: unavailable (${r.note || 'no reason given'})`);
    else if (r.status === 'busy') c.reasons.push(`Excluded: busy with ${r.assignedTo}`);
    else if (!ok) c.reasons.push(`Excluded: lacks required capability (${req.responderAnyOf.join(' or ')})`);
    else if (!route.found) c.reasons.push('Excluded: no valid road route to the incident');
    else {
      c.eligible = true; c.score = r1((1-w)*c.capFit + w*etaScore(c.eta, p));
      c.reasons.push(`Capability fit ${c.capFit}% (${c.capFit === 100 ? 'preferred ' + req.preferred : 'acceptable substitute'})`, `ETA ${c.eta} min over ${c.km} km`);
      if (reserved[r.id]) { c.contested = reserved[r.id]; c.reasons.push(`Contested: tentatively reserved for higher-priority ${reserved[r.id]}`); }
    }
    return c;
  });
  return list.sort((a, b) => (b.eligible - a.eligible) || (!!a.contested - !!b.contested) || b.score - a.score || (a.eta ?? 1e9) - (b.eta ?? 1e9));
}
function evalHospitals(state, inc, beds) {
  const cap = inc.assessment.requirements.hospitalCap, p = inc.assessment.priority; if (!cap) return null;
  const list = state.hospitals.map(h => {
    const c = { id:h.id, name:h.name, capabilities:h.capabilities, eligible:false, reasons:[], eta:null, km:null, score:0, hasCap:h.capabilities.includes(cap) };
    const route = dijkstra(state.graph, inc.node, h.node, 1); if (route.found) { c.eta = r1(route.min); c.km = r1(route.km); c.route = route; }
    const free = h.available - (beds[h.id] || 0); c.free = free;
    if (h.status !== 'open') c.reasons.push(`Excluded: ${h.status} (simulated status)`);
    else if (!c.hasCap) c.reasons.push(`Excluded: lacks required ${cap} care`);
    else if (free <= 0) c.reasons.push('Excluded: no available capacity');
    else if (!route.found) c.reasons.push('Excluded: no valid road route from the scene');
    else { c.eligible = true; const cs = Math.min(100, free/h.total*200);
      c.score = r1(A.hosp.cap*100 + A.hosp.eta*etaScore(c.eta, p) + A.hosp.capacity*cs);
      c.reasons.push(`Has ${cap} care`, `${free} beds free of ${h.total}`, `ETA ${c.eta} min over ${c.km} km`); }
    return c;
  });
  return list.sort((a, b) => (b.eligible - a.eligible) || b.score - a.score || (a.eta ?? 1e9) - (b.eta ?? 1e9));
}
function pendingPlan(state, inc, reserved, beds) {
  const plan = { incidentId:inc.id, fixed:false, limitations:[], notes:[], escalation:null };
  const resp = evalResponders(state, inc, reserved), best = resp.find(c => c.eligible && !c.contested);
  plan.responders = resp.map(({ route, ...c }) => c); plan.hospitalNeeded = !!inc.assessment.requirements.hospitalCap;
  const hosp = evalHospitals(state, inc, beds), bestH = hosp && hosp.find(c => c.eligible);
  plan.hospitals = hosp ? hosp.map(({ route, ...c }) => c) : [];
  plan.recommended = { responderId: best?.id || null, hospitalId: bestH?.id || null };
  plan.routes = { toScene: best?.route || null, toHospital: bestH?.route || null };
  if (!best) { const cont = resp.find(c => c.eligible);
    plan.limitations.push(cont ? `Only responder(s) eligible are reserved for higher-priority incidents (${cont.contested}).` : 'No eligible responder is available for this incident.');
    const alt = resp.filter(c => !c.eligible && c.capFit > 0 && c.eta !== null).slice(0, 3);
    plan.escalation = `Escalate: request mutual aid / neighbouring district unit, or release a lower-priority unit.${alt.length ? ' Capable but unavailable: ' + alt.map(c => `${c.id} (ETA ${c.eta} min, ${c.reasons[0]})`).join('; ') : ''}`; }
  const near = [...resp].filter(c => c.eta !== null).sort((a, b) => a.eta - b.eta)[0];
  if (best && near && near.id !== best.id) plan.notes.push(`Nearest responder ${near.id} (${near.eta} min) not chosen: ${near.eligible ? 'lower combined capability/ETA score' : near.reasons[0]}.`);
  if (plan.hospitalNeeded && !bestH) { plan.limitations.push('No hospital meets all constraints (capability, capacity, status, route).');
    plan.hospitalFallback = (hosp || []).filter(c => c.eta !== null).sort((a, b) => (!a.hasCap - !b.hasCap) || a.eta - b.eta).slice(0, 3).map(c => `${c.id}: ${c.reasons[0]}`); }
  const nh = hosp && [...hosp].filter(c => c.eta !== null).sort((a, b) => a.eta - b.eta)[0];
  if (bestH && nh && nh.id !== bestH.id) plan.notes.push(`Closest hospital ${nh.name} (${nh.eta} min) is not the best match: ${nh.reasons[0]}.`);
  finish(plan); return plan;
}
function finish(plan) {
  const a = plan.routes.toScene, b = plan.routes.toHospital;
  plan.feasible = !!plan.recommended.responderId && (!plan.hospitalNeeded || !!plan.recommended.hospitalId) && !plan.limitations.length;
  plan.totalEta = plan.recommended.responderId ? r1(a.min + (b ? b.min : 0)) : null; plan.totalKm = plan.recommended.responderId ? r1(a.km + (b ? b.km : 0)) : null;
  plan.etaToScene = a ? r1(a.min) : null;
}
function fixedPlan(state, inc) { // already approved: recompute routes with the SAME engine so blockages show up
  const as = inc.assignment, r = state.responders.find(x => x.id === as.responderId), h = state.hospitals.find(x => x.id === as.hospitalId);
  const plan = { incidentId:inc.id, fixed:true, limitations:[], notes:[], escalation:null, responders:[], hospitals:[], hospitalNeeded:!!inc.assessment.requirements.hospitalCap,
    recommended:{ responderId:as.responderId, hospitalId:as.hospitalId || null }, routes:{} };
  const a = dijkstra(state.graph, r.node, inc.node, r.speed), b = h ? dijkstra(state.graph, inc.node, h.node, 1) : null;
  plan.routes = { toScene: a.found ? a : null, toHospital: b && b.found ? b : null };
  if (!a.found) plan.limitations.push(`${r.id} has no valid route to the scene. Re-plan or reassign.`);
  if (b && !b.found) plan.limitations.push(`No valid route from scene to ${h.name}. Re-plan or reassign.`);
  if (as.hospitalDeferred) plan.limitations.push('Hospital decision deferred by dispatcher.');
  plan.feasible = !plan.limitations.length;
  if (a.found) { plan.totalEta = r1(a.min + (b?.found ? b.min : 0)); plan.totalKm = r1(a.km + (b?.found ? b.km : 0)); plan.etaToScene = r1(a.min); } else { plan.totalEta = null; plan.totalKm = null; }
  return plan;
}
function buildPlans(state) {
  const plans = {}, reserved = {}, beds = {};
  const active = state.incidents.filter(i => !FINAL.includes(i.status));
  for (const i of active.filter(i => i.assignment)) plans[i.id] = fixedPlan(state, i);
  const pending = active.filter(i => !i.assignment).sort((a, b) => ORDER[a.assessment.priority] - ORDER[b.assessment.priority] || b.assessment.score - a.assessment.score || a.createdAt - b.createdAt);
  for (const i of pending) { const p = plans[i.id] = pendingPlan(state, i, reserved, beds);
    if (p.recommended.responderId) reserved[p.recommended.responderId] = i.id;
    if (p.recommended.hospitalId) beds[p.recommended.hospitalId] = (beds[p.recommended.hospitalId] || 0) + 1; }
  return plans;
}
module.exports = { buildPlans, ORDER, FINAL };

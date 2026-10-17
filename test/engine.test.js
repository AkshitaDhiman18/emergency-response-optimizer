const test = require('node:test'), assert = require('node:assert'), S = require('../engine/service'), { dijkstra } = require('../engine/routing');
const mk = () => S.createState(), plan = (s, id) => S.buildPlans(s)[id];
test('T1 submit incident -> dashboard, priority and recommendation', () => {
  const s = mk(), n = s.incidents.length, i = S.submitIncident(s, { type:'road_accident', description:'Bus and car collision', symptoms:'passenger unconscious, bleeding', people:2, locationNodeId:'n3' });
  assert.equal(s.incidents.length, n+1); assert.ok(i.assessment.score > 0 && i.assessment.reasons.length); const p = plan(s, i.id); assert.ok(p.recommended.responderId && p.totalEta > 0); });
test('T1b invalid input is rejected and nothing is created', () => {
  const s = mk(), n = s.incidents.length;
  assert.throws(() => S.submitIncident(s, { type:'fire', description:'x', people:1, locationNodeId:'n1' }), /Description/);
  assert.throws(() => S.submitIncident(s, { type:'fire', description:'Valid description', people:1 }), /location/i);
  assert.throws(() => S.submitIncident(s, { type:'fire', description:'Valid description', people:1, lat:10, lng:10 }), /outside/);
  assert.equal(s.incidents.length, n); });
test('T2 responder unavailable -> alternative chosen with explanation', () => {
  const s = mk(), before = plan(s, 'INC-002').recommended.responderId; S.setResponder(s, before, { status:'unavailable', note:'test' });
  const p = plan(s, 'INC-002'); assert.notEqual(p.recommended.responderId, before); assert.match(p.responders.find(c => c.id === before).reasons[0], /unavailable/); });
test('T3 nearest hospital lacking capability is not recommended', () => {
  const s = mk(), p = plan(s, 'INC-002'); assert.equal(p.recommended.hospitalId, 'H-HEART'); assert.ok(p.hospitals.find(h => h.id === 'H-CIVIL').reasons[0].includes('lacks')); });
test('T4 road blockage recalculates route', () => {
  const s = mk(), o = plan(s, 'INC-001'), edge = o.routes.toScene.edges[0].id; S.setRoad(s, edge, { blocked:true });
  const n = plan(s, 'INC-001'); assert.ok(!n.routes.toScene.edges.some(e => e.id === edge)); assert.ok(s.graph.edges.find(e => e.id === edge).blocked); });
test('T4b impossible route reports no route, not a fake ETA', () => {
  const s = mk(); s.graph.edges.filter(e => e.a === 'n11' || e.b === 'n11').forEach(e => e.blocked = true); assert.equal(dijkstra(s.graph, 'n4', 'n11').found, false); });
test('T5 approved responder removed -> assignment invalidated and logged', () => {
  const s = mk(); S.approve(s, 'INC-002'); const r = s.incidents.find(i => i.id === 'INC-002').assignment.responderId; S.setResponder(s, r, { status:'unavailable' });
  const i = s.incidents.find(x => x.id === 'INC-002'); assert.equal(i.assignment, null); assert.ok(s.audit.some(a => a.action === 'Assignment INVALIDATED')); });
test('T6 competing incidents never share a responder', () => {
  const s = mk(), ps = S.buildPlans(s), ids = Object.values(ps).map(p => p.recommended.responderId).filter(Boolean); assert.equal(new Set(ids).size, ids.length); });
test('T7 override requires a reason, approval reserves resource', () => {
  const s = mk(), p = plan(s, 'INC-001'), alt = p.responders.find(c => c.eligible && c.id !== p.recommended.responderId).id;
  assert.throws(() => S.approve(s, 'INC-001', { responderId:alt }), /override reason/); S.approve(s, 'INC-001', { responderId:alt, reason:'Closer crew known' });
  assert.equal(s.responders.find(r => r.id === alt).status, 'busy'); assert.equal(S.analytics(s).overrides, 1); });
test('T8 simulation runs on a clone and does not change real state', () => {
  const s = mk(), edge = plan(s, 'INC-001').routes.toScene.edges[0].id, r = S.simulate(s, { type:'block_road', edgeId:edge });
  assert.equal(s.graph.edges.find(e => e.id === edge).blocked, false); assert.ok(r.blockedEdges.includes(edge)); });
test('T9 hospital capacity change flips recommendation', () => {
  const s = mk(), h = plan(s, 'INC-002').recommended.hospitalId; S.setHospital(s, h, { available:0 }); const p = plan(s, 'INC-002');
  assert.notEqual(p.recommended.hospitalId, h); assert.ok(p.limitations.length || p.recommended.hospitalId); });

// Dijkstra shortest TRAVEL-TIME path on the weighted road graph. Blocked edges are removed; factor<1 slows an edge.
function dijkstra(graph, from, to, speedMult = 1) {
  if (!graph.nodes[from] || !graph.nodes[to]) return { found:false, reason:'Unknown location' };
  const adj = {};
  for (const e of graph.edges) { const sp = e.speed*(e.factor ?? 1)*speedMult; if (e.blocked || sp <= 0) continue;
    const min = e.km/sp*60; (adj[e.a] ??= []).push({ to:e.b, e, min }); (adj[e.b] ??= []).push({ to:e.a, e, min }); }
  const dist = { [from]:0 }, prev = {}, done = new Set();
  for (;;) {
    let u = null; for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k;
    if (u === null) return { found:false, reason:'No valid route: destination unreachable (roads blocked)' };
    if (u === to) break; done.add(u);
    for (const { to:v, e, min } of adj[u] || []) { const d = dist[u]+min; if (dist[v] === undefined || d < dist[v]) { dist[v] = d; prev[v] = { u, e, min }; } }
  }
  const nodes = [to], edges = []; for (let c = to; c !== from;) { const p = prev[c]; edges.unshift({ id:p.e.id, name:p.e.name, from:p.u, to:c, km:p.e.km, min:Math.round(p.min*100)/100 }); nodes.unshift(p.u); c = p.u; }
  return { found:true, nodes, edges, km:edges.reduce((s,e)=>s+e.km,0), min:dist[to] };
}
module.exports = { dijkstra };

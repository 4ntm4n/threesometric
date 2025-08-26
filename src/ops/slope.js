import { state } from '../state/appState.js';

// Hjälp: horisontell distans (i XZ)
function horizDist(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  return Math.hypot(dx, dz);
}

// En enkel Dijkstra på nodgrafen, vikt = horisontell distans, endast center-edges.
// Returnerar en array av nodeIds i ordning A..B, eller null.
export function pathBetween(graph, startId, goalId) {
  const dist = new Map();
  const prev = new Map();
  const unvisited = new Set();

  for (const id of graph.nodes.keys()) {
    dist.set(id, Infinity);
    unvisited.add(id);
  }
  dist.set(startId, 0);

  while (unvisited.size) {
    // plocka nod med minsta dist
    let u = null, best = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id);
      if (d < best) { best = d; u = id; }
    }
    if (u == null) break;
    unvisited.delete(u);
    if (u === goalId) break;

    const uNode = graph.getNode(u);
    for (const { edge, otherId } of graph.neighbors(u, { kind: 'center' })) {
      if (!unvisited.has(otherId)) continue;
      const vNode = graph.getNode(otherId);
      const w = horizDist(uNode.pos, vNode.pos);
      const alt = dist.get(u) + w;
      if (alt < dist.get(otherId)) {
        dist.set(otherId, alt);
        prev.set(otherId, u);
      }
    }
  }

  if (!prev.has(goalId) && startId !== goalId) return null;

  // bygg väg bakifrån
  const path = [goalId];
  let cur = goalId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (p == null) { return startId === goalId ? [startId] : null; }
    path.push(p);
    cur = p;
  }
  path.reverse();
  return path;
}

// Applicera fall s (t.ex. 0.01 = 1%) längs väg mellan A och B.
// - A behåller sin y (högsta punkten).
// - Varje nod i vägen får nytt y baserat på kumulativ horisontell sträcka från A.
// - Om någon nod har lockedY, hoppar vi över att ändra den (enkel första version).
export function applySlopeToPath(graph, startId, goalId, s /* 0.01 = 1% */) {
  const path = pathBetween(graph, startId, goalId);
  if (!path || path.length < 2) return { ok:false, reason:'no_path' };

  const startNode = graph.getNode(startId);
  if (!startNode) return { ok:false, reason:'bad_start' };

  // 1) kumulativa horisontella avstånd längs vägen
  const cum = [0];
  for (let i=0; i<path.length-1; i++) {
    const a = graph.getNode(path[i]).pos;
    const b = graph.getNode(path[i+1]).pos;
    cum.push(cum[cum.length-1] + horizDist(a,b));
  }

  // 2) sätt nya y-värden
  const yA = startNode.pos.y;
  for (let i=0; i<path.length; i++) {
    const nid = path[i];
    const n = graph.getNode(nid);
    if (!n) continue;
    if (n.lockedY) continue; // hoppa över låsta
    const yNew = yA - s * cum[i];
    n.pos.y = yNew;
  }

  // 3) Uppdatera Three-objekt i scenen (om du har sfärer för noder etc.)
  //    Här visar vi bara hur du kan iterera; kopplingen gör du i din draw/scene kod.
  //    T.ex.: uppdatera vertex-spheres och linjegeometrier från graph.nodes/edges.

  // Tips: efter uppdatering
  // state.draw.lineStartPoint kanske behöver reprojectas om du står i draw mode.
  // Du kan även köra din iso-fit med "model-only" box (utan grid) om du vill.
  return { ok:true, path };
}

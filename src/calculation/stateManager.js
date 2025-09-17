// ──────────────────────────────────────────────────────────────────────────────
// src/calculation/stateManager.js
// State Manager: avgör om grafen är lösbar (enligt CONTRACT.md)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Offentligt API
 *  - checkGraphSolvable(graph) : { ok:boolean, reason?:string, details?:any }
 *  - isGraphSolvable(graph)    : boolean
 *
 * Reason-koder (ur CONTRACT.md):
 *  - 'anchor_count'
 *  - 'no_absolute_reference'
 *  - 'insufficient_constraints_at_node'
 *  - 'disconnected_subgraph'
 *  - 'ambiguous_location'
 *  - 'dimension_missing'
 *  - 'dimension_conflict'
 */

export function checkGraphSolvable(graph) {
  const nodes = graph.allNodes();
  const edges = graph.allEdges();

  // 1) Anchor check (exakt en)
  const anchors = [...nodes.values()].filter(n => n?.meta?.isAnchor);
  if (anchors.length !== 1) {
    return { ok: false, reason: 'anchor_count', details: { count: anchors.length } };
  }
  const anchor = anchors[0];

  // 2) Absolut referens nära ankaret (minst en kant incident till anchor med axisLock)
  const incAtAnchor = incidentEdgesOf(graph, anchor.id);
  const hasAbsNearAnchor = incAtAnchor.some(e => e?.meta?.axisLock === 'X' || e?.meta?.axisLock === 'Y' || e?.meta?.axisLock === 'Z');
  if (!hasAbsNearAnchor) {
    return { ok: false, reason: 'no_absolute_reference', details: { where: 'anchor_neighborhood' } };
  }

  // 3) Nåbarhet (hela delgrafen som innehåller ankaret ska vara sammanhängande)
  const reachable = bfsReachableNodeIds(graph, anchor.id);
  if (reachable.length !== nodes.size) {
    return { ok: false, reason: 'disconnected_subgraph', details: { reachable: reachable.length, total: nodes.size } };
  }

  // 4) Mått ska finnas där de behövs (alla kanter i receptet bör vara måttsatta)
  for (const e of edges.values()) {
    if (!e.dim || typeof e.dim.valueMm !== 'number' || !(e.dim.valueMm > 0)) {
      return { ok: false, reason: 'dimension_missing', details: { edgeId: e.id } };
    }
  }

  // 5) Ambiguity: kanter som kräver plan men saknar ett (angleTo/perpTo utan plan)
  for (const e of edges.values()) {
    const meta = e?.meta || {};
    const needsPlane = !!meta.angleTo || !!meta.perpTo;
    if (needsPlane) {
      const hasEdgePlane = !!meta.coplanarWith;
      const nAPlane = nodePlaneRef(graph, e.a);
      const nBPlane = nodePlaneRef(graph, e.b);
      if (!hasEdgePlane && !nAPlane && !nBPlane) {
        return { ok: false, reason: 'ambiguous_location', details: { edgeId: e.id, needs: 'planeRef' } };
      }
      // Referenser måste vara definierade
      if (meta.angleTo && !meta.angleTo.ref) {
        return { ok: false, reason: 'insufficient_constraints_at_node', details: { edgeId: e.id, missing: 'angleTo.ref' } };
      }
      if (meta.perpTo && !meta.perpTo.ref) {
        return { ok: false, reason: 'insufficient_constraints_at_node', details: { edgeId: e.id, missing: 'perpTo.ref' } };
      }
    }
    // parallelTo måste ha ref
    if (e?.meta?.parallelTo && !e.meta.parallelTo.ref) {
      return { ok: false, reason: 'insufficient_constraints_at_node', details: { edgeId: e.id, missing: 'parallelTo.ref' } };
    }
  }

  // 6) Node-wise: varje icke-ankarnod måste vara "placerbar"
  //    Antingen finns en riktande constraint på minst en incident kant,
  //    eller så är triangulering möjlig (>=2 måttsatta incidenta kanter + plan i nodens kontext).
  for (const [nid, n] of nodes) {
    if (nid === anchor.id) continue;

    const inc = incidentEdgesOf(graph, nid);
    if (!inc.length) {
      return { ok: false, reason: 'insufficient_constraints_at_node', details: { nodeId: nid, why: 'no_incident_edges' } };
    }

    const hasDirectional = inc.some(e => {
      const m = e?.meta || {};
      return m.axisLock || m.parallelTo || m.perpTo || m.angleTo;
    });

    if (hasDirectional) continue;

    // Potentiell triangulering?
    const measuredToNeighbors = inc.filter(e => hasDim(e));
    const hasAtLeastTwo = measuredToNeighbors.length >= 2;

    // Finns plan i nodens kontext? (nodens planeRef eller någon kant med coplanarWith)
    const hasPlane =
      !!nodePlaneRef(graph, nid) ||
      measuredToNeighbors.some(e => !!(e?.meta?.coplanarWith));

    if (!(hasAtLeastTwo && hasPlane)) {
      return {
        ok: false,
        reason: 'insufficient_constraints_at_node',
        details: {
          nodeId: nid,
          why: 'needs_direction_or_triangulation',
          hasDirectional,
          hasAtLeastTwoMeasuredIncidentEdges: hasAtLeastTwo,
          hasPlaneRef: hasPlane
        }
      };
    }
  }

  // 7) Konsistenskontroll av trianglar (triangelolikheten)
  const edgeMap = new Map();
  for (const e of edges.values()) {
    edgeMap.set(keyFor(e.a, e.b), e);
  }

  const nodeIds = [...nodes.keys()];
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      for (let k = j + 1; k < nodeIds.length; k++) {
        const n1 = nodeIds[i], n2 = nodeIds[j], n3 = nodeIds[k];
        const e12 = edgeMap.get(keyFor(n1, n2));
        const e23 = edgeMap.get(keyFor(n2, n3));
        const e13 = edgeMap.get(keyFor(n1, n3));
        if (!e12 || !e23 || !e13) continue;

        const a = e12.dim?.valueMm;
        const b = e23.dim?.valueMm;
        const c = e13.dim?.valueMm;
        if (!(a && b && c)) continue;

        if (a + b <= c + 1e-6 || a + c <= b + 1e-6 || b + c <= a + 1e-6) {
          return {
            ok: false,
            reason: 'dimension_conflict',
            details: { nodes: [n1, n2, n3], edges: [e12.id, e23.id, e13.id] }
          };
        }
      }
    }
  }

  // Allt ser teoretiskt lösbart ut
  return { ok: true };
}

export function isGraphSolvable(graph) {
  return checkGraphSolvable(graph).ok;
}

// ──────────────────────────────────────────────────────────────────────────────
// Hjälpare (privata)
// ──────────────────────────────────────────────────────────────────────────────

function keyFor(a, b) { return [a, b].sort().join('-'); }

function incidentEdgesOf(graph, nodeId) {
  if (graph.adj && graph.allEdges) {
    const bag = graph.adj.get(nodeId) || new Set();
    const edges = graph.allEdges();
    const out = [];
    for (const eid of bag) {
      const e = edges.get(eid);
      if (e) out.push(e);
    }
    return out;
  }
  return graph.incidentEdges?.(nodeId) || [];
}

function otherOf(e, nid) { return (e.a === nid) ? e.b : e.a; }

function bfsReachableNodeIds(graph, startId) {
  const visited = new Set([startId]);
  const q = [startId];
  while (q.length) {
    const nid = q.shift();
    const inc = incidentEdgesOf(graph, nid);
    for (const e of inc) {
      const other = otherOf(e, nid);
      if (!visited.has(other)) {
        visited.add(other);
        q.push(other);
      }
    }
  }
  return [...visited];
}

function hasDim(e) {
  const v = e?.dim?.valueMm;
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function nodePlaneRef(graph, nodeId) {
  const n = graph.getNode?.(nodeId);
  if (n?.meta?.tee?.planeRef) return n.meta.tee.planeRef;
  // alternativt: någon incident kant med coplanarWith
  const inc = incidentEdgesOf(graph, nodeId);
  for (const e of inc) {
    if (e?.meta?.coplanarWith) return e.meta.coplanarWith;
  }
  return null;
}

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
 */

export function isGraphSolvable(graph) {
  return checkGraphSolvable(graph).ok === true;
}

export function checkGraphSolvable(graph) {
  // 0) Basdata
  const nodes = graph.allNodes?.();
  const edges = graph.allEdges?.();
  if (!nodes || !edges) return { ok:false, reason:'disconnected_subgraph', details:{ msg:'no nodes/edges' } };

  // 1) Exakt en anchor
  const anchors = [...nodes.values()].filter(n => n?.meta?.isAnchor === true);
  if (anchors.length !== 1) return { ok:false, reason:'anchor_count', details:{ count: anchors.length } };
  const anchor = anchors[0];

  // 2) "Absolut referens" nära ankaret:
  //    Första utkast: kräv att minst EN kant incident till ankaret har meta.axisLock.
  //    (Vid behov kan vi senare tillåta en kort kedja som implicit fixerar första framen.)
  const incidentToAnchor = incidentEdgesOf(graph, anchor.id);
  const hasAxisLockNearAnchor = incidentToAnchor.some(e => !!e?.meta?.axisLock);
  if (!hasAxisLockNearAnchor) return { ok:false, reason:'no_absolute_reference', details:{ anchor: anchor.id } };

  // 3) Traversera komponenten från ankaret och testa "entydighet" för varje ny nod
  //    - placerad := noder vi kan positionera (ankaret först)
  //    - reachable := alla noder i samma komponent via center/ construction kanter (topologi)
  const reachable = bfsReachableNodeIds(graph, anchor.id);
  const placed = new Set([anchor.id]);

  // Hjälpfunktioner för constraints
  const hasDim = (e) => typeof e?.dim?.valueMm === 'number' && isFinite(e.dim.valueMm) && e.dim.valueMm > 0;
  const hasDirConstraint = (e) =>
    !!(e?.meta?.axisLock || e?.meta?.perpTo || e?.meta?.parallelTo || e?.meta?.angleTo);
  const refEdgesKnown = (constraint, placedSet) => {
    if (!constraint) return false;
    const refId = constraint.ref ?? constraint?.angleTo?.ref ?? null;
    if (!refId) return true; // axisLock/förenklade fall
    const ref = edges.get(refId);
    if (!ref) return false;
    return placedSet.has(ref.a) && placedSet.has(ref.b);
  };
  const edgeHasPlane = (e) => !!e?.meta?.coplanarWith;
  const nodePlaneRef = (nid) => {
    const n = nodes.get(nid); if (!n) return null;
    return n?.meta?.tee?.planeRef || null;
  };

  // Förklaring logik:
  //  - En ny nod N anses "placerbar" om något av nedan är sant:
  //    A) Det finns en känd granne P med en dimensionerad kant e(P,N) + ENTINGEN:
  //       A1) e.meta.axisLock, ELLER
  //       A2) e har relativ riktning (perp/parallel/angleTo) där referens-kanten är känd
  //           och ett plan finns (på e eller på N) för att entydiggöra 3D-riktningen
  //    B) Triangulering: N har minst två dimensionerade kanter mot TVÅ olika kända grannar
  //       OCH det finns en planreferens (på N eller på minst en av kanterna) för att välja punkt.
  //
  //  Notera: Vi räknar inte koordinater här, endast om constraints räcker för entydighet.
  //
  let progress = true;
  const blockedReasons = new Map(); // nodeId -> reason string

  while (progress) {
    progress = false;

    for (const nid of reachable) {
      if (placed.has(nid)) continue;

      const inc = incidentEdgesOf(graph, nid);
      const toKnown = inc.filter(e => placed.has(otherOf(e, nid)));
      if (toKnown.length === 0) {
        blockedReasons.set(nid, 'disconnected_subgraph');
        continue;
      }

      // A) En dimensionerad kant till känd granne + riktning (absolut eller relativ) + ev. plan
      let okA = false;
      for (const e of toKnown) {
        if (!hasDim(e)) continue;
        // A1) Absolut (axisLock)
        if (e?.meta?.axisLock) { okA = true; break; }

        // A2) Relativ: kräver dirConstraint + ref-kant känd + plan
        const hasDir = hasDirConstraint(e);
        if (!hasDir) continue;

        const c = e.meta.angleTo || e.meta.perpTo || e.meta.parallelTo || null;
        const refsKnown = refEdgesKnown(c, placed);
        if (!refsKnown) continue;

        const planeAvailable = edgeHasPlane(e) || !!nodePlaneRef(nid);
        if (!planeAvailable) continue;

        okA = true; break;
      }

      // B) Triangulering: två dimensionerade kanter mot två olika kända grannar + plan
      let okB = false;
      {
        const dimToKnown = toKnown.filter(hasDim);
        const distinctKnownNeighbors = new Set(dimToKnown.map(e => otherOf(e, nid)));
        if (dimToKnown.length >= 2 && distinctKnownNeighbors.size >= 2) {
          const planeAvailable = !!nodePlaneRef(nid) || dimToKnown.some(edgeHasPlane);
          if (planeAvailable) okB = true;
        }
      }

      if (okA || okB) {
        placed.add(nid);
        blockedReasons.delete(nid);
        progress = true;
      } else {
        // Fyll på diagnoses (om vi ännu inte har en mer specifik)
        if (!blockedReasons.has(nid)) {
          // Prioritera saknad dimension vs saknad plan vs allmänt otillräckliga constraints
          if (toKnown.some(e => !hasDim(e))) {
            blockedReasons.set(nid, 'dimension_missing');
          } else if (
            toKnown.some(e => hasDim(e) && hasDirConstraint(e) && refEdgesKnown(e.meta.angleTo||e.meta.perpTo||e.meta.parallelTo, placed) && !edgeHasPlane(e)) &&
            !nodePlaneRef(nid)
          ) {
            blockedReasons.set(nid, 'ambiguous_location');
          } else {
            blockedReasons.set(nid, 'insufficient_constraints_at_node');
          }
        }
      }
    }
  }

  // 4) Bedömning
  if (placed.size === reachable.length) {
    return { ok:true };
  }

  // Om vi inte lyckats placera alla noder i komponenten:
  // Finn första blockerade nod och returnera dess reason
  const firstBlocked = reachable.find(nid => !placed.has(nid));
  const reason = blockedReasons.get(firstBlocked) || 'insufficient_constraints_at_node';
  return { ok:false, reason, details:{ nodeId:firstBlocked } };
}

// ──────────────────────────────────────────────────────────────────────────────
// Hjälpare (privata)
// ──────────────────────────────────────────────────────────────────────────────

function incidentEdgesOf(graph, nodeId) {
  // Preferera snabbväg via adj, annars neighbors()
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
  // fallback
  return graph.incidentEdges?.(nodeId) || [];
}

function otherOf(e, nid) {
  return (e.a === nid) ? e.b : e.a;
}

function bfsReachableNodeIds(graph, startId) {
  const visited = new Set();
  const q = [startId];
  visited.add(startId);

  while (q.length) {
    const nid = q.shift();
    const inc = incidentEdgesOf(graph, nid);
    for (const e of inc) {
      // Båda center och construction får binda topologi
      const other = otherOf(e, nid);
      if (!visited.has(other)) {
        visited.add(other);
        q.push(other);
      }
    }
  }
  return [...visited];
}

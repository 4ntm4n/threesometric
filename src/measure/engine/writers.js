// src/measure/engine/writers.js
import { edgeCurrentLengthFromSolOrWorld } from './lengthUtil.js';
import { getEdgeDim } from './graphUtil.js';

export function demoteOneEdge_READONLY(g, eid, solNodes, solEdges) {
  const ed = g.getEdge(eid);
  const prev = getEdgeDim(g, eid, solEdges) || ed?.dim || {};
  const isConstruction = ed?.kind === 'construction';

  let keepValue = prev.valueMm;
  if (!(typeof keepValue === 'number' && isFinite(keepValue))) {
    keepValue = edgeCurrentLengthFromSolOrWorld(g, ed, solNodes);
  }

  solEdges.set(eid, {
    valueMm: isConstruction ? keepValue : null,
    mode: prev.mode || 'aligned',
    label: prev.label ?? null,
    source: 'derived',
    derivedFrom: { kind:'autoDemote', was:'user' },
    conflict: null
  });
}

export function writeDerivedLen_READONLY(g, eid, valueMm, solEdges) {
  const dim = getEdgeDim(g, eid, solEdges) || {};
  solEdges.set(eid, {
    valueMm,
    mode: dim?.mode || 'aligned',
    label: dim?.label ?? null,
    source: 'derived',
    derivedFrom: { kind:'lockTwo_adjustOldest' },
    conflict: null
  });
}

// liten sanity-export
export const __writers_ok = true;

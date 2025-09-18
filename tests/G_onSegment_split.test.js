// tests/G_onSegment_split.test.js
import assert from 'assert/strict';
import { checkGraphSolvable } from '../src/calculation/stateManager.js';
import { calculateMetricData } from '../src/calculation/calculator.js';
import { loadGraphFromJson } from './loadGraphFromJson.js';

export async function run() {
  const json = {
    nodes: [
      { id: 'n1', meta: { isAnchor: true } },
      { id: 'n2', meta: {} },
      { id: 'n3', meta: {} },
      { id: 'n4', meta: {} },
      { id: 'n6', meta: { onSegment: { a: 'n2', b: 'n4' } } },
    ],
    edges: [
      { id:'e1', kind:'center', a:'n1', b:'n2',
        dim:{ valueMm:100, mode:'aligned' }, meta:{ axisLock:'Y' } },

      { id:'e2', kind:'construction', a:'n2', b:'n3',
        dim:{ valueMm:100, mode:'aligned' } },
      { id:'e3', kind:'construction', a:'n3', b:'n4',
        dim:{ valueMm:100, mode:'aligned' } },

      { id:'e6', kind:'center', a:'n2', b:'n6',
        dim:{ valueMm:50, mode:'aligned' } },
      { id:'e5', kind:'center', a:'n6', b:'n4',
        dim:{ valueMm:null, mode:'aligned' } },
    ]
  };

  const graph = loadGraphFromJson(json);

  const diag = checkGraphSolvable(graph);
  assert.equal(diag.ok, true, `Graph should be solvable: ${JSON.stringify(diag)}`);

  const res = calculateMetricData(graph, { quiet:true });
  assert.ok(res, 'Calculator should return coords');

  const p2 = res.get('n2'), p4 = res.get('n4'), p6 = res.get('n6');
  const L24 = Math.hypot(p4.x-p2.x, p4.y-p2.y, p4.z-p2.z);
  const L26 = Math.hypot(p6.x-p2.x, p6.y-p2.y, p6.z-p2.z);
  assert.ok(Math.abs(L26 - 50) < 1e-3, `n2–n6 ≈ 50 mm, got ${L26}`);

  const expected = L24 - 50;
  const derivedE5 = res.derivedEdgeLengths.get('e5');
  assert.ok(Math.abs(derivedE5 - expected) < 1e-3,
    `derived(e5) ~ ${expected}, got ${derivedE5}`);

  // ~91.421…
  assert.ok(Math.abs(derivedE5 - 91.421356) < 1e-2,
    `derived ~ 91.42, got ${derivedE5}`);

  console.log('[Test G] OK');
}

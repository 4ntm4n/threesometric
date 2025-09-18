// ──────────────────────────────────────────────────────────────
// tests/runContractTests.js
// Kör kontraktstester (State Manager + Kalkylator) och skriver metriken
// CLI:
//   node tests/runContractTests.js
//   node tests/runContractTests.js --pattern testD
// ──────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkGraphSolvable } from '../src/calculation/stateManager.js';
import { calculateMetricData } from '../src/calculation/calculator.js';
import { loadGraphFromJson } from './loadGraphFromJson.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALL = [
  'testA-diagonal-T.json',
  'testB-two-bends.json',
  'testC-ambiguous-no-plane.json',
  'testD-relative-chain.json',
  'testE-triangulation.json',
  'testF-dimension-conflict.json',

  // JS-baserade tester
  'G_onSegment_split.test.js',
];

const args = process.argv.slice(2);
const patIdx = args.indexOf('--pattern');
const pattern = patIdx >= 0 ? (args[patIdx + 1] || '') : '';
const LIST = pattern
  ? ALL.filter(f => f.toLowerCase().includes(pattern.toLowerCase()))
  : ALL;

const fmt = (n) => Number.isFinite(n) ? Math.round(n * 10) / 10 : n;

for (const fname of LIST) {
  if (fname.endsWith('.json')) {
    // Ladda JSON-test
    console.log(`\n--- ${fname} ---`);
    const raw = fs.readFileSync(path.join(__dirname, fname), 'utf8');
    const json = JSON.parse(raw);
    const graph = loadGraphFromJson(json);

    const state = checkGraphSolvable(graph);
    console.log('state:', JSON.stringify(state, null, 2));

    if (!state.ok) {
      // DEBUG: visa grad (antal incidenta kanter) per nod
        const deg = {};
        for (const [nid] of graph.allNodes()) deg[nid] = 0;
        for (const e of graph.allEdges().values()) {
          deg[e.a] = (deg[e.a] || 0) + 1;
          deg[e.b] = (deg[e.b] || 0) + 1;
        }
        console.log('node degrees:', deg);
      continue;
    }
    const coords = calculateMetricData(graph);
    if (!coords) {
      console.log('metric: null (calculator returned null despite ok=true)');
      continue;
    }

    // Noder
    const nodesObj = {};
    for (const nid of graph.allNodes().keys()) {
      const p = coords.get(nid);
      nodesObj[nid] = p ? { x: fmt(p.x), y: fmt(p.y), z: fmt(p.z) } : null;
    }
    console.log('metric nodes:', JSON.stringify(nodesObj, null, 2));

    // Kanter
    const edgeDiffs = [];
    for (const e of graph.allEdges().values()) {
      if (!e?.dim?.valueMm) continue;
      const a = coords.get(e.a), b = coords.get(e.b);
      if (!a || !b) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      edgeDiffs.push({
        edgeId: e.id,
        expected: e.dim.valueMm,
        got: fmt(L),
        diff: fmt(L - e.dim.valueMm)
      });
    }
    console.log('edge length check (mm):', JSON.stringify(edgeDiffs, null, 2));
  }

  else if (fname.endsWith('.js')) {
    // Ladda JS-test
    console.log(`\n--- ${fname} ---`);
    const mod = await import(`./${fname}`);
    await mod.run?.();
  }
}

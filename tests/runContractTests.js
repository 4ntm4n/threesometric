// ──────────────────────────────────────────────────────────────
// tests/runContractTests.js
// Kör alla kontraktstester (A–F) mot State Manager + Kalkylator
// ──────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkGraphSolvable } from '../src/calculation/stateManager.js';
import { calculateMetricData } from '../src/calculation/calculator.js';
import { loadGraphFromJson } from './loadGraphFromJson.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFiles = [
  'testA-diagonal-T.json',
  'testB-two-bends.json',
  'testC-ambiguous-no-plane.json',
  'testD-relative-chain.json',
  'testE-triangulation.json',
  'testF-dimension-conflict.json'
];

const fmt = (n) => Number.isFinite(n) ? Math.round(n * 10) / 10 : n;

for (const fname of testFiles) {
  const raw = fs.readFileSync(path.join(__dirname, fname), 'utf8');
  const json = JSON.parse(raw);
  const graph = loadGraphFromJson(json);

  console.log(`\n--- ${fname} ---`);
  const state = checkGraphSolvable(graph);
  console.log('state:', JSON.stringify(state, null, 2));

  if (!state.ok) continue;

  const coords = calculateMetricData(graph);
  if (!coords) {
    console.log('metric: null (calculator returned null despite ok=true)');
    continue;
  }

  // Skriv ut nodkoordinater (mm)
  const nodesObj = {};
  const nodes = [...graph.allNodes().keys()];
  for (const nid of nodes) {
    const p = coords.get(nid);
    nodesObj[nid] = p ? { x: fmt(p.x), y: fmt(p.y), z: fmt(p.z) } : null;
  }
  console.log('metric nodes:', JSON.stringify(nodesObj, null, 2));

  // Snabb sanity-check för kantlängder (diff i mm)
  const edgeDiffs = [];
  for (const e of graph.allEdges().values()) {
    if (!e?.dim?.valueMm) continue;
    const a = coords.get(e.a), b = coords.get(e.b);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    const diff = fmt(L - e.dim.valueMm);
    edgeDiffs.push({ edgeId: e.id, expected: e.dim.valueMm, got: fmt(L), diff });
  }
  console.log('edge length check (mm):', JSON.stringify(edgeDiffs, null, 2));
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkGraphSolvable } from '../src/calculation/stateManager.js';
import { loadGraphFromJson } from './loadGraphFromJson.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFiles = [
  'testA-diagonal-T.json',
  'testB-two-bends.json',
  'testC-ambiguous-no-plane.json',
];

for (const fname of testFiles) {
  const raw = fs.readFileSync(path.join(__dirname, fname), 'utf8');
  const json = JSON.parse(raw);
  const graph = loadGraphFromJson(json);

  const res = checkGraphSolvable(graph);
  console.log(`\n--- ${fname} ---`);
  console.log(JSON.stringify(res, null, 2));
}

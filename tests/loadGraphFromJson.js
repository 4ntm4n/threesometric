// ──────────────────────────────────────────────────────────────
// tests/loadGraphFromJson.js
// Adapter: ladda ett JSON-objekt till ett riktigt graph-objekt
// ──────────────────────────────────────────────────────────────

import { createGraph } from '../src/model/graph.js';

export function loadGraphFromJson(json) {
  const graph = createGraph();

  // Lägg till noder
  for (const n of json.nodes || []) {
    const node = graph.addNodeAt(n.base || { x: 0, y: 0, z: 0 });
    node.id = n.id; // behåll original-id
    node.base = n.base || { x: 0, y: 0, z: 0 };
    node.offset = n.offset || { x: 0, y: 0, z: 0 };
    node.meta = { ...(n.meta || {}) };

    // stoppa in i map manuellt med rätt id
    graph.nodes.set(n.id, node);
  }

  // Lägg till kanter
  for (const e of json.edges || []) {
    const edge = graph.addEdge(e.a, e.b, e.kind || 'center');
    edge.id = e.id; // behåll original-id
    edge.spec = e.spec || null;
    edge.dim = e.dim || null;
    edge.meta = { ...(e.meta || {}) };

    // stoppa in i map manuellt med rätt id
    graph.edges.set(e.id, edge);
  }

  return graph;
}

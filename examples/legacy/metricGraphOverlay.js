// ──────────────────────────────────────────────────────────────────────────────
// src/debug/metricGraphOverlay.js
// Visar "mentala grafen" (node.meta.metric) som 3D-linjer i scenen.
//  • Färger:
//      - röd   = conflict (dim.conflict)
//      - gul   = construction USER
//      - vit   = center USER
//      - blå   = derived (både construction och center)
//  • Endast kanter där båda ändnoderna har kända metric-koordinater ritas.
//  • mm→världsskala kan justeras via mmToWorld.
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';

export function createMetricGraphOverlay({ scene, graph, mmToWorld = 0.01, visible = false } = {}) {
  const group = new THREE.Group();
  group.name = 'MetricGraphOverlay';
  group.visible = visible;
  scene.add(group);

  const geom = new THREE.BufferGeometry();
  const mat  = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(geom, mat);
  lines.renderOrder = 1000; // över allt annat
  group.add(lines);

  // små punkter för noder (valfritt)
  const nodeGeom = new THREE.BufferGeometry();
  const nodeMat  = new THREE.PointsMaterial({
    size: 4, sizeAttenuation: false,
    color: 0x88ddff, transparent: true, opacity: 0.9, depthTest: false
  });
  const nodesPts = new THREE.Points(nodeGeom, nodeMat);
  nodesPts.renderOrder = 1001;
  group.add(nodesPts);

  function _pickColorRGB(edge) {
    if (edge?.dim?.conflict) return [1.0, 0.42, 0.42];             // röd
    if (edge?.dim?.source === 'user') {
      return edge.kind === 'construction' ? [1.0, 0.83, 0.40]       // gul
                                          : [1.0, 1.0, 1.0];        // vit
    }
    return [0.40, 0.74, 1.0];                                       // blå (derived)
  }

  function update() {
    const pos = [];
    const col = [];

    const nodePos = [];
    const nodeIds = [];

    // Kanter
    for (const [, e] of graph.allEdges()) {
      const aM = graph.getNode(e.a)?.meta?.metric;
      const bM = graph.getNode(e.b)?.meta?.metric;
      if (!aM?.known || !bM?.known) continue;

      const ax = aM.x * mmToWorld, ay = aM.y * mmToWorld, az = aM.z * mmToWorld;
      const bx = bM.x * mmToWorld, by = bM.y * mmToWorld, bz = bM.z * mmToWorld;

      pos.push(ax, ay, az, bx, by, bz);

      const [r, g, b] = _pickColorRGB(e);
      col.push(r, g, b, r, g, b);
    }

    // Noder
    for (const [nid, n] of graph.allNodes()) {
      const m = n?.meta?.metric;
      if (!m?.known) continue;
      nodeIds.push(nid);
      nodePos.push(m.x * mmToWorld, m.y * mmToWorld, m.z * mmToWorld);
    }

    // push
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
    geom.computeBoundingSphere();

    nodeGeom.setAttribute('position', new THREE.Float32BufferAttribute(nodePos, 3));
    nodeGeom.computeBoundingSphere();
  }

  function show(on = true) { group.visible = !!on; }
  function hide() { group.visible = false; }
  function toggle() { group.visible = !group.visible; }
  function dispose() {
    group.parent?.remove(group);
    geom.dispose(); nodeGeom.dispose(); mat.dispose(); nodeMat.dispose();
  }

  return { group, update, show, hide, toggle, dispose };
}

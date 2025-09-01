// src/draw/tools/slope/index.js
// ───────────────────────────────────────────────────────────────────────────
// Slope-läge (S → välj A, B → preview, Enter commit, Esc cancel, Tab toggle)
// ───────────────────────────────────────────────────────────────────────────
import { THREE } from '../../../platform/three.js';
import { makeSlopePreviewOnPath, applySlopePreview } from '../../../ops/slope.js';
import { evaluateNodeStress } from '../../../ops/stress.js';

// ── modul-scope: injiceras via init(ctx) från drawManager
let idleMarker;
let scene, graph, picker, snapper, nodeWorldPos;
let edgeIdToLine, nodeIdToSphere, topoOverlay, jointOverlay;
let setIdleMarkerColor = () => {}; // valfri från drawManager
let COLORS;

// ── publikt state-objekt
export const slope = {
  active: false,
  stage: 0,        // 0=vänta på A, 1=vänta på B, 2=preview klar
  A: null,
  B: null,
  preview: null,   // { ok, path, yTargetByNode, affectedEdges, warnings? }
  group: new THREE.Group(),
  s: 0.01,         // 1%
  mode: 'balanced',
  modes: ['balanced','lockTop','lockBottom'],
};
slope.group.renderOrder = 3;

// ── init: koppla in kontext och lägg till preview-gruppen i scenen
export function init(ctx) {
  scene             = ctx.scene;
  graph             = ctx.graph;
  picker            = ctx.picker;
  snapper           = ctx.snapper;
  nodeWorldPos      = ctx.nodeWorldPos;
  edgeIdToLine      = ctx.edgeIdToLine;
  nodeIdToSphere    = ctx.nodeIdToSphere;
  topoOverlay       = ctx.topoOverlay;
  jointOverlay      = ctx.jointOverlay;
  setIdleMarkerColor= ctx.setIdleMarkerColor || setIdleMarkerColor;
  COLORS            = ctx.COLORS || COLORS;
  idleMarker        = ctx.idleMarker;

  if (scene && slope.group.parent !== scene) {
    scene.add(slope.group);
  }
}

// ── helpers
export function clearSlopePreview() {
  while (slope.group.children.length) slope.group.remove(slope.group.children[0]);
}

export function toggleSlopeMode(on) {
  slope.active = on ?? !slope.active;
  slope.stage = slope.active ? 0 : 0;
  slope.A = slope.B = null;
  slope.mode = 'balanced';      // reset vid nytt aktiverat läge
  clearSlopePreview();
  slope.preview = null;
  try { setIdleMarkerColor(0xffffff); } catch {}
}

export function findGraphNodeIdNear(pos, tol = 1e-3) {
  if (typeof graph?.findNodeNear === 'function') {
    const hit = graph.findNodeNear(pos, tol);
    return hit ? hit.id : null;
  }
  // Fallback: skanna alla noder om API:t saknar findNodeNear
  let bestId = null, bestD2 = tol * tol;
  if (typeof graph?.allNodes === 'function') {
    for (const [nid, n] of graph.allNodes()) {
      const p = nodeWorldPos(n);
      const dx = p.x - pos.x, dy = p.y - pos.y, dz = p.z - pos.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 <= bestD2) { bestD2 = d2; bestId = nid; }
    }
  }
  return bestId;
}

// ——— Preview rendering
export function buildSlopePreview3D() {
  clearSlopePreview();
  if (!slope.preview?.ok) return;

  // 🔶 gör preview tydlig
  const previewBoost = 4; // förstora lutning i preview (endast visuellt)
  const mat = new THREE.LineDashedMaterial({
    color: 0xffa640,
    dashSize: 0.5,
    gapSize: 0.3,
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false,
  });

  const ids = slope.preview.path || [];
  let made = 0;

  for (let i = 0; i < ids.length - 1; i++) {
    const na = graph.getNode(ids[i]);
    const nb = graph.getNode(ids[i + 1]);
    if (!na || !nb) continue;

    const pa0 = nodeWorldPos(na);
    const pb0 = nodeWorldPos(nb);

    // mål-Y från preview + lite boost (endast för visning)
    const yA0 = slope.preview.yTargetByNode.get(ids[i])     ?? pa0.y;
    const yB0 = slope.preview.yTargetByNode.get(ids[i + 1]) ?? pb0.y;

    const yA = pa0.y + (yA0 - pa0.y) * previewBoost;
    const yB = pb0.y + (yB0 - pb0.y) * previewBoost;

    const a = new THREE.Vector3(pa0.x, yA, pa0.z);
    const b = new THREE.Vector3(pb0.x, yB, pb0.z);

    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, mat);
    if (l.computeLineDistances) l.computeLineDistances(); // krävs för dashed
    l.renderOrder = 5;
    slope.group.add(l);
    made++;
  }

  console.info('[Slope] Mode:', slope.mode, 'Preview lines:', made, 'Warnings:', slope.preview.warnings ?? []);
}

// ——— Mode-toggling & recompute
export function cycleSlopeMode(dir = +1) {
  const idx = slope.modes.indexOf(slope.mode);
  const next = (idx + (dir >= 0 ? 1 : slope.modes.length - 1)) % slope.modes.length;
  slope.mode = slope.modes[next];
  console.info('[Slope] Mode →', slope.mode);
}

export function recomputeSlopePreview() {
  if (!slope.A || !slope.B) return;

  // 1) Första försök: valt mode
  let preview = makeSlopePreviewOnPath(graph, slope.A, slope.B, slope.s, { mode: slope.mode });

  // 2) Smart fallback: balanced ej möjlig när A<=B → hoppa till lockBottom
  if (!preview.ok && slope.mode === 'balanced' && /A_not_higher/i.test(preview.reason || '')) {
    console.warn('[Slope] balanced ej möjligt (A måste vara högre) – byter till lockBottom');
    slope.mode = 'lockBottom';
    preview = makeSlopePreviewOnPath(graph, slope.A, slope.B, slope.s, { mode: slope.mode });
  }

  slope.preview = preview;
  buildSlopePreview3D();
}

export function commitSlopeIfPreview() {
  if (!slope.active || !slope.preview?.ok) return;

  // 1) Skriv in slopen i grafen
  const res = applySlopePreview(graph, slope.preview);
  if (!res?.ok) return;

  // 1.1) Bygg affected + center-grannar
  const affected = new Set(res.affectedNodes ?? []);
  for (const nid of [...affected]) {
    for (const { otherId } of graph.neighbors(nid, { kind:'center' })) {
      affected.add(otherId);
    }
  }
  const affectedArr = [...affected];

  // 1.2) Re-class + stress
  graph.classifyAndStoreMany(affectedArr);
  evaluateNodeStress(graph, affectedArr);

  // 1.3) Overlays
  if (topoOverlay?.isActive?.()) topoOverlay.update();
  if (jointOverlay?.isActive?.()) jointOverlay.updateNodes(affectedArr);

  // 2) Uppdatera 3D-linjer (center-edges)
  for (const eid of res.affectedEdges) {
    const e = graph.getEdge(eid); if (!e) continue;
    const pa = nodeWorldPos(graph.getNode(e.a));
    const pb = nodeWorldPos(graph.getNode(e.b));
    const line = edgeIdToLine.get(eid);
    if (line) {
      line.geometry.setFromPoints([ new THREE.Vector3(pa.x, pa.y, pa.z),
                                    new THREE.Vector3(pb.x, pb.y, pb.z) ]);
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere?.();
    }
  }

  // 3) Uppdatera nod-spheres
  for (const nid of affectedArr) {
    const n = graph.getNode(nid); if (!n) continue;
    const p = nodeWorldPos(n);
    const sph = nodeIdToSphere.get(nid);
    if (sph) sph.position.set(p.x, p.y, p.z);
  }

  // 4) Rebuild pickables (robust)
  while (picker.pickables.children.length) {
    const obj = picker.pickables.children[0];
    picker.pickables.remove(obj);
  }
  if (graph?.edges?.size) {
    for (const [eid, e] of graph.edges) {
      const pa = nodeWorldPos(graph.getNode(e.a));
      const pb = nodeWorldPos(graph.getNode(e.b));
      const pickCyl = picker.makePickCylinder(
        new THREE.Vector3(pa.x, pa.y, pa.z),
        new THREE.Vector3(pb.x, pb.y, pb.z)
      );
      if (pickCyl) picker.pickables.add(pickCyl);
    }
  }

  // 5) Städa preview & lämna läget
  clearSlopePreview();
  slope.preview = null;
  toggleSlopeMode(false);
}

// ── “verktygs-API” som drawManager kan anropa (enklare att koppla)
export function isActive(){ return slope.active; }
export function onPointerDown(e){
  if (!slope.active || document.pointerLockElement) return false;

  const pos = snapper.findNearestNode2D(e.clientX, e.clientY);
  if (!pos) return true;

  const nid = findGraphNodeIdNear(pos, 1e-3);
  if (!nid) return true;

  if (slope.stage === 0) {
    slope.A = nid; slope.stage = 1; return true;
  }
  if (slope.stage === 1) {
    if (nid === slope.A) return true;
    slope.B = nid;

    const aPos = nodeWorldPos(graph.getNode(slope.A));
    const bPos = nodeWorldPos(graph.getNode(slope.B));
    console.log('Slope A→B', { A: slope.A, aPos, B: slope.B, bPos, mode: slope.mode, s: slope.s });

    recomputeSlopePreview();
    if (!slope.preview?.ok) {
      console.warn('Slope preview failed:', slope.preview?.reason);
      // Vanlig orsak: A och B saknar center-path (val via construction).
    }
    slope.stage = 2;
    return true;
  }
  // stage 2: Enter/Esc hanteras via onKeyDown
  return true;
}
export function onKeyDown(e){
  if (!slope.active) return false;

  // Tab: cykla mode
  if (e.code === 'Tab') {
    if (e.repeat) { e.preventDefault(); return true; }
    e.preventDefault();
    cycleSlopeMode(e.shiftKey ? -1 : +1);
    if (slope.stage === 2) recomputeSlopePreview();
    return true;
  }

  // Enter: commit
  if (e.code === 'Enter') {
    if (slope.stage === 2 && slope.preview?.ok) commitSlopeIfPreview();
    return true;
  }

  // Esc: avbryt
  if (e.code === 'Escape') {
    clearSlopePreview();
    slope.preview = null;
    toggleSlopeMode(false);
    return true;
  }

  return false;
}

export function handleHover(e){
  const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
  if (nodeSnapPos) {
    idleMarker.position.copy(nodeSnapPos);
    try { setIdleMarkerColor(0xffa640); } catch {}
  } else {
    try { setIdleMarkerColor(0xffffff); } catch {}
  }
}


export function toggle(){ toggleSlopeMode(); }
export function recompute(){ recomputeSlopePreview(); }
export function buildPreview(){ buildSlopePreview3D(); }
export function clear(){ clearSlopePreview(); }
export function getPreview(){ return slope.preview; }

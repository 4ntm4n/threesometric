// src/modes/inspect/index.js
import { THREE } from '../../platform/three.js';
import { enterDrawMode } from '../../scene/controls.js';
import { state } from '../../state/appState.js';

// Kontext injiceras från drawManager
let idleMarker, setIdleMarkerColor;
let camera, renderer3D, overlay, picker, snapper, graph, controls;
let nodeWorldPos, addVertexSphere, COLORS;
let topoOverlay, jointOverlay;
let alignToSegmentCb, resetAlignmentCb;

// Init – kalla denna en gång från drawManager
export function init(ctx) {
  ({
    camera,
    renderer3D,
    overlay,
    picker,
    snapper,
    graph,
    controls,
    nodeWorldPos,
    addVertexSphere,
    idleMarker, setIdleMarkerColor,
    COLORS,
    topoOverlay, jointOverlay,
    alignToSegment: alignToSegmentCb,
    resetAlignment: resetAlignmentCb
  } = ctx);
}

// Intern hjälpare
function getNDC(e) {
  const rect = renderer3D.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return new THREE.Vector2(x, y);
}

// Hitta nodeId närmast en världspunkt (fallback om graph.findNodeNear saknas)
function findNodeIdNear(pos, tol = 1e-3) {
  if (typeof graph.findNodeNear === 'function') {
    const hit = graph.findNodeNear(pos, tol);
    return hit ? hit.id : null;
  }
  if (typeof graph.allNodes === 'function') {
    let bestId = null;
    let bestD2 = tol * tol;
    for (const [nid, n] of graph.allNodes()) {
      const p = nodeWorldPos(n);
      const d2 = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 + (p.z - pos.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestId = nid; }
    }
    return bestId;
  }
  return null;
}

// Stabil refDir för HELA segmentet: samla icke-kolinjära grannar från båda ändar,
// projicera dem på planet ortogonalt mot segmenttangenten, medelvärdesbilda.
function computeRefDirForSegment(segStart, segEnd) {
  const t = new THREE.Vector3().subVectors(segEnd, segStart).normalize();
  const endIds = [ findNodeIdNear(segStart, 1e-3), findNodeIdNear(segEnd, 1e-3) ].filter(Boolean);

  const projSum = new THREE.Vector3(0,0,0);
  let count = 0;

  if (typeof graph.neighbors === 'function') {
    for (const nid of endIds) {
      const nSelf = graph.getNode(nid); if (!nSelf) continue;
      const pSelf = nodeWorldPos(nSelf);
      for (const { otherId } of graph.neighbors(nid, { kind:'center' })) {
        const nOther = graph.getNode(otherId); if (!nOther) continue;
        const pOther = nodeWorldPos(nOther);

        const u = new THREE.Vector3(pOther.x - pSelf.x, pOther.y - pSelf.y, pOther.z - pSelf.z).normalize();
        if (Math.abs(u.dot(t)) > 0.98) continue; // hoppa över (nära) kolinjära

        // projektion på planet ⟂ t
        const uProj = u.sub(t.clone().multiplyScalar(u.dot(t)));
        if (uProj.lengthSq() < 1e-10) continue;
        projSum.add(uProj.normalize());
        count++;
      }
    }
  }

  if (count > 0) {
    const avg = projSum.normalize();
    // avg är redan ortogonal mot t; funkar bra som roll-hint
    return avg;
  }

  // Fallback: world-up (hanteras i alignment om parallell)
  return new THREE.Vector3(0, 1, 0);
}

// Klick i inspektionsläge – starta ritning från node-snap / segment / plan
export function handlePointerDown(e, pickPlaneMesh) {
  // 1) Node-snap
  const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
  if (nodeSnapPos) {
    state.draw.lineStartPoint.copy(nodeSnapPos);
    const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
    addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
    resetAlignmentCb?.(); // start från nod: ingen in-vridning
    return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
  }

  // 2) Segment – närmsta punkt
  const ndc = getNDC(e);
  picker.raycaster.setFromCamera(ndc, camera);

  const hits = picker.raycaster.intersectObjects(picker.pickables.children, false);
  if (hits.length > 0) {
    const hit = hits[0];
    const seg = hit.object.userData; // { start, end } i världsrummet
    const nearest = picker.closestPointOnSegment(hit.point, seg.start, seg.end);

    state.draw.lineStartPoint.copy(nearest);
    const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
    addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);

    // pivot = närmsta endpoint till klickpunkten (för snygg orbit)
    const dStart = nearest.distanceTo(seg.start);
    const dEnd   = nearest.distanceTo(seg.end);
    const pivotPos = dStart <= dEnd ? seg.start : seg.end;

    // STABIL roll-hint för hela segmentet (oberoende av var du klickar)
    const refDir = computeRefDirForSegment(seg.start, seg.end);

    // animerad in-vridning runt pivot + roll-lås
    alignToSegmentCb?.(seg.start, seg.end, nearest, refDir);

    return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
  }

  // 3) Planträff – alltid origo
  const hit = picker.raycaster.intersectObject(pickPlaneMesh);
  if (hit.length) {
    state.draw.lineStartPoint.set(0, 0, 0); // ← alltid (0,0,0)
    const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
    addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
    resetAlignmentCb?.(); // fri punkt: ingen in-vridning
    return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
  }
}

// Hover (grön markör)
export function handleHover(e, pickPlaneMesh) {
  const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
  if (nodeSnapPos) {
    idleMarker.position.copy(nodeSnapPos);
    try { setIdleMarkerColor?.(0x80ff80); } catch {}
    return;
  } else {
    try { setIdleMarkerColor?.(0xffffff); } catch {}
  }
  const ndc = getNDC(e);
  picker.raycaster.setFromCamera(ndc, camera);
  const hits = picker.raycaster.intersectObjects(picker.pickables.children, false);
  if (hits.length > 0) {
    const hit = hits[0];
    const seg = hit.object.userData;
    const nearest = picker.closestPointOnSegment(hit.point, seg.start, seg.end);
    idleMarker.position.copy(nearest);
    return;
  }
  const hit = picker.raycaster.intersectObject(pickPlaneMesh);
  if (hit.length) idleMarker.position.copy(hit[0].point);
}

// key bindings (debug i inspektionsläge)
export function handleKeyDown(e) {
  if (e.code === 'KeyD') {
    e.preventDefault();
    topoOverlay.toggle();
    if (topoOverlay.isActive()) topoOverlay.update();
    return true;
  }
  if (e.code === 'KeyJ') {
    e.preventDefault();
    jointOverlay.toggle();
    if (jointOverlay.isActive()) jointOverlay.updateAll();
    return true;
  }
  return false;
}

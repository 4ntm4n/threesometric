// src/modes/inspect/index.js
import { THREE } from '../../platform/three.js';
import { enterDrawMode } from '../../scene/controls.js';
import { state } from '../../state/appState.js';

// Kontext injiceras från drawManager
let idleMarker, setIdleMarkerColor;
let camera, renderer3D, overlay, picker, snapper, graph, controls;
let nodeWorldPos, addVertexSphere, COLORS;

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
    COLORS
  } = ctx);
}

// Intern hjälpare (tidigare i drawManager)
function getNDC(e) {
  const rect = renderer3D.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return new THREE.Vector2(x, y);
}

// Klick i inspektionsläge – starta ritning från node-snap / segment / plan
export function handlePointerDown(e, pickPlaneMesh) {
  // 1) Node-snap
  const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
  if (nodeSnapPos) {
    state.draw.lineStartPoint.copy(nodeSnapPos);
    // koppla startpunkten till grafen om den saknas
    const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
    addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
    return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
  }

  // 2) Segment – närmsta punkt
  const ndc = getNDC(e);
  picker.raycaster.setFromCamera(ndc, camera);

  const hits = picker.raycaster.intersectObjects(picker.pickables.children, false);
  if (hits.length > 0) {
    const hit = hits[0];
    const seg = hit.object.userData;
    const nearest = picker.closestPointOnSegment(hit.point, seg.start, seg.end);
    state.draw.lineStartPoint.copy(nearest);
    const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
    addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
    return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
  }

  // 3) Planträff – fri punkt
  const hit = picker.raycaster.intersectObject(pickPlaneMesh);
  if (hit.length) {
    state.draw.lineStartPoint.copy(hit[0].point);
    const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
    addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
    return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
  }
}

//idle marker & markercolor
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
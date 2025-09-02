// src/draw/tools/line/index.js
import { THREE } from '../../../platform/three.js';
import { angleToIsoDir3D, pixelsPerWorldUnit, snapAngleDeg } from '../../../core/utils.js';
import { ISO_ANGLES } from '../../../core/constants.js';
import { state } from '../../../state/appState.js';
import { getSpecById, cycleSpec, PIPE_SPECS } from '../../../catalog/specs.js';
import { evaluateNodeStress } from '../../../ops/stress.js';

let camera, overlay, snapper,
    graph, modelGroup, picker,
    topoOverlay, jointOverlay,
    nodeWorldPos, edgeIdToLine, nodeIdToSphere,
    COLORS, addVertexSphere, setCurrentSpec,
    toGraphSpace, isAlignmentActive, toViewDir;
    

export function init(ctx){
  camera = ctx.camera;
  overlay = ctx.overlay;
  snapper = ctx.snapper;

  graph = ctx.graph;
  modelGroup = ctx.modelGroup;
  picker = ctx.picker;
  topoOverlay = ctx.topoOverlay;
  jointOverlay = ctx.jointOverlay;

  nodeWorldPos = ctx.nodeWorldPos;
  edgeIdToLine = ctx.edgeIdToLine;
  nodeIdToSphere = ctx.nodeIdToSphere;
  setCurrentSpec = ctx.setCurrentSpec;

  COLORS = ctx.COLORS;
  addVertexSphere = ctx.addVertexSphere;

  // alignment callbacks (med säkra fallbacks)
  toGraphSpace = ctx.toGraphSpace || ((v) => v);
  isAlignmentActive = ctx.isAlignmentActive || (() => false);
  toViewDir = ctx.toViewDir || ((d) => d);   
}

// ──────────────────────────────────────────────────────────────────────────────
// Preview (iso-snap eller nod-snap)
// ──────────────────────────────────────────────────────────────────────────────
function predictEndPointAxis() {
  const dx = overlay.virtualCursorPix.x - overlay.start2D.x;
  const dy = overlay.start2D.y - overlay.virtualCursorPix.y;
  const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;

  const snapped = snapAngleDeg(rawAngle, ISO_ANGLES);
  const dir3D = angleToIsoDir3D(snapped); // ← OBS: INTE roterad här

  const ppu = pixelsPerWorldUnit(camera, overlay.canvas, dir3D, state.draw.lineStartPoint);
  const pixelsLen = Math.hypot(dx, dy);
  const worldLen = pixelsLen / ppu;
  const end3D = state.draw.lineStartPoint.clone().add(dir3D.multiplyScalar(worldLen));
  return { end3D, worldLen, snappedToNode: false };
}

function predictEndPointNormal() {
  const snapPos = snapper.findNearestNode2D(overlay.virtualCursorPix.x, overlay.virtualCursorPix.y);
  if (snapPos && snapPos.distanceToSquared(state.draw.lineStartPoint) > 1e-10) {
    const end3D = snapPos.clone();
    const worldLen = Math.sqrt(state.draw.lineStartPoint.distanceToSquared(end3D));
    return { end3D, worldLen, snappedToNode: true };
  }
  return predictEndPointAxis();
}

export function predictEndPoint() {
  return state.draw.isConstruction ? predictEndPointAxis() : predictEndPointNormal();
}

// ──────────────────────────────────────────────────────────────────────────────
// Minimal line-helper: rendera linje, inga side effects (commitIfAny sköter övrigt)
// ──────────────────────────────────────────────────────────────────────────────
function addModelLine(a, b, { dashed = false } = {}) {
  const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = dashed
    ? new THREE.LineDashedMaterial({
        color: 0x9aa6b2,
        dashSize: 0.35,
        gapSize: 0.22,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      })
    : new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false });

  const line = new THREE.Line(geom, mat);
  if (dashed && line.computeLineDistances) line.computeLineDistances();
  line.renderOrder = 1;
  modelGroup.add(line);
  return line;
}

// ──────────────────────────────────────────────────────────────────────────────
// Commit
// ──────────────────────────────────────────────────────────────────────────────
export function commitIfAny() {
  const { end3D, worldLen } = predictEndPoint();
  if (worldLen <= 1e-6) return;

  // View → Graph space om modellen är invriden
  const aView = state.draw.lineStartPoint.clone();
  const bView = end3D.clone();
  const aG = toGraphSpace(aView);
  const bG = toGraphSpace(bView);

  // 1) Uppdatera graf
  const kind = state.draw.isConstruction ? 'construction' : 'center';
  const { node: aNode } = graph.getOrCreateNodeAt(aG);
  const { node: bNode } = graph.getOrCreateNodeAt(bG);
  const edge = graph.addEdge(aNode.id, bNode.id, kind);

  // 1.1) Spec för center-edges
  if (edge && kind === 'center' && typeof graph.setEdgeSpec === 'function') {
    const spec = getSpecById(state.spec.current);
    if (spec) graph.setEdgeSpec(edge.id, spec);
  }

  // 1.2) Klassning + stress + overlays (endast center)
  if (edge && kind === 'center' && typeof graph.classifyAndStoreMany === 'function') {
    const near = new Set([aNode.id, bNode.id]);
    for (const nid of [...near]) {
      for (const { otherId } of graph.neighbors(nid, { kind: 'center' })) near.add(otherId);
    }
    const nearArr = [...near];

    graph.classifyAndStoreMany(nearArr);
    evaluateNodeStress(graph, nearArr);

    if (topoOverlay?.isActive?.()) topoOverlay.update();
    if (jointOverlay?.isActive?.()) jointOverlay.updateNodes(nearArr);
  }

  // 2) Render-line + pickable i GRAF-rummet (frameRoot roterar visuellt)
  const dashed = state.draw.isConstruction;
  const aV3 = new THREE.Vector3(aG.x, aG.y, aG.z);
  const bV3 = new THREE.Vector3(bG.x, bG.y, bG.z);
  const line = addModelLine(aV3, bV3, { dashed });
  if (!dashed && edge) edgeIdToLine.set(edge.id, line);

  const pickCyl = picker.makePickCylinder(aV3, bV3);
  if (pickCyl) picker.pickables.add(pickCyl);

  // 3) nod-spheres
  addVertexSphere(aG, aNode.id, COLORS.vertex);
  addVertexSphere(bG, bNode.id, COLORS.vertex);

  // 4) fortsätt rita från VISNINGS-punkten (inte aG/bG)
  state.draw.lineStartPoint.copy(bView);
  overlay.recenterCursorToStart();
}

// ──────────────────────────────────────────────────────────────────────────────
// Tangentbindningar (ritläge)
// ──────────────────────────────────────────────────────────────────────────────
export function handleKeyDown(e){
  // , .  (cycle spec)
  if (e.code === 'Period' || e.code === 'Comma') {
    e.preventDefault();
    const dir = e.code === 'Period' ? +1 : -1;
    const nextId = cycleSpec(state.spec.current, dir);
    if (nextId) setCurrentSpec(nextId);
    return true;
  }
  // 1 / 2 / 3 (direct select)
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    e.preventDefault();
    const idx = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
    const id = PIPE_SPECS[idx]?.id;
    if (id) setCurrentSpec(id);
    return true;
  }
  return false;
}

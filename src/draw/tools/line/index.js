// src/draw/tools/line/index.js
import { THREE } from '../../../platform/three.js';
import { angleToIsoDir3D, pixelsPerWorldUnit, snapAngleDeg } from '../../../core/utils.js';
import { ISO_ANGLES } from '../../../core/constants.js';
import { state } from '../../../state/appState.js';
import { getSpecById, cycleSpec, PIPE_SPECS } from '../../../catalog/specs.js';
import { evaluateNodeStress } from '../../../ops/stress.js';
import * as splitTool from '../split/index.js';

let camera, overlay, snapper,
    graph, modelGroup, picker,
    topoOverlay, jointOverlay,
    nodeWorldPos, edgeIdToLine, nodeIdToSphere,
    COLORS, addVertexSphere, setCurrentSpec,
    toGraphSpace, isAlignmentActive, toViewDir;

// ──────────────────────────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────────────────────────
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
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function toV3(p){ return new THREE.Vector3(p.x, p.y, p.z); }

function addModelLine(a, b, { dashed = false } = {}) {
  const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = dashed
    ? new THREE.LineDashedMaterial({
        color: 0xef92d8,
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

// Ta bort visuella artefakter för en edge (linje + pick-cylinder)
function removeEdgeVisuals(edgeId, { startWorld = null, endWorld = null } = {}) {
  // 3D-linje
  const mesh = edgeIdToLine.get(edgeId);
  if (mesh) {
    if (mesh.parent) mesh.parent.remove(mesh);
    edgeIdToLine.delete(edgeId);
  }

  // pick-cylinder via edge-id
  const removed = picker.removeEdgePick?.(edgeId);
  if (!removed && startWorld && endWorld) {
    // Fallback: gamla pick-cylindrar saknar edgeId → ta bort genom att matcha endpoints
    const eps = 1e-6;
    const sw = toV3(startWorld), ew = toV3(endWorld);
    const len = sw.distanceTo(ew);
    for (const ch of [...picker.pickables.children]) {
      const ud = ch.userData || {};
      if (!ud.start || !ud.end) continue;
      const s2 = ud.start, e2 = ud.end;
      const same =
        sw.distanceTo(s2) < 1e-6 &&
        ew.distanceTo(e2) < 1e-6 &&
        Math.abs(len - s2.distanceTo(e2)) < 1e-6;
      if (same) {
        if (ch.parent) ch.parent.remove(ch);
        break;
      }
    }
  }
}

// Lägg till visuella artefakter för en edge (linje + pick-cylinder)
function addEdgeVisuals(edgeId, dashed = false) {
  const e = graph.getEdge(edgeId);
  if (!e) return null;
  const pa = graph.getNodeWorldPos(e.a);
  const pb = graph.getNodeWorldPos(e.b);
  if (!pa || !pb) return null;

  const aV3 = toV3(pa), bV3 = toV3(pb);
  const line = addModelLine(aV3, bV3, { dashed });
  if (!dashed) edgeIdToLine.set(edgeId, line);

  // Använd edge-bunden pick för center-edges
  if (!dashed && e.kind === 'center' && typeof picker.addEdgePick === 'function') {
    picker.addEdgePick(edgeId, aV3, bV3);
  } else {
    // Fallback om helpers saknas eller för construction (om du ändå vill picka dem)
    const pickCyl = picker.makePickCylinder(aV3, bV3);
    if (pickCyl) picker.pickables.add(pickCyl);
  }
  return { line };
}

// Försök splitta en center-edge om startpunkten ligger på en befintlig kant
function trySplitAtStartPoint(aG) {
  const hitTol = 0.25;  // bör harmonisera med pick-cylinder-radius
  const tEps   = 1e-6;

  // Gå igenom befintliga center-edges
  const edgesMap = graph.allEdges?.();
  if (!edgesMap || typeof edgesMap.values !== 'function') return null;

  const aV = toV3(aG);
  for (const e of edgesMap.values()) {
    if (!e || e.kind !== 'center') continue;
    const pa = graph.getNodeWorldPos(e.a);
    const pb = graph.getNodeWorldPos(e.b);
    if (!pa || !pb) continue;
    const a3 = toV3(pa), b3 = toV3(pb);
    const segLen = a3.distanceTo(b3);
    if (segLen <= 1e-9) continue;

    // Avstånd + t längs segmentet
    const ct = picker.closestPointAndTOnSegment
      ? picker.closestPointAndTOnSegment(aV, a3, b3)
      : (() => {
          const ab = new THREE.Vector3().subVectors(b3, a3);
          const abLenSq = ab.lengthSq();
          const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(aV, a3).dot(ab) / (abLenSq || 1)));
          const point = a3.clone().add(ab.multiplyScalar(t));
          return { point, t };
        })();

    const dist = (ct.point || a3).distanceTo(aV);
    const t = ct.t ?? 0;

    // Inre träff (inte ändar) och nära linjen?
    if (t > tEps && t < 1 - tEps && dist <= hitTol) {
      // Spara endpoints före split för fallback-borttagning av pick
      const startWorld = pa, endWorld = pb;

      const res = splitTool.splitEdge(graph, e.id, {
        hitWorldPos: aG,
        onEdgeRemoved: (oldId) => {
          removeEdgeVisuals(oldId, { startWorld, endWorld });
        },
        onEdgeAdded: (newId) => {
          addEdgeVisuals(newId, false); // center-edges → inte dashed
        }
      });

      if (res?.ok) {
        // Ny nod-sfär på splitpunkten
        if (res.pos && res.newNodeId) addVertexSphere(res.pos, res.newNodeId, COLORS.vertex);

        // Uppdatera overlays (lokalt)
        if (topoOverlay?.isActive?.()) topoOverlay.update();
        if (jointOverlay?.isActive?.()) jointOverlay.updateNodes([ graph.getEdge(res.leftEdgeId)?.a, res.newNodeId, graph.getEdge(res.rightEdgeId)?.b ].filter(Boolean));

        return res; // första rimliga träff räcker
      }
      // Om split misslyckas, fortsätt inte — vi låter användaren rita ändå
      return null;
    }
  }
  return null;
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
/** Commit: rita linje. Om startpunkten ligger på en center-edge → splitta först. */
// ──────────────────────────────────────────────────────────────────────────────
export function commitIfAny() {
  const { end3D, worldLen } = predictEndPoint();
  if (worldLen <= 1e-6) return;

  // View → Graph space om modellen är invriden
  const aView = state.draw.lineStartPoint.clone();
  const bView = end3D.clone();
  const aG = toGraphSpace(aView);
  const bG = toGraphSpace(bView);

  const kind = state.draw.isConstruction ? 'construction' : 'center';

  // 0) Om vi ritar center-edge och startpunkten ligger på en befintlig kant → splitta
  if (kind === 'center') {
    trySplitAtStartPoint(aG);
  }

  // 1) Uppdatera graf (noder kan nu ha tillkommit via split ovan)
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

  // Använd edge-bunden pick för center-edges; annars fallback
  if (!dashed && edge && typeof picker.addEdgePick === 'function') {
    picker.addEdgePick(edge.id, aV3, bV3);
  } else {
    const pickCyl = picker.makePickCylinder(aV3, bV3);
    if (pickCyl) picker.pickables.add(pickCyl);
  }

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

// ──────────────────────────────────────────────────────────────────────────────
// src/draw/drawManager.js
//  • S: aktivera slope-läget, klicka A och B
//  • Tab: toggla profil (balanced → lockTop → lockBottom → balanced …)
//  • Enter: commit (slope i stage 2)
//  • Esc: cancel
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';
import { resetIsoAndFitAll } from '../scene/controls.js';
import { state } from '../state/appState.js';
import { COLORS } from '../core/constants.js';

import * as slopeTool from './tools/slope/index.js';
import * as lineTool from './tools/line/index.js';
import * as inspect from '../modes/inspect/index.js';

import { getSpecById } from '../catalog/specs.js';
import { createTopoOverlay } from '../debug/topoOverlay.js';
import { createJointOverlay } from '../debug/jointOverlay.js';

export function createDrawManager({
  scene, camera, renderer3D, controls, overlay, picker, snapper, modelGroup, permanentVertices, graph
}) {
  state.camera = camera;
  state.ui.rendererEl = renderer3D.domElement;

  if (state.draw.isConstruction == null) state.draw.isConstruction = false;

  // Mappar för att kunna uppdatera 3D efter slope-commit
  const edgeIdToLine = new Map(); // endast center-edges
  const nodeIdToSphere = new Map();

  // Hjälpare: world-pos för graph-node oavsett lagringsmodell
  function nodeWorldPos(n) {
    if (!n) return { x:0,y:0,z:0 };
    if (n.pos) return n.pos;
    const b = n.base || {x:0,y:0,z:0};
    const o = n.offset || {x:0,y:0,z:0};
    return { x:(b.x??0)+(o.x??0), y:(b.y??0)+(o.y??0), z:(b.z??0)+(o.z??0) };
  }

  const topoOverlay = createTopoOverlay({
    graph,
    nodeIdToSphere,
    addVertexSphere,
    nodeWorldPos,
    COLORS
  });
  const jointOverlay = createJointOverlay({ scene, graph });

  // Idle-markör (vit)
  const idleMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  idleMarker.renderOrder = 2;
  scene.add(idleMarker);

  function setIdleMarkerColor(hex) { idleMarker.material.color.setHex(hex); }

  // ── Initiera verktyg/moder
  slopeTool.init({
    scene, graph, picker, snapper, nodeWorldPos,
    edgeIdToLine, nodeIdToSphere, topoOverlay, jointOverlay,
    setIdleMarkerColor, COLORS, idleMarker
  });
  lineTool.init({
    camera, overlay, snapper,
    graph, modelGroup, picker,
    topoOverlay, jointOverlay,
    nodeWorldPos, edgeIdToLine, nodeIdToSphere,
    COLORS, addVertexSphere,
    setCurrentSpec
  });
  inspect.init({
  camera, renderer3D, overlay, picker, snapper, graph, controls,
  nodeWorldPos, addVertexSphere, COLORS,
  idleMarker, setIdleMarkerColor     // ← lägg till dessa två
});

  const {
    slope,
    clearSlopePreview,
    toggleSlopeMode,
    cycleSlopeMode,
    recomputeSlopePreview,
    commitSlopeIfPreview,
    findGraphNodeIdNear
  } = slopeTool;

  function addVertexSphere(pos, nodeId, color = COLORS.vertex) {
    // om vi redan har en sphere kopplad till noden → uppdatera istället
    if (nodeId && nodeIdToSphere.has(nodeId)) {
      nodeIdToSphere.get(nodeId).position.set(pos.x, pos.y, pos.z);
      return;
    }
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })
    );
    s.renderOrder = 1;
    s.position.copy(pos);
    permanentVertices.add(s);
    if (nodeId) nodeIdToSphere.set(nodeId, s);
  }

  // Public API
  function getStartPoint() { return state.draw.lineStartPoint; }

  function isOnScreenPx(camera, canvas, point3D, marginPx = 20) {
    const v = point3D.clone().project(camera);
    if (v.z < -1 || v.z > 1) return false;
    const x = (v.x + 1) * 0.5 * canvas.width;
    const y = (-v.y + 1) * 0.5 * canvas.height;
    return (x>=marginPx && x<=canvas.width-marginPx && y>=marginPx && y<=canvas.height-marginPx);
  }

  function setCurrentSpec(id, { announce = true } = {}) {
    const spec = getSpecById(id);
    if (!spec) return false;
    state.spec.current = spec.id;
    if (announce) console.info(`[Spec] ${spec.id} (OD ${spec.od}×${spec.wt}, ${spec.material})`);
    return true;
  }

  // Pointer events
 function onMouseMove(e, pickPlaneMesh) {
  if (document.pointerLockElement) {
    if (state.draw.isDrawing && state.draw.hasStart) {
      overlay.setVirtualCursorTo2D({
        x: overlay.virtualCursorPix.x + e.movementX,
        y: overlay.virtualCursorPix.y + e.movementY
      });
    }
    return; // inget hover i draw-läge
  }

  if (slope.active) {
    return slopeTool.handleHover(e); // orange hover i slope-läge
  }

  return inspect.handleHover(e, pickPlaneMesh); // grön hover i inspektionsläge
}
  function onPointerDown(e, pickPlaneMesh) {
    if (e.button !== 0) return;

    // Slope-läge (ingen pointer-lock)
    if (slope.active && !document.pointerLockElement) {
      return slopeTool.onPointerDown(e);
    }
    
    // Vanlig inspektionsklick → starta ritning
    if (!document.pointerLockElement) {
      return inspect.handlePointerDown(e, pickPlaneMesh);
    } else {
      // RITLÄGE: två-klicks
      if (state.draw.isDrawing && state.draw.hasStart && !state.draw.isInteracting) {
        const { end3D, worldLen } = lineTool.predictEndPoint();
        if (worldLen <= 1e-6) return;

        const visible = isOnScreenPx(camera, overlay.canvas, end3D, 20);
        if (!visible) {
          const target = end3D.clone();
          const pos = target.clone().add(state.iso.ISO_OFFSET);
          controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, true);
          return; // första klicket: bara pan
        }
        lineTool.commitIfAny();
      }
    }
  }

  function onKeyDown(e) {
    // Hindra browserns Tab-fokusnavigering när vi är i slope-läget
    if (slope.active) {
      if (slopeTool.onKeyDown(e)) return;
    }

    // Debug toggles i inspektionsläge
    if (!document.pointerLockElement && e.code === 'KeyD') {
      e.preventDefault();
      topoOverlay.toggle();
      if (topoOverlay.isActive()) topoOverlay.update();
      return;
    }
    if (!document.pointerLockElement && e.code === 'KeyJ') {
      e.preventDefault();
      jointOverlay.toggle();
      if (jointOverlay.isActive()) jointOverlay.updateAll();
      return;
    }

    // Ritläge: låt lineTool hantera spec-tangenterna
    if (document.pointerLockElement) {
      if (lineTool.handleKeyDown?.(e)) return;
    }
  }

  function onKeyUp(e, { resetIsoAndFitAll: reset }) {
    if (e.code === 'Escape') {
      // Avbryt slope-läge om aktivt
      if (slope.active) {
        clearSlopePreview();
        slope.preview = null;
        toggleSlopeMode(false);
        return;
      }
      // Avbryt ritning
      state.draw.isDrawing = false;
      state.draw.hasStart = false;
      state.draw.pending = false;
      if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'none';
      if (document.pointerLockElement) document.exitPointerLock();
      reset();
      return;
    }


    // Toggle konstruktionsläge i ritläge
    if (e.code === 'KeyG' && document.pointerLockElement) {
      state.draw.isConstruction = !state.draw.isConstruction;
      return;
    }

    // Slope-läge på/av i inspektionsläge
    if (e.code === 'KeyS' && !document.pointerLockElement) {
      toggleSlopeMode();
      return;
    }
  }

  function onPointerLockChange() {
    if (!document.pointerLockElement) {
      if (state.draw.isDrawing || state.draw.pending || state.draw.hasStart) {
        state.draw.isDrawing = false;
        state.draw.hasStart = false;
        state.draw.pending = false;
        if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'none';
        resetIsoAndFitAll({ scene, modelGroup, controls, camera });
      }
      return;
    }
    if (state.draw.hasStart) {
      if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'block';
      overlay.recenterCursorToStart();
      if (state.draw.pending) {
        state.draw.isDrawing = true;
        state.draw.pending = false;
      }
    }
  }

  function onResize(camera, renderer3D) {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left   = -state.frustumSize * aspect / 2;
    camera.right  =  state.frustumSize * aspect / 2;
    camera.top    =  state.frustumSize / 2;
    camera.bottom = -state.frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer3D.setSize(window.innerWidth, window.innerHeight);
    overlay.setSize(window.innerWidth, window.innerHeight);
    if (state.draw.isDrawing && state.draw.hasStart) overlay.recomputeStart2D(state.draw.lineStartPoint);
  }

  return {
    getStartPoint,
    onMouseMove,
    onPointerDown,
    onKeyDown,
    onKeyUp,
    onPointerLockChange,
    onResize
  };
}

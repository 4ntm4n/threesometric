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
import * as dimTool from '../measure/dimensionTool.js';
import * as splitTool from './tools/split/index.js';

import { getSpecById } from '../catalog/specs.js';
import { createTopoOverlay } from '../debug/topoOverlay.js';
import { createJointOverlay } from '../debug/jointOverlay.js';

import { nodeWorldPos } from '../graph/coords.js';
import { isOnScreenPx } from '../core/camera.js';

// modelrotation
import * as alignment from '../view/alignment.js';

// stateManager & calculator
import { isGraphSolvable, checkGraphSolvable } from '../calculation/stateManager.js';
import { calculateMetricData } from '../calculation/calculator.js';

//Trace logg
import { createGraphTracer } from '../debug/graphTrace.js';

export function createDrawManager({
  scene, camera, renderer3D, controls, overlay, picker, snapper, modelGroup, permanentVertices, graph
}) {
  state.camera = camera;
  state.ui.rendererEl = renderer3D.domElement;

  if (state.draw.isConstruction == null) state.draw.isConstruction = false;

  //debug tracer
  const tracer = createGraphTracer(graph, { label: 'GraphTrace' });

  // Mappar för att kunna uppdatera 3D efter slope-commit
  const edgeIdToLine = new Map(); // endast center-edges
  const nodeIdToSphere = new Map();

  // ────────────────────────────────────────────────────────────
  // Frame-root vi kan rotera som en enhet (allt visuellt under här)
  // ────────────────────────────────────────────────────────────
  const frameRoot = new THREE.Group();
  scene.add(frameRoot);

  function safeReparent(obj){ if (!obj) return; if (obj.parent) obj.parent.remove(obj); frameRoot.add(obj); }
  safeReparent(modelGroup);
  safeReparent(permanentVertices);
  safeReparent(picker.pickables);

  // Idle-markör (vit) – ska också ligga under frameRoot
  const idleMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  idleMarker.renderOrder = 2;
  frameRoot.add(idleMarker);
  function setIdleMarkerColor(hex) { idleMarker.material.color.setHex(hex); }

  // knyt frameRoot under alignGroup
  alignment.attach(scene, frameRoot);

  // 3D-grid som roterar med modellen (XZ-grid t.ex.)
  const helperGrid = new THREE.GridHelper(200, 40, 0x2a9d8f, 0x264653);
  helperGrid.material.opacity = 0.25;
  helperGrid.material.transparent = true;
  helperGrid.visible = false;
  frameRoot.add(helperGrid);

  function enableAlignedGrid(on){
    helperGrid.visible = !!on;
  }

  // ────────────────────────────────────────────────────────────
  // Metric View Group (under frameRoot så den följer alignment)
  // ────────────────────────────────────────────────────────────
  const metricViewGroup = new THREE.Group();
  metricViewGroup.name = 'metricViewGroup';
  metricViewGroup.visible = false; // börjar av
  frameRoot.add(metricViewGroup);

  // mm→world-skala: välj faktor så metrisk modell blir rimlig i scenen
  const MM_TO_WORLD = 0.08; // 1 mm = 0.08 world-units (justera efter behov)

  // snabba helpers
  function disposeGroupChildren(group) {
    while (group.children.length) {
      const obj = group.children.pop();
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) obj.material.dispose?.();
      group.remove(obj);
    }
  }

  function buildMetricLinesFrom(graph, coords) {
    disposeGroupChildren(metricViewGroup);

    // Material (enkelt: center vs construction)
    const matCenter = new THREE.LineBasicMaterial({ linewidth: 1 });
    const matConstr = new THREE.LineDashedMaterial({ linewidth: 1, dashSize: 0.05, gapSize: 0.03 });

    for (const e of graph.allEdges().values()) {
      const a = coords.get(e.a), b = coords.get(e.b);
      if (!a || !b) continue;

      const g = new THREE.BufferGeometry();
      const ax = a.x * MM_TO_WORLD, ay = a.y * MM_TO_WORLD, az = a.z * MM_TO_WORLD;
      const bx = b.x * MM_TO_WORLD, by = b.y * MM_TO_WORLD, bz = b.z * MM_TO_WORLD;
      const pos = new Float32Array([ax, ay, az, bx, by, bz]);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));

      let line;
      if (e.kind === 'construction') {
        line = new THREE.Line(g, matConstr);
        line.computeLineDistances?.();
      } else {
        line = new THREE.Line(g, matCenter);
      }
      metricViewGroup.add(line);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Overlays
  // ────────────────────────────────────────────────────────────
  const topoOverlay = createTopoOverlay({
    graph,
    nodeIdToSphere,
    addVertexSphere,
    nodeWorldPos,
    COLORS
  });
  const jointOverlay = createJointOverlay({ scene, graph });

  // ────────────────────────────────────────────────────────────
  // Initiera verktyg/moder
  // ────────────────────────────────────────────────────────────
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
    setCurrentSpec,
    toGraphSpace: alignment.toGraphSpace,
    isAlignmentActive: alignment.isActive,

    splitEdgeAt: (edgeId, hitWorldPos, opts = {}) =>
      splitTool.splitEdge(graph, edgeId, { hitWorldPos, ...opts }),
   
    onLineCommitted: ({ edgeId, aNodeId, bNodeId }) => {
    tracer.snapshot(`after line commit (edge ${edgeId})`);
  }
  });

  inspect.init({
    camera, renderer3D, overlay, picker, snapper, graph, controls,
    nodeWorldPos, addVertexSphere, COLORS,
    idleMarker, setIdleMarkerColor,
    topoOverlay, jointOverlay,

    // vrid in med animation + slå på roterande grid
    alignToSegment: (a, b, piv, refDir) => {
      enableAlignedGrid(true);
      alignment.alignToSegment(a, b, piv, { animate: true, durationMs: 500, refDir });
    },
    resetAlignment: () => {
      alignment.reset();
      enableAlignedGrid(false);
    }
  });

  dimTool.init({ camera, overlay, graph, edgeIdToLine });

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

  function setCurrentSpec(id, { announce = true } = {}) {
    const spec = getSpecById(id);
    if (!spec) return false;
    state.spec.current = spec.id;
    if (announce) console.info(`[Spec] ${spec.id} (OD ${spec.od}×${spec.wt}, ${spec.material})`);
    return true;
  }

  // ────────────────────────────────────────────────────────────
  // Pointer events
  // ────────────────────────────────────────────────────────────
  function onMouseMove(e, pickPlaneMesh) {
    if (alignment.isAnimating?.()) return;
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
    if (dimTool.isActive()) {
      return dimTool.handleHover(e);
    }
    return inspect.handleHover(e, pickPlaneMesh); // grön hover i inspektionsläge
  }

  function onPointerDown(e, pickPlaneMesh) {
    if (alignment.isAnimating?.()) return;

    if (e.button !== 0) return;

    // Slope-läge (ingen pointer-lock)
    if (slope.active && !document.pointerLockElement) {
      return slopeTool.onPointerDown(e);
    }

    if (!document.pointerLockElement && dimTool.isActive()) {
      return dimTool.onPointerDown(e);
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
    if (!document.pointerLockElement) {
      if (inspect.handleKeyDown?.(e)) return;
    }

    // Ritläge: låt lineTool hantera spec-tangenterna
    if (document.pointerLockElement) {
      if (lineTool.handleKeyDown?.(e)) return;
    }

    // Dimensions mode (inspektionsläge)
    if (!document.pointerLockElement) {
      if (e.code === 'KeyM') {
        e.preventDefault();
        dimTool.toggle();
        return;
      }
      if (dimTool.isActive() && dimTool.onKeyDown(e)) return;
    }
  }

  function onKeyUp(e, { resetIsoAndFitAll: reset }) {
    if (e.code === 'Escape') {
      alignment.reset();
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
    const unlocked = !document.pointerLockElement;

    if (unlocked) {
      alignment.reset(); // nolla in-vridning när vi lämnar ritläget
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

  // ────────────────────────────────────────────────────────────
  // Metric View
  // ────────────────────────────────────────────────────────────
  let metricRequested = false;

  async function updateMetricView() {
    const diag = checkGraphSolvable(graph);
    if (!diag.ok) return false;
    const coords = calculateMetricData(graph);
    if (!coords) return false;
    buildMetricLinesFrom(graph, coords);
    await resetIsoAndFitAll({ scene, modelGroup: metricViewGroup, controls, camera });
    return true;
  }

  function toggleMetricView(visible) {
    metricRequested = !!visible; // <- viktig skillnad
    if (!metricRequested) {
      metricViewGroup.visible = false;
      modelGroup.visible = true;
      return;
    }
    // försök direkt
    updateMetricView().then(ok => {
      metricViewGroup.visible = ok;
      modelGroup.visible = !ok;
    });
  }

  // Försök på varje måttändring när användaren har begärt metrisk vy
  graph.onEdgeDimensionChanged?.((eid) => {
    tracer.snapshot(`after setEdgeDimension (edge ${eid})`);
    if (!metricRequested) return;
    updateMetricView().then(ok => {
      metricViewGroup.visible = ok;
      modelGroup.visible = !ok;
    });
  });




  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────
  return {
    getStartPoint,
    onMouseMove,
    onPointerDown,
    onKeyDown,
    onKeyUp,
    onPointerLockChange,
    onResize,
    // MetricView relaterat
    updateMetricView,
    toggleMetricView,
    getMetricGroup: () => metricViewGroup,
  };
}

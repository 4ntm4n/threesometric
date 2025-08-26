// ──────────────────────────────────────────────────────────────────────────────
// src/draw/drawManager.js  (graph-integrated, no hatching)
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';
import { enterDrawMode, resetIsoAndFitAll } from '../scene/controls.js';
import { state } from '../state/appState.js';
import { angleToIsoDir3D, pixelsPerWorldUnit, snapAngleDeg } from '../core/utils.js';
import { ISO_ANGLES, COLORS } from '../core/constants.js';

export function createDrawManager({
  scene, camera, renderer3D, controls, overlay, picker, snapper, modelGroup, permanentVertices,
  graph // <<< NYTT: injicera grafen
}) {
  state.camera = camera;
  state.ui.rendererEl = renderer3D.domElement;

  // Toggle för konstruktionslinjer (streckade)
  if (state.draw.isConstruction == null) state.draw.isConstruction = false;

  // Lokala maps så vi kan uppdatera från grafen (slope/fall mm)
  const nodeIdToSphere = new Map(); // nodeId -> THREE.Mesh (Sphere)
  const edgeIdToLine   = new Map(); // edgeId -> THREE.Line

  const permanentLines = []; // (legacy, ej längre nödvändig för graf, men behåller)

  // Idle-marker (vit boll)
  const idleMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  idleMarker.renderOrder = 2;
  scene.add(idleMarker);

  function setIdleMarkerColor(hex) {
    idleMarker.material.color.setHex(hex);
  }

  // --- Graph helpers ---------------------------------------------------------

  // Sfär för ny nod; om den finns uppdateras positionen.
  function spawnNodeSphere(nodeId, pos, color = COLORS.vertex) {
    let s = nodeIdToSphere.get(nodeId);
    if (!s) {
      s = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })
      );
      s.renderOrder = 1;
      s.userData.nodeId = nodeId;
      nodeIdToSphere.set(nodeId, s);
      permanentVertices.add(s);
    }
    s.position.set(pos.x, pos.y, pos.z);
    return s;
  }

  // Beräkna "världsposition" för en nod = base + offset
  function worldPosOfNode(n) {
    return new THREE.Vector3(
      n.base.x + (n.offset?.x || 0),
      n.base.y + (n.offset?.y || 0),
      n.base.z + (n.offset?.z || 0),
    );
  }

  // Hämta/Skapa nodeId för en given position
  function ensureNodeIdAt(pos) {
    const { node, created } = graph.getOrCreateNodeAt(pos);
    // skapa/uppdatera sfär om ny (eller om vi i framtiden vill alltid resynca)
    if (created) spawnNodeSphere(node.id, node.base);
    return node.id;
  }

  // Skapa eller uppdatera THREE.Line för en graf-edge
  function ensureLineForEdge(edge) {
    const aNode = graph.getNode(edge.a);
    const bNode = graph.getNode(edge.b);
    if (!aNode || !bNode) return null;

    const A = worldPosOfNode(aNode);
    const B = worldPosOfNode(bNode);

    let line = edgeIdToLine.get(edge.id);
    if (!line) {
      const geom = new THREE.BufferGeometry().setFromPoints([A, B]);
      const mat = edge.kind === 'construction'
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

      line = new THREE.Line(geom, mat);
      if (edge.kind === 'construction' && line.computeLineDistances) line.computeLineDistances();
      line.renderOrder = 1;
      modelGroup.add(line);
      edgeIdToLine.set(edge.id, line);
    } else {
      // Uppdatera befintlig geometri
      line.geometry.setFromPoints([A, B]);
      if (edge.kind === 'construction' && line.computeLineDistances) line.computeLineDistances();
      line.geometry.computeBoundingSphere?.();
    }

    return line;
  }

  // Publik sync-hook (t.ex. efter slope): uppdatera sfärer/linjer/pickables
  function syncFromGraph({ rebuildPickables = true } = {}) {
    // Noder → sfärer
    for (const n of graph.nodes.values()) {
      const p = worldPosOfNode(n);
      spawnNodeSphere(n.id, p, COLORS.vertex);
    }

    // Ev. bygg om alla pick-cylindrar från scratch (enkelt & robust)
    if (rebuildPickables && picker?.pickables) {
      // rensa
      for (let i = picker.pickables.children.length - 1; i >= 0; --i) {
        const ch = picker.pickables.children[i];
        picker.pickables.remove(ch);
        ch.geometry?.dispose?.();
        ch.material?.dispose?.();
      }
    }

    // Kanter → linjer (+ pick-cyl)
    for (const e of graph.edges.values()) {
      const line = ensureLineForEdge(e);
      if (rebuildPickables && line) {
        const aNode = graph.getNode(e.a);
        const bNode = graph.getNode(e.b);
        const A = worldPosOfNode(aNode);
        const B = worldPosOfNode(bNode);
        const pickCyl = picker.makePickCylinder(A, B);
        if (pickCyl) picker.pickables.add(pickCyl);
      }
    }
  }

  // --- Legacy helper (används fortfarande för mousen) ------------------------
  function addVertexSphere(pos, color = COLORS.vertex) {
    // OBS: Legacy helper. Vi vill inte längre duplicera sfärer per klick.
    // Denna lämnas kvar för kompatibilitet men använder spawnNodeSphere
    // när en nod faktiskt är ny.
    const nid = ensureNodeIdAt(pos);
    const node = graph.getNode(nid);
    spawnNodeSphere(nid, node.base, color);
  }

  // Public API till andra moduler
  function getStartPoint() { return state.draw.lineStartPoint; }
  function getGraphBindings() {
    return { nodeIdToSphere, edgeIdToLine, syncFromGraph };
  }

  // Helpers
  function getNDC(e) {
    const rect = renderer3D.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x, y);
  }

  // “På skärm” i pixlar, inte bara frustum
  function isOnScreenPx(camera, canvas, point3D, marginPx = 20) {
    const v = point3D.clone().project(camera);
    if (v.z < -1 || v.z > 1) return false;
    const x = (v.x + 1) * 0.5 * canvas.width;
    const y = (-v.y + 1) * 0.5 * canvas.height;
    return (
      x >= marginPx &&
      x <= canvas.width - marginPx &&
      y >= marginPx &&
      y <= canvas.height - marginPx
    );
  }

  // ——— Förhands-ändpunkt: AXEL-snapp från aktuell startpunkt (båda lägen)
  function predictEndPointAxis() {
    const dx = overlay.virtualCursorPix.x - overlay.start2D.x;
    const dy = overlay.start2D.y - overlay.virtualCursorPix.y;
    const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snapped = snapAngleDeg(rawAngle, ISO_ANGLES);
    const dir3D = angleToIsoDir3D(snapped);
    const ppu = pixelsPerWorldUnit(camera, overlay.canvas, dir3D, state.draw.lineStartPoint);
    const pixelsLen = Math.hypot(dx, dy);
    const worldLen = pixelsLen / ppu;
    const end3D = state.draw.lineStartPoint.clone().add(dir3D.multiplyScalar(worldLen));
    return { end3D, worldLen, snappedToNode: false };
  }

  // ——— VANLIGT läge = nod-snapp (diagonal) om nära, annars axel-snapp
  function predictEndPointNormal() {
    const snapPos = snapper.findNearestNode2D(overlay.virtualCursorPix.x, overlay.virtualCursorPix.y);
    if (snapPos && snapPos.distanceToSquared(state.draw.lineStartPoint) > 1e-10) {
      const end3D = snapPos.clone();
      const worldLen = Math.sqrt(state.draw.lineStartPoint.distanceToSquared(end3D));
      return { end3D, worldLen, snappedToNode: true };
    }
    return predictEndPointAxis();
  }

  // ——— Konstruktionsläge: ALLTID axel-snapp
  function predictEndPointConstruction() {
    return predictEndPointAxis();
  }

  function predictEndPoint() {
    return state.draw.isConstruction ? predictEndPointConstruction() : predictEndPointNormal();
  }

  // Liten fabrik för att lägga till både graf-edge och THREE-linje
  function addGraphEdgeAndModelLine(aId, bId, kind) {
    const edge = graph.addEdge(aId, bId, kind);
    if (!edge) return null;

    // Skapa/uppdatera THREE.Line via grafen (så blir material korrekt)
    const line = ensureLineForEdge(edge);

    // Pick-cylinder
    const aNode = graph.getNode(aId);
    const bNode = graph.getNode(bId);
    const A = worldPosOfNode(aNode);
    const B = worldPosOfNode(bNode);
    const pickCyl = picker.makePickCylinder(A, B);
    if (pickCyl) picker.pickables.add(pickCyl);

    return edge;
  }

  function commitIfAny() {
    const { end3D, worldLen } = predictEndPoint();
    if (worldLen <= 1e-6) return;

    // 1) node-ids
    const aId = state.draw.startNodeId ?? ensureNodeIdAt(state.draw.lineStartPoint);
    const bId = ensureNodeIdAt(end3D);

    // 2) edge + line
    const kind = state.draw.isConstruction ? 'construction' : 'center';
    const edge = addGraphEdgeAndModelLine(aId, bId, kind);
    if (!edge) return;

    // 3) flytta rit-start till slutnoden
    state.draw.lineStartPoint.copy(end3D);
    state.draw.startNodeId = bId;

    // 4) centrera cursor
    overlay.recenterCursorToStart();
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
    } else {
      // INSPEKTION: prio = Nod-snap → Linje → Plan
      const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
      if (nodeSnapPos) {
        idleMarker.position.copy(nodeSnapPos);
        setIdleMarkerColor(0x80ff80);
        return;
      } else {
        setIdleMarkerColor(0xffffff);
      }

      const ndc = getNDC(e);
      picker.raycaster.setFromCamera(ndc, camera);

      // Linje-träff
      const hits = picker.raycaster.intersectObjects(picker.pickables.children, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const seg = hit.object.userData;
        const nearest = picker.closestPointOnSegment(hit.point, seg.start, seg.end);
        idleMarker.position.copy(nearest);
        return;
      }

      // Plan
      const hit = picker.raycaster.intersectObject(pickPlaneMesh);
      if (hit.length) idleMarker.position.copy(hit[0].point);
    }
  }

  function onPointerDown(e, pickPlaneMesh) {
    if (e.button !== 0) return;

    if (!document.pointerLockElement) {
      // INSPEKTION: klick = välj startpunkt (nod → linje → plan)
      const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
      if (nodeSnapPos) {
        state.draw.lineStartPoint.copy(nodeSnapPos);
        // Säkra nodeId & ev. sfär (om ny)
        state.draw.startNodeId = ensureNodeIdAt(state.draw.lineStartPoint);
        return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
      }

      const ndc = getNDC(e);
      picker.raycaster.setFromCamera(ndc, camera);

      // Linje-träff
      const hits = picker.raycaster.intersectObjects(picker.pickables.children, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const seg = hit.object.userData;
        const nearest = picker.closestPointOnSegment(hit.point, seg.start, seg.end);
        state.draw.lineStartPoint.copy(nearest);
        state.draw.startNodeId = ensureNodeIdAt(state.draw.lineStartPoint);
        return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
      }

      // Plan
      const hit = picker.raycaster.intersectObject(pickPlaneMesh);
      if (hit.length) {
        state.draw.lineStartPoint.copy(hit[0].point);
        state.draw.startNodeId = ensureNodeIdAt(state.draw.lineStartPoint);
        return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
      }
    } else {
      // RITLÄGE: två-klicks – 1) pan till mål om off-screen, 2) commit om on-screen
      if (state.draw.isDrawing && state.draw.hasStart && !state.draw.isInteracting) {
        const { end3D, worldLen } = predictEndPoint();
        if (worldLen <= 1e-6) return;

        const visible = isOnScreenPx(camera, overlay.canvas, end3D, 20);
        if (!visible) {
          const target = end3D.clone();
          const pos = target.clone().add(state.iso.ISO_OFFSET);
          controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, true);
          return; // första klicket: bara pan
        }

        // andra klicket: commit
        commitIfAny();
      }
    }
  }

  function onKeyUp(e, { resetIsoAndFitAll: reset }) {
    if (e.code === 'Escape') {
      // Avbryt helt direkt
      state.draw.isDrawing = false;
      state.draw.hasStart = false;
      state.draw.pending = false;
      state.draw.startNodeId = null;
      if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'none';
      if (document.pointerLockElement) document.exitPointerLock();
      reset();
      return;
    }

    // Toggle konstruktionsläge (streckad) i ritläge
    if (e.code === 'KeyG' && document.pointerLockElement) {
      state.draw.isConstruction = !state.draw.isConstruction;
      return;
    }
  }

  function onPointerLockChange() {
    // Om pointer lock släpps (t.ex. ESC i draw-läge), behandla som full cancel
    if (!document.pointerLockElement) {
      if (state.draw.isDrawing || state.draw.pending || state.draw.hasStart) {
        state.draw.isDrawing = false;
        state.draw.hasStart = false;
        state.draw.pending = false;
        state.draw.startNodeId = null;
        if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'none';
        // Gör ISO-fit & gå till inspect – direkt
        resetIsoAndFitAll({ scene, modelGroup, controls, camera });
      }
      return;
    }

    // Lock aktiverat → visa virtuell cursor & starta ritning om pending
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

  // Exponera även sync/hookar för slope etc.
  return {
    getStartPoint,
    getGraphBindings, // { nodeIdToSphere, edgeIdToLine, syncFromGraph }
    syncFromGraph,    // direktmetod om du vill kalla utan att plocka bindings

    onMouseMove,
    onPointerDown,
    onKeyUp,
    onPointerLockChange,
    onResize
  };
}

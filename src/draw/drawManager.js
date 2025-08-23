// ──────────────────────────────────────────────────────────────────────────────
// src/draw/drawManager.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';
import { enterDrawMode } from '../scene/controls.js';
import { state } from '../state/appState.js';
import { angleToIsoDir3D, pixelsPerWorldUnit, snapAngleDeg } from '../core/utils.js';
import { ISO_ANGLES, COLORS } from '../core/constants.js';

export function createDrawManager({
  scene, camera, renderer3D, controls, overlay, picker, snapper, modelGroup, permanentVertices
}) {
  state.camera = camera;
  state.ui.rendererEl = renderer3D.domElement;

  const permanentLines = [];

  const idleMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  idleMarker.renderOrder = 2;
  scene.add(idleMarker);

  function setIdleMarkerColor(hex) {
    idleMarker.material.color.setHex(hex);
  }

  function addVertexSphere(pos, color = COLORS.vertex) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })
    );
    s.renderOrder = 1;
    s.position.copy(pos);
    permanentVertices.add(s);
  }

  // Public API
  function getStartPoint() {
    return state.draw.lineStartPoint;
  }

  // Pointer events (used from input)
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

  function getNDC(e) {
    const rect = renderer3D.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x, y);
  }

  // Pixel-synlighet med marginal: “på skärm”, inte bara frustum
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

  // Beräkna tänkt slutpunkt (utan commit)
  function predictEndPoint() {
    const dx = overlay.virtualCursorPix.x - overlay.start2D.x;
    const dy = overlay.start2D.y - overlay.virtualCursorPix.y;
    const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snapped = snapAngleDeg(rawAngle, ISO_ANGLES);
    const dir3D = angleToIsoDir3D(snapped);
    const ppu = pixelsPerWorldUnit(camera, overlay.canvas, dir3D, state.draw.lineStartPoint);
    const pixelsLen = Math.hypot(dx, dy);
    const worldLen = pixelsLen / ppu;
    const end3D = state.draw.lineStartPoint.clone().add(dir3D.multiplyScalar(worldLen));
    return { end3D, worldLen };
  }

  function commitIfAny() {
    const { end3D, worldLen } = predictEndPoint();
    if (worldLen <= 1e-6) return;

    const geom = new THREE.BufferGeometry().setFromPoints([state.draw.lineStartPoint, end3D]);
    const line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false })
    );
    line.renderOrder = 1;
    modelGroup.add(line);
    permanentLines.push(line);
    addVertexSphere(end3D, COLORS.vertex);

    const pickCyl = picker.makePickCylinder(state.draw.lineStartPoint, end3D);
    if (pickCyl) picker.pickables.add(pickCyl);

    state.draw.lineStartPoint.copy(end3D);
    // Ingen auto-pan här – två-klicks-logic sköter pan före commit
    overlay.recenterCursorToStart();
  }

  function onPointerDown(e, pickPlaneMesh) {
    if (e.button !== 0) return;

    if (!document.pointerLockElement) {
      // INSPEKTION: klick = välj startpunkt (nod → linje → plan)
      const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
      if (nodeSnapPos) {
        state.draw.lineStartPoint.copy(nodeSnapPos);
        addVertexSphere(state.draw.lineStartPoint, COLORS.vertex);
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
        addVertexSphere(state.draw.lineStartPoint, COLORS.vertex);
        return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
      }

      // Plan
      const hit = picker.raycaster.intersectObject(pickPlaneMesh);
      if (hit.length) {
        state.draw.lineStartPoint.copy(hit[0].point);
        addVertexSphere(state.draw.lineStartPoint, COLORS.vertex);
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

  function onKeyUp(e, { resetIsoAndFitAll }) {
    if (e.code === 'Escape') {
      state.draw.isDrawing = false;
      state.draw.hasStart = false;
      state.draw.pending = false;
      state.ui.virtualCursor.style.display = 'none';
      if (document.pointerLockElement) document.exitPointerLock();
      resetIsoAndFitAll();
    }
  }

  function onPointerLockChange() {
    if (!document.pointerLockElement) {
      state.ui.virtualCursor.style.display = 'none';
    } else {
      if (state.draw.hasStart) {
        state.ui.virtualCursor.style.display = 'block';
        overlay.recenterCursorToStart();
        if (state.draw.pending) {
          state.draw.isDrawing = true;
          state.draw.pending = false;
        }
      }
    }
  }

  function onResize(camera, renderer3D) {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -state.frustumSize * aspect / 2;
    camera.right = state.frustumSize * aspect / 2;
    camera.top = state.frustumSize / 2;
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
    onKeyUp,
    onPointerLockChange,
    onResize
  };
}

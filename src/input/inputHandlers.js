// ──────────────────────────────────────────────────────────────────────────────
// src/input/inputHandlers.js
// ──────────────────────────────────────────────────────────────────────────────
import { state } from '../state/appState.js';
import { resetIsoAndFitAll as resetFitInternal } from '../scene/controls.js';

export function installInputHandlers(ctx) {
  const { renderer3D, controls, draw, pickPlaneMesh, camera } = ctx;
  state.frustumSize = state.frustumSize || 20;
  state.camera = camera;

  function onMouseMove(e) { draw.onMouseMove(e, pickPlaneMesh); }
  function onPointerDown(e) { draw.onPointerDown(e, pickPlaneMesh); }
  function onKeyUp(e) { draw.onKeyUp(e, { resetIsoAndFitAll: () => resetFitInternal({ ...ctx }) }); }
  function onPointerLockChange() { draw.onPointerLockChange(); }
  function onResize() { draw.onResize(camera, renderer3D); }

  renderer3D.domElement.addEventListener('mousemove', onMouseMove, false);
  renderer3D.domElement.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keyup', onKeyUp, false);
  window.addEventListener('resize', onResize, false);
  document.addEventListener('pointerlockchange', onPointerLockChange, false);
}

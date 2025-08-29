// ──────────────────────────────────────────────────────────────────────────────
// src/input/inputHandlers.js
// ──────────────────────────────────────────────────────────────────────────────
import { state } from '../state/appState.js';
import { FRUSTUM_SIZE } from '../core/constants.js';
import { resetIsoAndFitAll as resetFitInternal } from '../scene/controls.js';

export function installInputHandlers(ctx) {
  const { renderer3D, draw, pickPlaneMesh, camera } = ctx;

  // Init global state
  if (state.frustumSize == null) state.frustumSize = FRUSTUM_SIZE;
  state.camera = camera;

  // En stabil reset-funktion som inte skapas på nytt vid varje keyup
  const reset = () => resetFitInternal({ ...ctx });

  const onKeyDownCapture = true; // viktigt för Tab: fånga före browsern
  const onKeyDown = (e) => {
    // proxar till drawManager; kräver att drawManager exponerar onKeyDown
    if (draw.onKeyDown) draw.onKeyDown(e);
  };

  // Handlers
  const onMouseMove = (e) => draw.onMouseMove(e, pickPlaneMesh);
  const onPointerDownCapture = true; // vi vill få pointerdown före ev. andra listeners
  const onPointerDown = (e) => draw.onPointerDown(e, pickPlaneMesh);
  const onKeyUp = (e) => draw.onKeyUp(e, { resetIsoAndFitAll: reset });
  const onPointerLockChange = () => draw.onPointerLockChange();
  const onResize = () => draw.onResize(camera, renderer3D);

  // Bind
  renderer3D.domElement.addEventListener('mousemove', onMouseMove, false);
  renderer3D.domElement.addEventListener('pointerdown', onPointerDown, onPointerDownCapture);
  window.addEventListener('keydown', onKeyDown, onKeyDownCapture);
  window.addEventListener('keyup', onKeyUp, false);
  window.addEventListener('resize', onResize, false);
  document.addEventListener('pointerlockchange', onPointerLockChange, false);

  // Returnera en cleanup-funktion om du vill kunna avbinda senare
  return () => {
  renderer3D.domElement.removeEventListener('mousemove', onMouseMove, false);
  renderer3D.domElement.removeEventListener('pointerdown', onPointerDown, onPointerDownCapture);
  window.removeEventListener('keydown', onKeyDown, onKeyDownCapture); // ← rätta denna rad
  window.removeEventListener('keyup', onKeyUp, false);
  window.removeEventListener('resize', onResize, false);
  document.removeEventListener('pointerlockchange', onPointerLockChange, false);
  };

}

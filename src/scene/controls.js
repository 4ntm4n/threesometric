// ──────────────────────────────────────────────────────────────────────────────
// src/scene/controls.js
// ──────────────────────────────────────────────────────────────────────────────
import { CameraControls, THREE } from '../platform/three.js';
import { state } from '../state/appState.js';
import { BASELINE_BOUNDS } from '../core/constants.js';
import { fitBoxOrthoIso } from './fit.js';

export function createControls(camera, domElement) {
  const controls = new CameraControls(camera, domElement);
  controls.enabled = true;
  controls.mouseButtons.left   = CameraControls.ACTION.NONE;
  controls.mouseButtons.middle = CameraControls.ACTION.TRUCK;
  controls.mouseButtons.right  = CameraControls.ACTION.ROTATE;
  controls.minZoom = 0.1;
  controls.maxZoom = 10;
  controls.smoothTime = 0.05;
  controls.draggingSmoothTime = 0.01;
  controls.truckSpeed = 4.0;
  controls.dollyToCursor = true;

  controls.addEventListener('controlstart', () => { 
    state.draw.isInteracting = true;  
  });
  controls.addEventListener('control', () => {
    // overlay sync sker i main
  });
  controls.addEventListener('controlend', () => { 
    state.draw.isInteracting = false; 
  });

  return controls;
}

export function lookIsoAt({ controls, target, smooth = false }) {
  const pos = target.clone().add(state.iso.ISO_OFFSET);
  return controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, smooth);
}

export async function resetIsoAndFitAll({ scene, modelGroup, controls, camera }) {
  const modelBox = new THREE.Box3().setFromObject(modelGroup);
  const fitBox = modelBox.isEmpty() ? BASELINE_BOUNDS.clone() : modelBox.union(BASELINE_BOUNDS.clone());
  await fitBoxOrthoIso({ box: fitBox, controls, camera, paddingRatio: 0.08, smooth: true });
  await enterInspectMode({ controls });
}

export function enterInspectMode({ controls, runIsoFit=false }) {
  controls.minPolarAngle   = 0.01;
  controls.maxPolarAngle   = Math.PI - 0.01;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.mouseButtons.right = CameraControls.ACTION.ROTATE;
  controls.dollyToCursor = true;
  controls.enabled = true;
  const el = document.pointerLockElement;
  if (el) document.exitPointerLock();
  if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'none';
  return Promise.resolve();
}

export function enterDrawMode({ controls, startPoint }) {
  state.draw.pending = true;
  state.draw.hasStart = true;

  controls.minPolarAngle   = state.iso.ISO_PHI;
  controls.maxPolarAngle   = state.iso.ISO_PHI;
  controls.minAzimuthAngle = state.iso.ISO_THETA;
  controls.maxAzimuthAngle = state.iso.ISO_THETA;
  controls.mouseButtons.right = CameraControls.ACTION.NONE;
  controls.dollyToCursor = false;
  controls.enabled = true;

  return lookIsoAt({ controls, target: startPoint, smooth: true }).then(() => {
    state.ui.rendererEl.requestPointerLock();
  });
}

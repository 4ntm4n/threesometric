// ──────────────────────────────────────────────────────────────────────────────
// src/scene/controls.js
// ──────────────────────────────────────────────────────────────────────────────
import { CameraControls, THREE } from '../platform/three.js';
import { state } from '../state/appState.js';
// BASELINE_BOUNDS tas bort ur reset-fit (vi vill bara passa modellen)
// import { BASELINE_BOUNDS } from '../core/constants.js';
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

/**
 * Fit-to-screen för enbart användarens modell (linjer/vertices) – inte grid.
 * Mindre padding för att inte zooma ut "för mycket".
 */
export async function resetIsoAndFitAll({ modelGroup, controls, camera }) {
  // 1) Beräkna bbox från ENDAST modelGroup (grid ligger inte här)
  const modelBox = new THREE.Box3().setFromObject(modelGroup);

  // 2) Fallback när modellen är tom → liten låda runt origo
  let fitBox;
  if (modelBox.isEmpty()) {
    const R = 2; // litet neutralt område
    fitBox = new THREE.Box3(
      new THREE.Vector3(-R, -R, -R),
      new THREE.Vector3( R,  R,  R)
    );
  } else {
    // 3) Säkerhetsmarginal för extremt tunna boxar (undvik width/height≈0)
    fitBox = modelBox.clone();
    const EPS = 0.01; // litet påslag i world units
    fitBox.expandByScalar(EPS);
  }

  // 4) Mindre padding än tidigare (0.04 istället för 0.08)
  await fitBoxOrthoIso({ box: fitBox, controls, camera, paddingRatio: 0.04, smooth: true });

  // 5) Gå till inspektionsläge (rotation på, dollyToCursor på)
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
  if (state.ui?.virtualCursor) state.ui.virtualCursor.style.display = 'none';
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

// ──────────────────────────────────────────────────────────────────────────────
// src/scene/fit.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';
import { state } from '../state/appState.js';

export function computeIsoAnglesFromCamera(camera) {
  const ISO_TARGET0 = new THREE.Vector3(0,0,0);
  const ISO_OFFSET  = camera.position.clone().sub(ISO_TARGET0);
  const sph = new THREE.Spherical().setFromVector3(ISO_OFFSET.clone());
  return { ISO_OFFSET, ISO_THETA: sph.theta, ISO_PHI: sph.phi };
}

export async function fitBoxOrthoIso({ box, controls, camera, paddingRatio=0.08, smooth=true }) {
  const prev = {
    minPolar: controls.minPolarAngle, maxPolar: controls.maxPolarAngle,
    minAzim: controls.minAzimuthAngle, maxAzim: controls.maxAzimuthAngle,
    rightMouse: controls.mouseButtons.right,
    dollyToCursor: controls.dollyToCursor,
  };
  controls.minPolarAngle = controls.maxPolarAngle = state.iso.ISO_PHI;
  controls.minAzimuthAngle = controls.maxAzimuthAngle = state.iso.ISO_THETA;
  controls.mouseButtons.right = 0;
  controls.dollyToCursor = true;

  const target = box.getCenter(new THREE.Vector3());
  const pos = target.clone().add(state.iso.ISO_OFFSET);
  await controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, smooth);

  camera.updateMatrixWorld(true);
  const view = camera.matrixWorldInverse;
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  let minX=+Infinity, maxX=-Infinity, minY=+Infinity, maxY=-Infinity;
  for (const w of corners) {
    const v = w.clone().applyMatrix4(view);
    minX = Math.min(minX, v.x);  maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);  maxY = Math.max(maxY, v.y);
  }
  const widthWorld  = maxX - minX;
  const heightWorld = maxY - minY;

  const baseWidth  = (camera.right - camera.left);
  const baseHeight = (camera.top - camera.bottom);
  const padFactor = 1 + paddingRatio * 2;

  const needZoomX = widthWorld  > 0 ? (baseWidth  / (widthWorld  * padFactor)) : controls.maxZoom;
  const needZoomY = heightWorld > 0 ? (baseHeight / (heightWorld * padFactor)) : controls.maxZoom;

  let targetZoom = Math.min(needZoomX, needZoomY);
  targetZoom = Math.min(Math.max(targetZoom, controls.minZoom), controls.maxZoom);
  await controls.zoomTo(targetZoom, smooth);

  // restore
  controls.minPolarAngle   = prev.minPolar;
  controls.maxPolarAngle   = prev.maxPolar;
  controls.minAzimuthAngle = prev.minAzim;
  controls.maxAzimuthAngle = prev.maxAzim;
  controls.mouseButtons.right = prev.rightMouse;
  controls.dollyToCursor = prev.dollyToCursor;
}

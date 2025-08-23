// ──────────────────────────────────────────────────────────────────────────────
// src/core/utils.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js'

export function projectTo2D(camera, canvas, v3) {
  const v = v3.clone().project(camera);
  return { x: (v.x + 1) * 0.5 * canvas.width, y: (-v.y + 1) * 0.5 * canvas.height };
}

export function getNDCFromEvent(rendererEl, e) {
  const rect = rendererEl.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return new THREE.Vector2(x, y);
}

export function isPointInFrustum(camera, point3D) {
  const v = point3D.clone().project(camera);
  return v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1 && v.z >= -1 && v.z <= 1;
}

export function snapAngleDeg(rawAngle, allowedAngles) {
  const norm = ((rawAngle % 360) + 360) % 360;
  let best = allowedAngles[0], bestDiff = 1e9;
  for (const a of allowedAngles) {
    const d = Math.min(Math.abs(norm - a), 360 - Math.abs(norm - a));
    if (d < bestDiff) { bestDiff = d; best = a; }
  }
  return best;
}

export function angleToIsoDir3D(angleDeg) {
  const dirs = {
    330: new THREE.Vector3( 1,  0,  0),
     30: new THREE.Vector3( 0,  0, -1),
     90: new THREE.Vector3( 0,  1,  0),
    150: new THREE.Vector3(-1,  0,  0),
    210: new THREE.Vector3( 0,  0,  1),
    270: new THREE.Vector3( 0, -1,  0),
  };
  return dirs[angleDeg].clone();
}

export function pixelsPerWorldUnit(camera, canvas, dir3D, origin3D) {
  const step = 1;
  const p0 = projectTo2D(camera, canvas, origin3D);
  const p1 = projectTo2D(camera, canvas, origin3D.clone().add(dir3D.clone().normalize().multiplyScalar(step)));
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const d = Math.hypot(dx, dy);
  return d < 1e-6 ? 1e-6 : d;
}
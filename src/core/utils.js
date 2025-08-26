// ──────────────────────────────────────────────────────────────────────────────
// src/core/utils.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';

// Intern hjälpare: godta Vector3 ELLER plain {x,y,z}
function toVector3(v) {
  if (v && v.isVector3) return v;
  if (v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
    return new THREE.Vector3(v.x, v.y, v.z);
  }
  throw new TypeError('Expected THREE.Vector3 or plain {x,y,z}');
}

export function projectTo2D(camera, canvas, v3) {
  const vec = toVector3(v3);
  const v = vec.clone().project(camera);
  return {
    x: (v.x + 1) * 0.5 * canvas.width,
    y: (-v.y + 1) * 0.5 * canvas.height
  };
}

export function getNDCFromEvent(rendererEl, e) {
  const rect = rendererEl.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return new THREE.Vector2(x, y);
}

export function isPointInFrustum(camera, point3D) {
  const v = toVector3(point3D).clone().project(camera);
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
  const v = dirs[angleDeg];
  if (!v) throw new Error(`angleToIsoDir3D: unsupported angle ${angleDeg}`);
  return v.clone();
}

export function pixelsPerWorldUnit(camera, canvas, dir3D, origin3D) {
  const origin = toVector3(origin3D).clone();
  const dir = toVector3(dir3D).clone().normalize();
  const step = 1;

  const p0 = projectTo2D(camera, canvas, origin);
  const p1 = projectTo2D(camera, canvas, origin.add(dir.multiplyScalar(step)));

  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const d = Math.hypot(dx, dy);
  return d < 1e-6 ? 1e-6 : d;
}

// Returnerar NDC-z för en punkt (THREE ortho/persp). Mindre = närmare kameran.
export function ndcZ(camera, v3) {
  const v = (v3 && v3.isVector3)
    ? v3.clone()
    : new THREE.Vector3(v3.x, v3.y, v3.z);
  v.project(camera);
  return v.z;
}
// ──────────────────────────────────────────────────────────────────────────────
// src/pick/picking.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';

export function createPicker(scene) {
  const pickables = new THREE.Group();
  scene.add(pickables);
  const raycaster = new THREE.Raycaster();

  function makePickCylinder(start, end, radius = 0.2) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(radius, radius, len, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.userData = { start: start.clone(), end: end.clone() };
    return mesh;
  }

  function closestPointOnSegment(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / ab.lengthSq()));
    return a.clone().add(ab.multiplyScalar(t));
  }

  return {
    pickables,
    raycaster,
    makePickCylinder,
    closestPointOnSegment,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// src/pick/picking.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';

export function createPicker(scene) {
  const pickables = new THREE.Group();
  scene.add(pickables);
  const raycaster = new THREE.Raycaster();

  // Intern mapping: edgeId -> pick-mesh
  const edgeIdToPick = new Map();

  /**
   * Skapa en osynlig cylinder för picking mellan två punkter.
   * Behåller den gamla signaturen, men kan nu ta ett extra userDataPatch-objekt.
   */
  function makePickCylinder(start, end, radius = 0.2, userDataPatch = null) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if (len <= 1e-9) return null;

    const geom = new THREE.CylinderGeometry(radius, radius, len, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geom, mat);

    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());

    mesh.userData = {
      start: start.clone(),
      end: end.clone(),
      ...(userDataPatch || {})
    };
    return mesh;
  }

  /**
   * Lägg till/ersätt en pick-cylinder kopplad till en edgeId.
   * Lägger automatiskt till den i pickables och i mappingen.
   */
  function addEdgePick(edgeId, start, end, radius = 0.2) {
    // Ta bort ev. gammal
    removeEdgePick(edgeId);

    const mesh = makePickCylinder(start, end, radius, {
      type: 'edge',
      edgeId
    });
    if (!mesh) return null;

    pickables.add(mesh);
    edgeIdToPick.set(edgeId, mesh);
    return mesh;
  }

  /**
   * Ta bort pick-mesh för en viss edgeId om den finns.
   */
  function removeEdgePick(edgeId) {
    const m = edgeIdToPick.get(edgeId);
    if (m) {
      if (m.parent) m.parent.remove(m);
      edgeIdToPick.delete(edgeId);
      return true;
    }
    return false;
  }

  /**
   * Ersätt pick-cylinder för edgeId med ny geometri.
   */
  function replaceEdgePick(edgeId, start, end, radius = 0.2) {
    removeEdgePick(edgeId);
    return addEdgePick(edgeId, start, end, radius);
  }

  /**
   * Hämta pick-mesh för en viss edgeId (eller null).
   */
  function getEdgePick(edgeId) {
    return edgeIdToPick.get(edgeId) || null;
  }

  /**
   * Närmaste punkt på segment (kompat: returnerar bara punkt).
   */
  function closestPointOnSegment(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / ab.lengthSq()));
    return a.clone().add(ab.multiplyScalar(t));
  }

  /**
   * Variant som även returnerar parametern t (0..1).
   */
  function closestPointAndTOnSegment(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const abLenSq = ab.lengthSq();
    if (abLenSq <= 1e-12) return { point: a.clone(), t: 0 };
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / abLenSq));
    const point = a.clone().add(ab.multiplyScalar(t));
    return { point, t };
  }

  return {
    pickables,
    raycaster,

    // Befintlig API
    makePickCylinder,
    closestPointOnSegment,

    // Nya helpers för edge-bundna pick-cylindrar
    addEdgePick,
    removeEdgePick,
    replaceEdgePick,
    getEdgePick,

    // Extra util
    closestPointAndTOnSegment,
  };
}

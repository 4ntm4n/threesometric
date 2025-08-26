// ──────────────────────────────────────────────────────────────────────────────
// src/draw/construction.js
// Streckade "konstlinjer" för att rita fram specialvinklar
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';

export function createConstructionManager(scene) {
  const group = new THREE.Group();
  group.name = 'ConstructionGroup';
  scene.add(group);

  let active = false;
  let points = [];      // [Vector3, ...]
  let segments = [];    // [THREE.Line, ...]

  // material för streckade hjälplinjer
  const mat = new THREE.LineDashedMaterial({
    color: 0x9aa6b2,
    dashSize: 0.35,
    gapSize: 0.22,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });

  function clearGraphics() {
    for (const s of segments) {
      group.remove(s);
      s.geometry.dispose();
    }
    segments.length = 0;
  }

  function setActive(on) {
    if (on === active) return;
    active = on;
    if (!active) {
      points.length = 0;
      clearGraphics();
    }
  }

  function isActive() { return active; }

  function startAt(p) {
    setActive(true);
    points.length = 0;
    clearGraphics();
    points.push(p.clone());
  }

  // Lägg till ett streckat steg (axelriktad eller vad du vill)
  // endP = slutpunkt i world space
  function addStep(endP) {
    if (!active || points.length === 0) return;
    const a = points[points.length - 1];
    const b = endP.clone();
    if (a.distanceToSquared(b) < 1e-10) return;

    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    // Dashed kräver linjedistanser
    geo.computeBoundingSphere();
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 1;
    group.add(line);
    segments.push(line);
    points.push(b);
  }

  // Avbryt allt (t.ex. vid ESC/camera lock loss)
  function cancel() {
    setActive(false);
  }

  // Finalisera: koppla första->sista punkt som en "diagonal" centrumlinje.
  // Returnerar { a, b } eller null om för få punkter.
  function finalize() {
    if (!active || points.length < 2) return null;
    const a = points[0].clone();
    const b = points[points.length - 1].clone();
    // rensa visuellt men lämna aktiv=off
    setActive(false);
    return { a, b };
  }

  // Hjälp om du vill hämta "ankaret" för nästa gummisnodd i guide-läge
  function currentAnchor() {
    if (!active || points.length === 0) return null;
    return points[points.length - 1].clone();
  }

  return {
    group,
    isActive,
    setActive,
    startAt,
    addStep,
    finalize,
    cancel,
    currentAnchor,
    _debug: { points, segments }
  };
}

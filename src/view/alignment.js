// src/view/alignment.js
import { THREE } from '../platform/three.js';

let alignGroup = null;   // parent vi roterar kring pivot
let frameRoot  = null;   // ditt visuella innehåll (modelGroup, pickables, m.m.)

// "aktuellt" tillstånd (uppdateras under animation)
let curQ = new THREE.Quaternion();      // aktuell rotation
let curPivot = new THREE.Vector3();     // aktuell pivot
let curQInv = new THREE.Quaternion();

// mål
let tgtQ = new THREE.Quaternion();
let tgtPivot = new THREE.Vector3();

let active = false;
let animating = false;
let t0 = 0;
let dur = 0;

// internal temp
const _startQ = new THREE.Quaternion();
const _startPivot = new THREE.Vector3();

// --- små hjälpare ---
function wrapPi(a){ return Math.atan2(Math.sin(a), Math.cos(a)); }
function axisFromK(k){
  // k mod 4: 0:+Z, 1:+X, 2:-Z, 3:-X
  const m = ((k % 4) + 4) % 4;
  return new THREE.Vector3(
    m===1 ?  1 : (m===3 ? -1 : 0),
    0,
    m===0 ?  1 : (m===2 ? -1 : 0)
  );
}
function snapKFromAlpha(alpha){
  // alpha = atan2(x, z) i XZ-planet
  return Math.round((2/Math.PI) * alpha); // 0,±1,±2 → 0,±90,180
}
function chooseAxisFromCurrentYawXZ(){
  // Välj målaxel i XZ utifrån nuvarande yaw (stabilt vertikal-fall)
  const fwd = new THREE.Vector3(0,0,1).applyQuaternion(curQ);
  const alphaCur = Math.atan2(fwd.x, fwd.z);
  return axisFromK(snapKFromAlpha(alphaCur));
}

export function attach(scene, rootGroup) {
  frameRoot = rootGroup;
  alignGroup = new THREE.Group();
  scene.add(alignGroup);

  if (frameRoot.parent) frameRoot.parent.remove(frameRoot);
  alignGroup.add(frameRoot);

  // init
  alignGroup.position.set(0,0,0);
  alignGroup.quaternion.identity();
  frameRoot.position.set(0,0,0);
  curQ.identity();
  curQInv.identity();
  curPivot.set(0,0,0);
  active = false;
  animating = false;
}

export function isActive() { return active; }
export function isAnimating() { return animating; }

function applyTransforms() {
  // world = T(pivot) * R(q) * T(-pivot) * child
  alignGroup.position.copy(curPivot);
  alignGroup.quaternion.copy(curQ);
  frameRoot.position.set(-curPivot.x, -curPivot.y, -curPivot.z);
  curQInv.copy(curQ).invert();
}

function tick() {
  if (!animating) return;
  const now = performance.now();
  let u = Math.min(1, (now - t0) / dur);

  // easeInOutQuad
  u = u < 0.5 ? 2*u*u : -1 + (4 - 2*u) * u;

  // Slerp: stöd både nya/äldre THREE
  if (typeof curQ.slerpQuaternions === 'function') {
    curQ.slerpQuaternions(_startQ, tgtQ, u);
  } else {
    curQ.copy(_startQ).slerp(tgtQ, u);
  }

  curPivot.lerpVectors(_startPivot, tgtPivot, u);
  applyTransforms();

  if (u < 1) {
    requestAnimationFrame(tick);
  } else {
    animating = false;
    active = true;
  }
}

/**
 * Rotera så att (a->b) först läggs platt i XZ, sedan snappas till närmaste ±X/±Z.
 * options: { animate?: boolean, durationMs?: number }
 */
export function alignToSegment(a, b, pivot, options = {}) {
  const { animate = true, durationMs = 500 } = options;

  const EPS = 1e-6;
  const Y = new THREE.Vector3(0, 1, 0);

  // 0) Segment
  const d = new THREE.Vector3().subVectors(b, a);
  const L2 = d.lengthSq();
  if (L2 < 1e-12) return;

  const v = d.clone().normalize();

  // 1) Tippa: v → XZ-planet (minsta rotation)
  const vProj = v.clone().sub(Y.clone().multiplyScalar(v.dot(Y)));
  let qFlatten = new THREE.Quaternion();
  let qYaw     = new THREE.Quaternion();

  if (vProj.length() < EPS) {
    // Vertikal special: välj målaxel i XZ från nuvarande yaw, gör en enda minsta rotation
    const targetAxis = chooseAxisFromCurrentYawXZ();
    qFlatten = new THREE.Quaternion().setFromUnitVectors(v, targetAxis);
    qYaw.identity();
  } else {
    const vProjN = vProj.normalize();
    qFlatten = new THREE.Quaternion().setFromUnitVectors(v, vProjN);

    // 2) Yaw i XZ (teckensäker): αt − α efter tippningen
    const v1 = v.clone().applyQuaternion(qFlatten);      // riktning efter tippning
    const alpha = Math.atan2(v1.x, v1.z);                // vinkel i XZ
    const k = snapKFromAlpha(alpha);
    const alphaTarget = k * (Math.PI/2);
    const yaw = wrapPi(alphaTarget - alpha);
    qYaw.setFromAxisAngle(Y, yaw);
  }

  // Slutrotation: först platta ut, sedan yaw
  const qFinal = new THREE.Quaternion().copy(qYaw).multiply(qFlatten);

  // Sätt målrotation och pivot
  tgtQ.copy(qFinal);
  tgtPivot.copy(pivot || a);

  if (!animate) {
    curQ.copy(tgtQ);
    curPivot.copy(tgtPivot);
    applyTransforms();
    active = true;
    animating = false;
    return;
  }

  _startQ.copy(curQ);
  _startPivot.copy(curPivot);
  t0  = performance.now();
  dur = Math.max(0, durationMs);
  animating = true;
  requestAnimationFrame(tick);
}

export function reset() {
  active = false;
  animating = false;
  alignGroup.position.set(0,0,0);
  alignGroup.quaternion.identity();
  frameRoot.position.set(0,0,0);
  curQ.identity();
  curQInv.identity();
  curPivot.set(0,0,0);
}

export function toViewSpace(v) {
  // v_view = pivot + q * (v - pivot)
  return new THREE.Vector3().subVectors(v, curPivot).applyQuaternion(curQ).add(curPivot);
}
export function toGraphSpace(v) {
  // v_graph = pivot + qInv * (v - pivot)
  return new THREE.Vector3().subVectors(v, curPivot).applyQuaternion(curQInv).add(curPivot);
}

// Riktningar (utan translation)
export function toViewDir(dir){ return dir.clone().applyQuaternion(curQ); }
export function toGraphDir(dir){ return dir.clone().applyQuaternion(curQInv); }

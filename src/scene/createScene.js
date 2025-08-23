// ──────────────────────────────────────────────────────────────────────────────
// src/scene/createScene.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';
import { COLORS, FRUSTUM_SIZE } from '../core/constants.js';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    -FRUSTUM_SIZE * aspect / 2,
     FRUSTUM_SIZE * aspect / 2,
     FRUSTUM_SIZE / 2,
    -FRUSTUM_SIZE / 2,
    1e-4,
    1e9
  );
  camera.position.set(50, 50, 50);
  camera.lookAt(0,0,0);

  const renderer3D = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer3D.setSize(window.innerWidth, window.innerHeight);
  renderer3D.sortObjects = true;
  document.body.appendChild(renderer3D.domElement);

  const gridHelper = new THREE.GridHelper(100, 100, COLORS.gridMajor, COLORS.gridMinor);
  gridHelper.renderOrder = 0;
  scene.add(gridHelper);

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  const permanentVertices = new THREE.Group();
  modelGroup.add(permanentVertices);

  const pickPlaneMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  pickPlaneMesh.rotation.x = -Math.PI / 2;
  scene.add(pickPlaneMesh);

  return { scene, camera, renderer3D, modelGroup, permanentVertices, gridHelper, pickPlaneMesh };
}
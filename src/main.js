// ──────────────────────────────────────────────────────────────────────────────
// src/main.js (Dirigent) – graph-integrated via adapter
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from './platform/three.js';

import { createGraph } from './model/graph.js';

import { COLORS, FRUSTUM_SIZE, BASELINE_BOUNDS, ISO_ANGLES } from './core/constants.js';
import { createScene } from './scene/createScene.js';
import { createControls, enterInspectMode, resetIsoAndFitAll } from './scene/controls.js';
import { computeIsoAnglesFromCamera } from './scene/fit.js';
import { createOverlay2D } from './overlay/overlay2d.js';
import { createPicker } from './pick/picking.js';
import { createSnapper } from './snap/snapper.js';
import { createDrawManager } from './draw/drawManager.js';
import { installInputHandlers } from './input/inputHandlers.js';
import { state } from './state/appState.js';

// Init scen, kamera, renderer, grupper
const { scene, camera, renderer3D, modelGroup, permanentVertices, gridHelper, pickPlaneMesh } = createScene();

// Clock
const clock = new THREE.Clock();

// Controls & ISO-params
const controls = createControls(camera, renderer3D.domElement);
const { ISO_OFFSET, ISO_THETA, ISO_PHI } = computeIsoAnglesFromCamera(camera);
state.iso = { ISO_OFFSET, ISO_THETA, ISO_PHI };

// Overlay (2D-canvas + virtuell cursor)
const overlay = createOverlay2D();

// Picker (raycaster + pickables)
const picker = createPicker(scene);

// Snapper (projektera noder till 2D och hitta närmaste)
const snapper = createSnapper(camera, overlay.canvas, permanentVertices);

// Graph (nodes/edges + adjacency)
const graph = createGraph();

// Draw manager (nu med grafen injicerad)
const draw = createDrawManager({
  scene,
  camera,
  renderer3D,
  controls,
  overlay,
  picker,
  snapper,
  modelGroup,
  permanentVertices,
  graph, // <<< viktig
});

// Input
installInputHandlers({
  scene,
  camera,
  renderer3D,
  controls,
  overlay,
  picker,
  snapper,
  draw,
  modelGroup,
  permanentVertices,
  gridHelper,
  pickPlaneMesh
});

// Startläge: ISO-fit + inspektionsläge
(async function init() {
  await enterInspectMode({ controls });
  await resetIsoAndFitAll({ scene, modelGroup, controls, camera });
})();

// Animate
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  controls.update(delta);
  if (state.draw.isDrawing && state.draw.hasStart) {
    overlay.recomputeStart2D(draw.getStartPoint());
  }
  renderer3D.render(scene, camera);
  overlay.draw({ hasStart: state.draw.hasStart, isDrawing: state.draw.isDrawing });
}
animate();

// (valfritt) Exponera för dev-inspektion i konsolen
if (import.meta?.env?.DEV) {
  // t.ex. window.sketch.graph.nodes / edges
  window.sketch = { scene, camera, controls, draw, graph };
}

// ──────────────────────────────────────────────────────────────────────────────
// src/main.js (Dirigent) – add graph + pass to drawManager
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from './platform/three.js';
import { createGraph } from './model/graph.js';

import { createScene } from './scene/createScene.js';
import { createControls, enterInspectMode, resetIsoAndFitAll } from './scene/controls.js';
import { computeIsoAnglesFromCamera } from './scene/fit.js';
import { createOverlay2D } from './overlay/overlay2d.js';
import { createPicker } from './pick/picking.js';
import { createSnapper } from './snap/snapper.js';
import { createDrawManager } from './draw/drawManager.js';
import { installInputHandlers } from './input/inputHandlers.js';
import { state } from './state/appState.js';
//import * as triDerive from './measure/deriveTriangles.js';
import * as metricSolver from './measure/metricSolver.js';

import { createMetricGraphOverlay } from './debug/metricGraphOverlay.js';

// Graph
const graph = createGraph();
window.graph = graph; // (valfritt) för snabb debug i konsolen



//triDerive.init({ graph });
metricSolver.init({ graph });

// Scene
const { scene, camera, renderer3D, modelGroup, permanentVertices, gridHelper, pickPlaneMesh } = createScene();
const clock = new THREE.Clock();

const controls = createControls(camera, renderer3D.domElement);
const { ISO_OFFSET, ISO_THETA, ISO_PHI } = computeIsoAnglesFromCamera(camera);
state.iso = { ISO_OFFSET, ISO_THETA, ISO_PHI };

const overlay = createOverlay2D();
overlay.attachGraph?.(graph);
const picker  = createPicker(scene);
const snapper = createSnapper(camera, overlay.canvas, permanentVertices);

// Draw manager (pass in graph)
const draw = createDrawManager({
  THREE,
  scene,
  camera,
  renderer3D,
  controls,
  overlay,
  picker,
  snapper,
  modelGroup,
  permanentVertices,
  graph,
});

installInputHandlers({ THREE, scene, camera, renderer3D, controls, overlay, picker, snapper, draw, modelGroup, permanentVertices, gridHelper, pickPlaneMesh });

(async function init() {
  await enterInspectMode({ controls });
  await resetIsoAndFitAll({ scene, modelGroup, controls, camera });
})();



// Debug overlay för mentala grafen
const METRIC_DEBUG = createMetricGraphOverlay({
  scene,
  graph,
  mmToWorld: 0.08,   // justera vid behov så att den inte blir jättestor
  visible: true      // börja synlig – eller false om du vill toggla manuellt
});
window.METRIC_DEBUG = METRIC_DEBUG; // så du kan skriva METRIC_DEBUG.toggle() i konsolen

// Uppdatera overlayn när mått ändras
graph.onEdgeDimensionChanged?.(() => {
  METRIC_DEBUG.update();
});

// ... efter att du byggt scenen första gången:
METRIC_DEBUG.update();

// (valfritt) lägg till en enkel toggle med t.ex. F9
window.addEventListener('keydown', (e)=>{
  if (e.code === 'F9') {
    METRIC_DEBUG.toggle();
    METRIC_DEBUG.update();
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update(clock.getDelta());
  if (state.draw.isDrawing && state.draw.hasStart) overlay.recomputeStart2D(draw.getStartPoint());
  renderer3D.render(scene, camera);
  overlay.draw({ hasStart: state.draw.hasStart, isDrawing: state.draw.isDrawing });
}
animate();

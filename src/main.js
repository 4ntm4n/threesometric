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

import * as stateManager from './calculation/stateManager.js';
// Gör funktionen tillgänglig för felsökning i konsolen
window.checkGraphSolvable = stateManager.checkGraphSolvable;

// Graph (ren datamodell / recept)
const graph = createGraph();
window.graph = graph; // (valfritt) för snabb debug i konsolen

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

//Metric View
let metricVisible = false;
window.addEventListener('keydown', async (e) => {
  if (e.code === 'F9') {  // Ändrat från KeyM till F9
    metricVisible = !metricVisible;
    draw.toggleMetricView(metricVisible);
    if (metricVisible) {
      const ok = await draw.updateMetricView();
      if (!ok) {
        // Gick inte att räkna → studsa tillbaka till schematisk
        metricVisible = false;
        draw.toggleMetricView(false);
        // Valfritt: visa ett felmeddelande här
        console.warn("Kunde inte skapa metrisk vy, återgår till schematisk vy.");
      }
    }
  }
});

installInputHandlers({
  THREE, scene, camera, renderer3D, controls,
  overlay, picker, snapper, draw,
  modelGroup, permanentVertices, gridHelper, pickPlaneMesh
});

(async function init() {
  await enterInspectMode({ controls });
  await resetIsoAndFitAll({ scene, modelGroup, controls, camera });
})();

// Render loop (schematisk ritvärld)
function animate() {
  requestAnimationFrame(animate);
  controls.update(clock.getDelta());
  if (state.draw.isDrawing && state.draw.hasStart) overlay.recomputeStart2D(draw.getStartPoint());
  renderer3D.render(scene, camera);
  overlay.draw({ hasStart: state.draw.hasStart, isDrawing: state.draw.isDrawing });
}
animate();

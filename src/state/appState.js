// ──────────────────────────────────────────────────────────────────────────────
// src/state/appState.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';
import { FRUSTUM_SIZE } from '../core/constants.js';

export const state = {
  iso: { ISO_OFFSET: null, ISO_THETA: 0, ISO_PHI: 0 },

  draw: {
    isDrawing: false,
    hasStart: false,
    pending: false,
    isInteracting: false,
    lineStartPoint: new THREE.Vector3(),
  },

  ui: {
    overlayCanvas: null,
    virtualCursor: null,
    rendererEl: null,
  },

  // Aktiv rörspec (används när nya center-edges committas).
  // Värdet är en ID-sträng som matchar src/catalog/specs.js
  spec: {
    current: 'SMS38x1.2',
  },

  camera: null,
  frustumSize: FRUSTUM_SIZE,
};

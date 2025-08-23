// ──────────────────────────────────────────────────────────────────────────────
// src/snap/snapper.js
// ──────────────────────────────────────────────────────────────────────────────
import { projectTo2D } from '../core/utils.js';
import { SNAP_RADIUS_PX } from '../core/constants.js';

export function createSnapper(camera, canvas, permanentVertices) {
  function findNearestNode2D(screenX, screenY) {
    let nearest = null;
    let bestDist = SNAP_RADIUS_PX;
    permanentVertices.children.forEach(node => {
      const pix = projectTo2D(camera, canvas, node.position);
      const dx = pix.x - screenX;
      const dy = pix.y - screenY;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; nearest = node; }
    });
    return nearest ? nearest.position.clone() : null;
  }
  return { findNearestNode2D };
}

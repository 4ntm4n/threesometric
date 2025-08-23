// ──────────────────────────────────────────────────────────────────────────────
// src/overlay/overlay2d.js
// ──────────────────────────────────────────────────────────────────────────────
import { projectTo2D } from '../core/utils.js';
import { state } from '../state/appState.js';

export function createOverlay2D() {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const virtualCursorEl = document.getElementById('virtual-cursor') || (() => {
    const el = document.createElement('div');
    el.id = 'virtual-cursor';
    el.style.position = 'fixed';
    el.style.width = '6px';
    el.style.height = '6px';
    el.style.borderRadius = '50%';
    el.style.background = 'white';
    el.style.pointerEvents = 'none';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  })();

  state.ui.overlayCanvas = canvas;
  state.ui.virtualCursor = virtualCursorEl;

  let start2D = { x: 0, y: 0 };
  let virtualCursorPix = { x: 0, y: 0 };

  function setVirtualCursorTo2D(pix) {
    virtualCursorPix.x = pix.x; virtualCursorPix.y = pix.y;
    const clampedX = Math.max(-9999, Math.min(window.innerWidth + 9999, pix.x));
    const clampedY = Math.max(-9999, Math.min(window.innerHeight + 9999, pix.y));
    virtualCursorEl.style.left = clampedX + 'px';
    virtualCursorEl.style.top  = clampedY + 'px';
  }

  return {
    canvas,
    ctx,
    get start2D() { return start2D; },
    get virtualCursorPix() { return virtualCursorPix; },
    recenterCursorToStart() {
      this.recomputeStart2D(state.draw.lineStartPoint);
      setVirtualCursorTo2D({ x: start2D.x, y: start2D.y });
    },
    setVirtualCursorTo2D,
    recomputeStart2D(worldPoint) {
      start2D = projectTo2D(state.camera, canvas, worldPoint);
    },
    setSize(w,h) {
      canvas.width = w; canvas.height = h;
    },
    draw({ hasStart, isDrawing }) {
      const { ctx } = this;
      ctx.clearRect(0,0,canvas.width, canvas.height);
      if (hasStart) {
        ctx.fillStyle = 'rgba(255,200,200,.9)';
        ctx.beginPath(); ctx.arc(start2D.x, start2D.y, 3, 0, Math.PI*2); ctx.fill();
      }
      if (hasStart && isDrawing) {
        ctx.strokeStyle = 'white'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(start2D.x, start2D.y); ctx.lineTo(virtualCursorPix.x, virtualCursorPix.y); ctx.stroke();
      }
    }
  };
}

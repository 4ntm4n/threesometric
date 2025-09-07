// ──────────────────────────────────────────────────────────────────────────────
// src/overlay/overlay2d.js  (clean, no hatching) + dimension rendering
// ─────────────────────────────────────────────────────────────────────────────-
import { projectTo2D, pixelsPerWorldUnit } from '../core/utils.js';
import { state } from '../state/appState.js';

export function createOverlay2D() {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Graph reference for dimensions overlay
  let _graphRef = null;
  function attachGraph(graph){ _graphRef = graph; }

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

  // ──────────────────────────────────────────────────────────────────────────
  // Dimension rendering helpers
  // ──────────────────────────────────────────────────────────────────────────
  function drawEdgeDimension2D(a3, b3, dim){
    const { mode='aligned', valueMm, label } = dim || {};
    if (typeof valueMm !== 'number') return;

    // 3D→2D
    const pA = projectTo2D(state.camera, canvas, a3);
    const pB = projectTo2D(state.camera, canvas, b3);
    const mid = { x: (pA.x + pB.x)/2, y: (pA.y + pB.y)/2 };

    // Basriktning i 2D
    let t = { x: pB.x - pA.x, y: pB.y - pA.y };

    if (mode !== 'aligned') {
      // Härleder skärmriktning från en liten world-step längs vald axel vid mittpunkten
      const step = 1; // world units
      const mid3 = { x:(a3.x+b3.x)/2, y:(a3.y+b3.y)/2, z:(a3.z+b3.z)/2 };
      const dir3 =
        mode === 'axisX' ? { x: mid3.x + step, y: mid3.y, z: mid3.z } :
        mode === 'axisZ' ? { x: mid3.x, y: mid3.y, z: mid3.z + step } :
                           { x: mid3.x, y: mid3.y + step, z: mid3.z }; // axisY
      const pMid  = projectTo2D(state.camera, canvas, mid3);
      const pMid2 = projectTo2D(state.camera, canvas, dir3);
      t = { x: pMid2.x - pMid.x, y: pMid2.y - pMid.y };
    }

    const L = Math.hypot(t.x, t.y) || 1; t.x/=L; t.y/=L;
    const n = { x: -t.y, y: t.x }; // vänster normal

    // Offset från objektet i pixlar (kan framtida kopplas till pixelsPerWorldUnit om man vill)
    const offset = 14;
    const pA2 = { x: pA.x + n.x*offset, y: pA.y + n.y*offset };
    const pB2 = { x: pB.x + n.x*offset, y: pB.y + n.y*offset };

    // Projektera ändpunkter på dimensionens riktning (för axis*). Aligned använder förskjutna AB direkt.
    function proj(p, origin, dir){
      const vx = p.x - origin.x, vy = p.y - origin.y;
      const s = vx*dir.x + vy*dir.y;
      return { x: origin.x + s*dir.x, y: origin.y + s*dir.y };
    }
    const origin = mid;
    const qA = (mode==='aligned') ? pA2 : proj(pA2, origin, t);
    const qB = (mode==='aligned') ? pB2 : proj(pB2, origin, t);

    // Ritstil
    ctx.save();
    const isDerived = dim?.source === 'derived';
    const hasConflict = !!dim?.conflict;
    ctx.setLineDash(hasConflict ? [2,3] : []);
    ctx.lineWidth = hasConflict ? 2 : 1;
    ctx.strokeStyle = hasConflict ? '#ff6b6b' : (isDerived ? '#9ecbff' : '#ffffff');


    // Förlängningslinjer
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y); ctx.lineTo(qA.x, qA.y);
    ctx.moveTo(pB.x, pB.y); ctx.lineTo(qB.x, qB.y);
    ctx.stroke();

    // Måttlinje
    ctx.beginPath();
    ctx.moveTo(qA.x, qA.y); ctx.lineTo(qB.x, qB.y);
    ctx.stroke();

    // Ticks i ändarna
    const tick = 6;
    function tickAt(pt, dir){
      ctx.moveTo(pt.x - dir.y*tick/2, pt.y + dir.x*tick/2);
      ctx.lineTo(pt.x + dir.y*tick/2, pt.y - dir.x*tick/2);
    }
    ctx.beginPath();
    tickAt(qA, t);
    tickAt(qB, t);
    ctx.stroke();

    // Text
    const txt = `${Number(valueMm).toFixed(2)} mm`;    const midDim = { x: (qA.x + qB.x)/2, y: (qA.y + qB.y)/2 };
    const textOff = 10;
    ctx.font = '12px ui-sans-serif, system-ui, -apple-system';
    ctx.fillStyle = hasConflict ? '#ff6b6b' : (isDerived ? '#9ecbff' : '#ffffff');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, midDim.x + n.x*textOff, midDim.y + n.y*textOff);

    ctx.restore();
  }

  function drawDimensions(){
    if (!_graphRef) return;
    // Rita dimensioner för alla center-kanter som har dim-metadata
    for (const [eid, e] of _graphRef.allEdges()) {
      if (!e || (e.kind !== 'center' && e.kind !== 'construction') || !e.dim || typeof e.dim.valueMm !== 'number') continue;
      try {
        const a3 = _graphRef.getNodeWorldPos(e.a);
        const b3 = _graphRef.getNodeWorldPos(e.b);
        drawEdgeDimension2D(a3, b3, e.dim);
      } catch { /* säkert att ignorera enskilda fel vid ritning */ }
    }
  }

  return {
    canvas,
    ctx,
    attachGraph, // <— exponera så main kan koppla grafen
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

    setSize(w, h) {
      canvas.width = w; canvas.height = h;
    },

    draw({ hasStart, isDrawing }) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // startpunkt
      if (hasStart) {
        ctx.fillStyle = 'rgba(255,200,200,.9)';
        ctx.beginPath();
        ctx.arc(start2D.x, start2D.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // gummisnodd (streckad om konstruktionsläge)
      if (hasStart && isDrawing) {
        const dashed = !!state.draw?.isConstruction;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.strokeStyle = dashed ? '#9aa6b2' : 'white';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(start2D.x, start2D.y);
        ctx.lineTo(virtualCursorPix.x, virtualCursorPix.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // — Måttsättning —
      drawDimensions();
    }
  };
}

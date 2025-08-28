// ──────────────────────────────────────────────────────────────────────────────
// src/overlay/overlay2d.js
// ──────────────────────────────────────────────────────────────────────────────
import { projectTo2D, ndcZ } from '../core/utils.js';
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

  // Centralt justerbar hatching-stil
  const HATCH = {
    spacing: 8,
    color: 'rgba(255,255,255,0.30)',
    width: 2,
    dash: [], // [] = solid, [5,4] = dashed
    phase: 0, // global faslåsningsoffset
  };

  // Hatching mode: 'off' | 'twofield'
  let HATCH_MODE = 'twofield';

  // Lista över committade speciallinjer (behåller API:t)
  // item: { start:{x,y,z}, end:{x,y,z}, path?: [{x,y,z}, ...] }
  const hatchedItems = [];

  // ISO-predicate (om du vill styra när hatching visas)
  let isIsoPredicate = () => true;

  // Rubber band override (valfritt)
  const rubber = { dashed: null, color: null, lineWidth: null };

  function setVirtualCursorTo2D(pix) {
    virtualCursorPix.x = pix.x; virtualCursorPix.y = pix.y;
    const clampedX = Math.max(-9999, Math.min(window.innerWidth + 9999, pix.x));
    const clampedY = Math.max(-9999, Math.min(window.innerHeight + 9999, pix.y));
    virtualCursorEl.style.left = `${clampedX}px`;
    virtualCursorEl.style.top  = `${clampedY}px`;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  const EPS = 1e-6;
  const almostZero = (v, eps = EPS) => Math.abs(v) < eps;

  function lineSideSign(S2, E2, P2) {
    // tecken för vilket sida P ligger på relativt linjen S→E
    const SE = { x: E2.x - S2.x, y: E2.y - S2.y };
    const val = SE.x * (P2.y - S2.y) - SE.y * (P2.x - S2.x);
    const s = Math.sign(val);
    return s === 0 ? 1 : s;
  }

  function hatchPolygon(poly, axisEnd3) {
    if (!poly || poly.length < 3) return;

    // bestäm riktning u (parallell med projicerad axel) och normal n
    const p0 = projectTo2D(state.camera, canvas, {x:0,y:0,z:0});
    const pA = projectTo2D(state.camera, canvas, axisEnd3);
    let ux = pA.x - p0.x, uy = pA.y - p0.y;
    let uLen = Math.hypot(ux, uy); if (uLen < EPS) { ux = 1; uy = 0; uLen = 1; }
    ux /= uLen; uy /= uLen;
    const nx = -uy, ny = ux;

    // s-intervall endast över polygonens hörn
    let sMin = +Infinity, sMax = -Infinity;
    for (const P of poly) {
      const s = P.x * nx + P.y * ny;
      if (s < sMin) sMin = s;
      if (s > sMax) sMax = s;
    }
    const startS = Math.floor((sMin - HATCH.phase) / HATCH.spacing) * HATCH.spacing + HATCH.phase;
    const L = Math.max(canvas.width, canvas.height) * 2;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i=1; i<poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.clip('evenodd');

    for (let s = startS; s <= sMax + EPS; s += HATCH.spacing) {
      const px = nx*s, py = ny*s;
      ctx.beginPath();
      ctx.moveTo(px - ux*L, py - uy*L);
      ctx.lineTo(px + ux*L, py + uy*L);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Bygg två “klassiska” fält:
  //  - vertikal tri:  S → Pv → E   (Pv = {Sx,Ey,Sz})  → stående (proj Y)
  //  - planar  tri:   S → Pp → E   (Pp = {Ex,Sy,Ez})  → liggande (proj X)
  // och klipp dem till varsin sida om SE för att undvika överlapp.
 // Replace the whole function with this:
// Replace your drawHatchingTwoField with this version
function drawHatchingTwoField(start3, end3) {
  const S2 = projectTo2D(state.camera, canvas, start3);
  const E2 = projectTo2D(state.camera, canvas, end3);

  const dx = end3.x - start3.x;
  const dy = end3.y - start3.y;
  const dz = end3.z - start3.z;

  const planarOnly   = Math.abs(dy) < 1e-6 && (Math.abs(dx) >= 1e-6 || Math.abs(dz) >= 1e-6);
  const verticalOnly = Math.abs(dy) >= 1e-6 && Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6;
  const mixed        = Math.abs(dy) >= 1e-6 && (Math.abs(dx) >= 1e-6 || Math.abs(dz) >= 1e-6);

  // —— 1) Vertikal wedge: S -> V(Sx,Ey,Sz) -> E, hatching längs världens Y
  function drawVertical() {
    const V3 = { x: start3.x, y: end3.y, z: start3.z };
    const V2 = projectTo2D(state.camera, canvas, V3);
    const triV = [ S2, V2, E2 ];
    const sideV = lineSideSign(S2, E2, V2);
    hatchPolygonTriOnSide(triV, S2, E2, sideV, { x:0, y:1, z:0 });
  }

  // —— 2) Plan wedge: läggs på höjden för LÄGSTA endpoint
  //     Välj dessutom kamera-närmaste av de två möjliga "L-hörnen" (X-först vs Z-först).
  function drawPlanar() {
    const sy = start3.y, ey = end3.y;
    const baseY  = (sy <= ey) ? sy : ey;           // lägsta nivå
    const anchor = (sy <= ey) ? start3 : end3;     // punkt på lägsta nivå
    const other  = (sy <= ey) ? end3   : start3;   // den andra punkten

    // End projicerad ned till basplanet
    const Opl3 = { x: other.x, y: baseY, z: other.z };

    // Två alternativa L-hörn på basplanet
    const P1x3 = { x: other.x, y: baseY, z: anchor.z }; // X först, sen Z
    const P1z3 = { x: anchor.x, y: baseY, z: other.z }; // Z först, sen X

    // Beräkna centroid-z för respektive triangel i NDC och välj den som är närmast kameran (lägre z)
    const A3 = anchor; // kort alias
    const triXcentroid = { x:(A3.x + Opl3.x + P1x3.x)/3, y:baseY, z:(A3.z + Opl3.z + P1x3.z)/3 };
    const triZcentroid = { x:(A3.x + Opl3.x + P1z3.x)/3, y:baseY, z:(A3.z + Opl3.z + P1z3.z)/3 };
    const zx = ndcZ(state.camera, triXcentroid);
    const zz = ndcZ(state.camera, triZcentroid);

    const P13 = (zx < zz) ? P1x3 : P1z3; // mindre z = närmare kameran
    const A2  = projectTo2D(state.camera, canvas, A3);
    const O2  = projectTo2D(state.camera, canvas, Opl3);
    const P12 = projectTo2D(state.camera, canvas, P13);

    const triP = [ A2, O2, P12 ];
    const sideP = lineSideSign(S2, E2, P12); // klipp på denna sida om diagonalen
    hatchPolygonTriOnSide(triP, S2, E2, sideP, { x:1, y:0, z:0 }); // liggande linjer
  }

  if (verticalOnly) {
    drawVertical();
  } else if (planarOnly) {
    drawPlanar();
  } else if (mixed) {
    drawVertical();
    drawPlanar();
  }
}

  // Klipp triangel till sidan 'sideSign' av linjen S→E innan hatching
  function hatchPolygonTriOnSide(tri, S2, E2, sideSign, axisEnd3) {
    // snabbkoll: centroidens sida måste matcha, annars hoppar vi
    const C2 = {
      x: (tri[0].x + tri[1].x + tri[2].x) / 3,
      y: (tri[0].y + tri[1].y + tri[2].y) / 3
    };
    const s = lineSideSign(S2, E2, C2);
    if (s !== sideSign) return;

    // hatching i just denna triangel
    hatchPolygon(tri, axisEnd3);
  }

  // ── publik API ──────────────────────────────────────────────────────────────
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
    setSize(w,h) { canvas.width = w; canvas.height = h; },

    // Rubber style (valfritt)
    setRubberStyle({ dashed=null, color=null, lineWidth=null }={}) {
      rubber.dashed = dashed; rubber.color = color; rubber.lineWidth = lineWidth;
    },
    clearRubberStyle() { rubber.dashed = rubber.color = rubber.lineWidth = null; },

    // Hatching API
    addHatchingItem(start3, end3, opts = {}) {
      const item = {
        start: { x:start3.x, y:start3.y, z:start3.z },
        end:   { x:end3.x,   y:end3.y,   z:end3.z }
      };
      if (Array.isArray(opts.path) && opts.path.length) {
        item.path = opts.path.map(p => ({ x:p.x, y:p.y, z:p.z }));
      }
      hatchedItems.push(item);
    },
    clearHatching() { hatchedItems.length = 0; },
    setIsIsoPredicate(fn) { isIsoPredicate = typeof fn === 'function' ? fn : () => true; },

    // Centralt justerbar stil
    setHatchingStyle(style = {}) {
      if (typeof style.spacing === 'number') HATCH.spacing = style.spacing;
      if (typeof style.width === 'number')   HATCH.width   = style.width;
      if (typeof style.color === 'string')   HATCH.color   = style.color;
      if (Array.isArray(style.dash))         HATCH.dash    = style.dash;
      if (typeof style.phase === 'number')   HATCH.phase   = style.phase;
    },

    // Toggle
    setHatchingMode(mode) {
      HATCH_MODE = (mode === 'off') ? 'off' : 'twofield';
    },

    draw({ hasStart, isDrawing }) {
      ctx.clearRect(0,0,canvas.width, canvas.height);

      // Hatching (bara när predicate säger “ISO-läge”)
      if (isIsoPredicate() && HATCH_MODE !== 'off') {
        for (const it of hatchedItems) {
          // tvåfälts-standard
          drawHatchingTwoField(it.start, it.end);
        }
      }

      // Startmarkör
      if (hasStart) {
        ctx.fillStyle = 'rgba(255,200,200,.9)';
        ctx.beginPath(); ctx.arc(start2D.x, start2D.y, 3, 0, Math.PI*2); ctx.fill();
      }

      // Gummisnodd
      if (hasStart && isDrawing) {
        const dashed = rubber.dashed ?? !!state.draw?.isConstruction;
        const color  = rubber.color  ?? (dashed ? '#9aa6b2' : 'white');
        const width  = rubber.lineWidth ?? 1;

        ctx.setLineDash(dashed ? [6,4] : []);
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(start2D.x, start2D.y);
        ctx.lineTo(virtualCursorPix.x, virtualCursorPix.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };
}

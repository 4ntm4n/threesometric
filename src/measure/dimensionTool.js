// src/measure/dimensionTool.js
import { THREE } from '../platform/three.js';

let camera, overlay, graph, edgeIdToLine;
let active = false;
let mode = 'aligned'; // 'aligned' | 'axisX' | 'axisZ' | 'axisY'
let hoveredEdgeId = null;

const HILITE_HEX = 0xffdede;
const NORMAL_HEX  = 0xffffff;

function setEdgeHighlight(eid, on){
  if (!edgeIdToLine) return;
  const line = edgeIdToLine.get(eid);
  if (!line || !line.material || !line.material.color) return;
  line.material.color.setHex(on ? HILITE_HEX : NORMAL_HEX);
  line.material.needsUpdate = true;
}

function screenPoint(e){ return { x: e.clientX, y: e.clientY }; }

// SAFE 3D→2D som funkar med plain {x,y,z}
function projectTo2D(camera, canvas, v3){
  const v = (v3 && typeof v3.x === 'number')
    ? new THREE.Vector3(v3.x, v3.y, v3.z)
    : new THREE.Vector3(); // fallback
  v.project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * canvas.width,
    y: (-v.y * 0.5 + 0.5) * canvas.height
  };
}

function distPointSeg(px, py, ax, ay, bx, by){
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const l2 = vx*vx + vy*vy || 1;
  const t = Math.max(0, Math.min(1, (wx*vx + wy*vy) / l2));
  const cx = ax + t*vx, cy = ay + t*vy;
  return Math.hypot(px - cx, py - cy);
}

function findEdgeUnderMouse(e){
  if (!graph) return null;
  const p = screenPoint(e);
  const canvas = overlay.canvas;
  let best = { id:null, d: 1e9 };
  for (const [eid, edge] of graph.allEdges()) {
    if (edge.kind !== 'center' && edge.kind !== 'construction') continue;
    const a = graph.getNodeWorldPos(edge.a);
    const b = graph.getNodeWorldPos(edge.b);
    const A = projectTo2D(camera, canvas, a);
    const B = projectTo2D(camera, canvas, b);
    const d = distPointSeg(p.x, p.y, A.x, A.y, B.x, B.y);
    if (d < best.d) best = { id:eid, d };
  }
  return (best.d < 16) ? best.id : null; // 16 px hit-slop
}

export function init(ctx){
  ({ camera, overlay, graph, edgeIdToLine } = ctx);
}

export function isActive(){ return active; }
export function currentMode(){ return mode; }

export function toggle(on){
  const prev = active;
  active = (on == null) ? !active : !!on;
  if (!active) {
    if (hoveredEdgeId) setEdgeHighlight(hoveredEdgeId, false);
    hoveredEdgeId = null;
  }
  // se till att overlay känner grafen (så overlay kan rita mått)
  if (overlay?.attachGraph) overlay.attachGraph(graph);
  return active !== prev;
}

export function cycleMode(dir=+1){
  const modes = ['aligned','axisX','axisZ','axisY'];
  const i = modes.indexOf(mode);
  mode = modes[(i + (dir>0?1:-1) + modes.length) % modes.length];
  return mode;
}

export function handleHover(e){
  if (!active) return false;
  const eid = findEdgeUnderMouse(e);
  if (eid !== hoveredEdgeId) {
    if (hoveredEdgeId) setEdgeHighlight(hoveredEdgeId, false);
    if (eid) setEdgeHighlight(eid, true);
    hoveredEdgeId = eid;
  }
  return true;
}

export function onPointerDown(e){
  if (!active || document.pointerLockElement) return false;
  const eid = hoveredEdgeId || findEdgeUnderMouse(e);
  if (!eid) return true;

  const edge = graph.getEdge(eid);
  if (!edge || (edge.kind !== 'center' && edge.kind !== 'construction')) return true;

  const valStr = window.prompt('Enter length (mm):', '');
  if (valStr == null) return true;
  const valueMm = parseFloat(valStr);
  if (!isFinite(valueMm) || valueMm <= 0) return true;

  graph.setEdgeDimension(eid, { valueMm, mode, source:'user', userEditedAt: Date.now() });
  return true;
}

export function onKeyDown(e){
  if (!active) return false;
  if (e.code === 'Tab' || e.code === 'KeyA') {
    e.preventDefault();
    cycleMode(e.shiftKey ? -1 : +1);
    return true;
  }
  if (e.code === 'Escape') {
    toggle(false);
    return true;
  }
  return false;
}

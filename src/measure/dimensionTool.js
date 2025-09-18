// src/measure/dimensionTool.js
import { THREE } from '../platform/three.js';

let camera, overlay, graph, edgeIdToLine;
let active = false;
let mode = 'aligned'; // 'aligned' | 'axisX' | 'axisZ' | 'axisY'
let hoveredEdgeId = null;

// NYTT: metricData (coords med .derivedEdgeLengths) injiceras från drawManager
let metricData = null;

// Färger
const HILITE_HEX  = 0xffdede;
const NORMAL_HEX  = 0xffffff;  // användarmått
const DERIVED_HEX = 0x3399ff;  // derived-mått (blå)

// ————————————————————————————————————————————————————————————

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

// ————————————————————————————————————————————————————————————
// NYTT: längd-provider + stil (user vs derived)
// ————————————————————————————————————————————————————————————

function getDisplayLength(edge) {
  // 1) användarmått
  const user = edge?.dim?.valueMm;
  if (typeof user === 'number' && isFinite(user) && user > 0) {
    return { valueMm: user, source: 'user' };
  }
  // 2) derived från kalkylatorn
  const derived = metricData?.derivedEdgeLengths?.get(edge.id);
  if (typeof derived === 'number' && isFinite(derived) && derived > 0) {
    return { valueMm: derived, source: 'derived' };
  }
  // 3) saknas
  return null;
}

// Exporteras så overlay (om den vill) kan fråga varje frame
export function getEdgeLabelInfo(edgeId) {
  const edge = graph?.getEdge?.(edgeId);
  if (!edge) return null;

  const d = getDisplayLength(edge);
  if (!d) return null; // "no length" → ingen linje

  const isDerived = d.source === 'derived';
  const colorHex  = isDerived ? DERIVED_HEX : NORMAL_HEX;
  const text      = isDerived
    ? `${d.valueMm.toFixed(2)} mm (derived)`
    : `${d.valueMm.toFixed(2)} mm`;

  // positions i world (overlay kan projicera själv om den vill)
  const a = graph.getNodeWorldPos(edge.a);
  const b = graph.getNodeWorldPos(edge.b);

  return {
    edgeId,
    valueMm: d.valueMm,
    isDerived,
    colorHex,
    text,
    aWorld: a,
    bWorld: b,
  };
}

// ————————————————————————————————————————————————————————————
// NYTT: Fallback-renderer (om overlay saknar egen dimensions-hook)
// Ritar endast när dimensionTool är aktivt.
// ————————————————————————————————————————————————————————————

function hexToCss(hex) {
  const s = (hex >>> 0).toString(16).padStart(6, '0');
  return `#${s}`;
}

function drawDimLine2D(ctx, A, B, text, colorHex) {
  // enkel mittoffset + text
  const midx = (A.x + B.x) / 2;
  const midy = (A.y + B.y) / 2;

  // ritlinje
  ctx.save();
  ctx.strokeStyle = hexToCss(colorHex);
  ctx.fillStyle   = hexToCss(colorHex);
  ctx.lineWidth   = 1;

  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();

  // liten kort tvärmarkering i mitten
  const vx = B.x - A.x, vy = B.y - A.y;
  const len = Math.hypot(vx, vy) || 1;
  const nx = -vy / len, ny = vx / len; // normal
  const tick = 6;
  ctx.beginPath();
  ctx.moveTo(midx - nx * tick, midy - ny * tick);
  ctx.lineTo(midx + nx * tick, midy + ny * tick);
  ctx.stroke();

  // text
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, midx, midy - 8);

  ctx.restore();
}

function renderDimensionsFallback() {
  if (!active || !overlay?.canvas || !graph) return;

  const ctx = overlay.ctx || overlay.canvas.getContext('2d');
  if (!ctx) return;

  // rita ovanpå befintlig overlay utan att rensa allting
  // (om din overlay rensar per frame, kan du flytta detta till en onRedraw-hook)
  for (const [eid, edge] of graph.allEdges()) {
    if (edge.kind !== 'center' && edge.kind !== 'construction') continue;

    const info = getEdgeLabelInfo(eid);
    if (!info) continue;               // no length → ingen linje
    // derived → blå, user → vit (hanteras i info.colorHex)

    const A = projectTo2D(camera, overlay.canvas, info.aWorld);
    const B = projectTo2D(camera, overlay.canvas, info.bWorld);

    // hoppa om kort sträcka på skärm
    if (Math.hypot(B.x - A.x, B.y - A.y) < 10) continue;

    drawDimLine2D(ctx, A, B, info.text, info.colorHex);
  }
}

// ————————————————————————————————————————————————————————————

export function init(ctx){
  ({ camera, overlay, graph, edgeIdToLine } = ctx);

  // Ge overlay chans att använda vår provider om den har hook
  // (det här stör inte om hooken inte finns)
  if (overlay?.setDimensionProvider) {
    overlay.setDimensionProvider({
      getEdgeLabelInfo, // overlay kan själv loopa och rita per frame
    });
  }
}

export function setMetricData(data){
  metricData = data || null;
  // Be overlay rendera om om den har en sådan hook
  overlay?.refresh?.();
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
  // se till att overlay känner grafen
  if (overlay?.attachGraph) overlay.attachGraph(graph);

  // Om overlay saknar egen dimensions-hook, rita fallback vid toggle på
  if (active && !overlay?.setDimensionProvider) {
    // rita en gång nu…
    renderDimensionsFallback();
    // …och försök rita om när canvas uppdateras (om overlay exponerar en hook)
    overlay?.onRedraw?.(renderDimensionsFallback);
  }
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

    // (valfri debug) – kommentera bort om du vill minska spammet
    if (eid) {
      const info = getEdgeLabelInfo(eid);
      if (info) {
        console.info(`[DimTool] ${eid}: ${info.text}`);
      } else {
        console.info(`[DimTool] ${eid}: (no length)`);
      }
      // rita om fallback vid hover om ingen overlay-hook finns
      if (!overlay?.setDimensionProvider) renderDimensionsFallback();
    }

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

  const info = getEdgeLabelInfo(eid);
  const placeholder = (info && info.isDerived)
    ? `${info.valueMm.toFixed(2)}  ← derived`
    : '';

  const valStr = window.prompt('Enter length (mm):', placeholder);
  if (valStr == null) return true;

  // Tomt + derived i prompten → promote
  if (!valStr.trim() && info && info.isDerived) {
    graph.setEdgeDimension(eid, {
      valueMm: info.valueMm,
      mode,
      source:'user',
      userEditedAt: Date.now()
    });
    // rita om fallback om overlay saknar hook
    if (!overlay?.setDimensionProvider) renderDimensionsFallback();
    return true;
  }

  const valueMm = parseFloat(valStr);
  if (!isFinite(valueMm) || valueMm <= 0) return true;

  graph.setEdgeDimension(eid, { valueMm, mode, source:'user', userEditedAt: Date.now() });
  if (!overlay?.setDimensionProvider) renderDimensionsFallback();
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

// ──────────────────────────────────────────────────────────────────────────────
// src/debug/jointOverlay.js
// Visuella "svetspunkter" nära noder: endpoints, bends, tees.
// De placeras som små klot en bit ut på anslutande center-edges (setback).
// Ej snappbara (vi lägger dem inte i picker.pickables).
// Nu: färga rött om noden har stress (n.meta.stress.present).
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';

let includeRisers = true; // visa även svetspunkter på vertikala kanter

export function createJointOverlay({ scene, graph }) {
  const group = new THREE.Group();
  group.renderOrder = 6;
  scene.add(group);

  const perNode = new Map();  // nodeId -> Mesh[]
  let active = false;

  // Standard "svetsavstånd" (world units) från nod längs anslutande edge.
  let setback = 0.2; // klampas nedan mot 25% av edgelängd

  // Palett/material: dela material mellan alla klot för bättre prestanda
  const MAT = {
    normal:  new THREE.MeshBasicMaterial({ color: 0xffa640, depthTest: false, depthWrite: false }), // orange
    stress:  new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, depthWrite: false }), // röd
  };
  const radius = 0.06;

  function clearNode(nid) {
    const arr = perNode.get(nid);
    if (!arr) return;
    for (const m of arr) {
      group.remove(m);
      m.geometry?.dispose?.(); // material delas/globalt – behåll
    }
    perNode.delete(nid);
  }

  function clearAll() {
    for (const nid of perNode.keys()) clearNode(nid);
  }

  function nodePosById(nid) {
    return graph.getNodeWorldPos ? graph.getNodeWorldPos(nid) : null;
  }

  // Hjälp: säker setback för en edge (max 25% av edgelängd)
  function safeSetbackForEdge(nid, otherId) {
    const p0 = nodePosById(nid);
    const p1 = nodePosById(otherId);
    if (!p0 || !p1) return 0;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-9) return 0;
    return Math.min(setback, 0.25 * L);
  }

  // Placera en boll s längs kanten från nid mot otherId, välj material efter stress
  function addBallAlong(nid, otherId, stressed) {
    const p0 = nodePosById(nid);
    const p1 = nodePosById(otherId);
    if (!p0 || !p1) return null;

    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-9) return null;

    // Filtrera bort rena risers om vi inte valt att inkludera dem
    const Lh = Math.hypot(dx, dz);
    const isRiser = Lh <= 1e-9;
    if (isRiser && !includeRisers) return null;

    const s = safeSetbackForEdge(nid, otherId);
    if (s <= 0) return null;

    const t = s / L;
    const pos = { x: p0.x + dx * t, y: p0.y + dy * t, z: p0.z + dz * t };

    const geo = new THREE.SphereGeometry(radius, 12, 8);
    const mat = stressed ? MAT.stress : MAT.normal;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.renderOrder = 7;
    // INTE pickable
    group.add(mesh);
    return mesh;
  }

  function updateNode(nid) {
    if (!active) return;
    clearNode(nid);

    const n = graph.getNode?.(nid);
    if (!n) return;

    // Läs stress-flagga från nodens meta
    const stressed = !!n.meta?.stress?.present;

    // Använd lagrad klassning om den finns, annars klassificera on the fly
    const topo = n.meta?.topo ?? graph.classifyNode?.(nid)?.topo ?? 'unknown';

    const balls = [];
    const neigh = graph.neighbors?.(nid, { kind: 'center' }) ?? [];
    if (!neigh.length) return;

    if (topo === 'endpoint') {
      const hit = neigh[0];
      const b = addBallAlong(nid, hit.otherId, stressed);
      if (b) balls.push(b);
    } else if (topo === 'bend' || topo === 'straight') {
      for (const { otherId } of neigh) {
        const b = addBallAlong(nid, otherId, stressed);
        if (b) balls.push(b);
      }
    } else if (topo === 'tee') {
      const runner = n.meta?.tee?.runner;
      const branch = n.meta?.tee?.branch;
      if (runner?.length === 2 && branch) {
        const mapEdgeToOther = new Map(neigh.map(({ edge, otherId }) => [edge.id, otherId]));
        const oA = mapEdgeToOther.get(runner[0]);
        const oB = mapEdgeToOther.get(runner[1]);
        const oC = mapEdgeToOther.get(branch);
        if (oA) { const m = addBallAlong(nid, oA, stressed); if (m) balls.push(m); }
        if (oB) { const m = addBallAlong(nid, oB, stressed); if (m) balls.push(m); }
        if (oC) { const m = addBallAlong(nid, oC, stressed); if (m) balls.push(m); }
      } else {
        // fallback om tee-meta saknas: lägg på alla center-grannar
        for (const { otherId } of neigh) {
          const b = addBallAlong(nid, otherId, stressed);
          if (b) balls.push(b);
        }
      }
    } else {
      // junction/unknown → hoppa över (eller avkommentera för att alltid visa)
      // for (const { otherId } of neigh) {
      //   const b = addBallAlong(nid, otherId, stressed);
      //   if (b) balls.push(b);
      // }
    }

    if (balls.length) perNode.set(nid, balls);
  }

  function updateNodes(nodeIds) {
    if (!active) return;
    for (const nid of nodeIds) updateNode(nid);
  }

  function updateAll() {
    if (!active) return;
    clearAll();
    if (typeof graph.allNodes === 'function') {
      for (const [nid] of graph.allNodes()) updateNode(nid);
    }
  }

  function toggle(on) {
    const next = on ?? !active;
    if (next === active) return;
    active = next;
    group.visible = active;
    if (!active) {
      clearAll();
    } else {
      updateAll();
    }
  }

  return {
    toggle,
    updateNodes,
    updateAll,
    isActive: () => active,
    setSetback: (v) => { setback = Math.max(0, Number(v) || 0); if (active) updateAll(); },
    setIncludeRisers: (v) => { includeRisers = !!v; if (active) updateAll(); },
    _group: group,
  };
}

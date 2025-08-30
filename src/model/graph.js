// ──────────────────────────────────────────────────────────────────────────────
// src/model/graph.js
// Supertunn graf + 3D-nodklassificering och persisterings-helpers
// ──────────────────────────────────────────────────────────────────────────────

export function createGraph() {
  const nodes = new Map(); // id -> { id, base:{x,y,z}, offset:{x,y,z}, meta?:{} }
  const edges = new Map(); // id -> { id, a, b, kind:'center'|'construction', spec?:{od, wt, material} }
  const adj   = new Map(); // nodeId -> Set(edgeId)

  let nodeSeq = 1;
  let edgeSeq = 1;

  function _newNodeId() { return `n${nodeSeq++}`; }
  function _newEdgeId() { return `e${edgeSeq++}`; }
  function _ensureAdj(nid) { if (!adj.has(nid)) adj.set(nid, new Set()); }

  // numerik (låg, inte “toleranser”)
  const EPS = 1e-9;
  const HORIZ_EPS = 1e-9;          // ~vertikalt om √(dx^2+dz^2) ~ 0
  const DOT_COLINEAR_MIN = 0.999;  // ≈ 2.6°
  const DOT_ORTHO_MAX    = 0.05;   // ≈ 87–93°
  const TIE_MARGIN       = 0.003;  // runner-paret får inte vara nästan lika andra paret

  // ——— Nodes
  function addNodeAt(pos) {
    const id = _newNodeId();
    const n = {
      id,
      base:   { x: pos.x, y: pos.y, z: pos.z },
      offset: { x: 0,     y: 0,     z: 0     },
      meta:   {},
    };
    nodes.set(id, n);
    _ensureAdj(id);
    return n;
  }
  function getNode(id) { return nodes.get(id); }
  function allNodes() { return nodes; }

  function getNodeWorldPos(id) {
    const n = nodes.get(id); if (!n) return null;
    const b = n.base ?? {x:0,y:0,z:0}, o = n.offset ?? {x:0,y:0,z:0};
    return { x:(b.x||0)+(o.x||0), y:(b.y||0)+(o.y||0), z:(b.z||0)+(o.z||0) };
  }
  // ändra endast offset.y så world=base+offset hålls
  function setNodeWorldY(id, yNew) {
    const n = nodes.get(id); if (!n) return;
    if (!n.base)   n.base   = {x:0,y:0,z:0};
    if (!n.offset) n.offset = {x:0,y:0,z:0};
    const curY = (n.base.y||0)+(n.offset.y||0);
    n.offset.y = (n.offset.y||0) + (yNew - curY);
  }

  // hitta existerande nod inom tolerans (världsenheter)
  function findNodeNear(pos, tol = 1e-4) {
    let best = null, bestD2 = tol * tol;
    for (const n of nodes.values()) {
      const b = n.base ?? { x:0, y:0, z:0 };
      const o = n.offset ?? { x:0, y:0, z:0 };
      const nx = (b.x || 0) + (o.x || 0);
      const ny = (b.y || 0) + (o.y || 0);
      const nz = (b.z || 0) + (o.z || 0);
      const dx = nx - pos.x, dy = ny - pos.y, dz = nz - pos.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 <= bestD2) { bestD2 = d2; best = n; }
    }
    return best;
  }

  function getOrCreateNodeAt(pos, tol = 1e-4) {
    const hit = findNodeNear(pos, tol);
    if (hit) return { node: hit, created: false };
    const n = addNodeAt(pos);
    return { node: n, created: true };
  }

  // ——— Edge
  function addEdge(aId, bId, kind='center') {
    if (aId === bId) return null;
    const id = _newEdgeId();
    const e = { id, a:aId, b:bId, kind };
    edges.set(id, e);
    _ensureAdj(aId); _ensureAdj(bId);
    adj.get(aId).add(id);
    adj.get(bId).add(id);
    return e;
  }
  function getEdge(id) { return edges.get(id); }
  function allEdges() { return edges; }

  function setEdgeSpec(edgeId, spec) { const e = edges.get(edgeId); if (!e) return false; e.spec = { ...spec }; return true; }
  function getEdgeSpec(edgeId) { return edges.get(edgeId)?.spec ?? null; }
  function equalSpecs(a,b){ return !!a && !!b && a.od===b.od && a.wt===b.wt && a.material===b.material; }

  // ——— Neighborhood
  function neighbors(nodeId, { kind=null }={}) {
    const out = []; const bag = adj.get(nodeId); if (!bag) return out;
    for (const eid of bag) {
      const e = edges.get(eid); if (!e) continue;
      if (kind && e.kind !== kind) continue;
      const otherId = (e.a === nodeId) ? e.b : e.a;
      out.push({ edge:e, otherId });
    }
    return out;
  }
  function incidentEdges(nodeId, { kind=null } = {}) {
    const out = []; const bag = adj.get(nodeId); if (!bag) return out;
    for (const eid of bag) {
      const e = edges.get(eid); if (!e) continue;
      if (kind && e.kind !== kind) continue;
      out.push(e);
    }
    return out;
  }
  function edgeBetween(aId,bId,{kind=null}={}) {
    const bag = adj.get(aId); if (!bag) return null;
    for (const eid of bag) {
      const e = edges.get(eid); if (!e) continue;
      if (kind && e.kind !== kind) continue;
      if ((e.a===aId&&e.b===bId)||(e.a===bId&&e.b===aId)) return e;
    }
    return null;
  }

  // ——— Geometrihelpers
  function horizDistXZ(a,b){ const dx=b.x-a.x, dz=b.z-a.z; return Math.hypot(dx,dz); }

  // enhetsriktning i 3D från nodeId längs edge
  function edgeDir3D(edgeId, atNodeId) {
    const e = edges.get(edgeId); if (!e) return null;
    const pa = getNodeWorldPos(e.a), pb = getNodeWorldPos(e.b);
    if (!pa || !pb) return null;
    let dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
    if (atNodeId === e.b) { dx=-dx; dy=-dy; dz=-dz; } // peka utåt från atNodeId
    const L = Math.hypot(dx,dy,dz);
    if (L <= EPS) return null;
    const Lh = Math.hypot(dx,dz);
    return { x:dx/L, y:dy/L, z:dz/L, L, Lh };
  }
  function isRiserEdge(edgeId) {
    const e = edges.get(edgeId); if (!e) return false;
    const pa = getNodeWorldPos(e.a), pb = getNodeWorldPos(e.b);
    if (!pa || !pb) return false;
    return horizDistXZ(pa,pb) <= HORIZ_EPS;
  }

  // ——— Klassificering i 3D (orientationsoberoende)
  function classifyNode(nodeId) {
    const eList = incidentEdges(nodeId, { kind:'center' });
    const deg = eList.length;

    const dirs = [];     // { edgeId, v:{x,y,z,L,Lh} }
    const risers = [];
    for (const e of eList) {
      const v = edgeDir3D(e.id, nodeId);
      if (!v) continue;
      if (v.Lh <= HORIZ_EPS) risers.push(e.id);
      dirs.push({ edgeId: e.id, v });
    }

    // ENDPOINT
    if (deg === 1) {
      const role = (dirs[0]?.v?.y ?? 0) > 0.999 ? 'bottom' : (dirs[0]?.v?.y ?? 0) < -0.999 ? 'top' : null;
      return { topo:'endpoint', degreeCenter:deg, risers, riserRole: role, notes:[] };
    }

    // DEG=2 → STRAIGHT (≈180°) ELLER BEND
    if (deg === 2) {
      if (dirs.length < 2) return { topo:'junction', degreeCenter:deg, risers, notes:['need_two_valid_dirs'] };
      const d0 = dirs[0].v, d1 = dirs[1].v;
      const dot = d0.x*d1.x + d0.y*d1.y + d0.z*d1.z; // här använder vi tecknet
      const topo = (dot <= -DOT_COLINEAR_MIN) ? 'straight' : 'bend';
      return {
        topo, degreeCenter:deg, risers,
        bendAngleRad: Math.acos(Math.max(-1, Math.min(1, -dot))), // 0 om straight (dot≈-1)
        notes:[]
      };
    }

    // DEG=3 → TEE eller JUNCTION
    if (deg === 3) {
      if (dirs.length !== 3) return { topo:'junction', degreeCenter:deg, risers, notes:['need_three_valid_dirs'] };

      // hitta mest ANTIPARALLELLT par (minsta dot)
      const pairs = [
        {i:0,j:1},
        {i:0,j:2},
        {i:1,j:2},
      ].map(p => {
        const vi = dirs[p.i].v, vj = dirs[p.j].v;
        const dot = vi.x*vj.x + vi.y*vj.y + vi.z*vj.z; // kan vara negativt
        return { ...p, dot };
      }).sort((a,b)=> a.dot - b.dot); // stigande: mest negativt först

      const best   = pairs[0];
      const second = pairs[1];

      if (best.dot > -DOT_COLINEAR_MIN) {
        return { topo:'junction', degreeCenter:deg, risers, notes:['no_antiparallel_pair_for_runner'] };
      }
      if (Math.abs(best.dot - second.dot) < TIE_MARGIN) {
        return { topo:'junction', degreeCenter:deg, risers, notes:['ambiguous_runner_pair'] };
      }

      const runnerIdx = [best.i, best.j];
      const branchIdx = [0,1,2].find(k => !runnerIdx.includes(k));

      const runnerEdges = [dirs[runnerIdx[0]].edgeId, dirs[runnerIdx[1]].edgeId];
      const branchEdge  = dirs[branchIdx].edgeId;

      // ortogonalitet för branch mot runner-axeln (räcker mot en av dem)
      const vb = dirs[branchIdx].v;
      const vr = dirs[runnerIdx[0]].v;  // den andra är -vr
      const orthoOk = Math.abs(vb.x*vr.x + vb.y*vr.y + vb.z*vr.z) <= DOT_ORTHO_MAX;
      if (!orthoOk) {
        return { topo:'junction', degreeCenter:deg, risers, notes:['branch_not_orthogonal_to_runner'] };
      }

      // riserRole: om noden har en ren vertikal gren, tag enkel top/bottom-hint
      let riserRole = null;
      for (const d of dirs) {
        if (d.v.Lh <= HORIZ_EPS) {
          if (d.v.y > 0.999) riserRole = 'bottom';
          else if (d.v.y < -0.999) riserRole = 'top';
        }
      }

      return {
        topo:'tee',
        degreeCenter:deg,
        runner: runnerEdges.sort(), // stabil ordning
        branch: branchEdge,
        colinearity: -best.dot,     // 1 = perfekt
        risers,
        riserRole,
        notes:[]
      };
    }

    // DEG ≥ 4 → låt vara junction tills vi ev. inför cross
    return { topo:'junction', degreeCenter:deg, risers, notes:['degree_ge_4_not_handled_yet'] };
  }

  // ——— Persistens / invalidation
  function classifyAndStore(nodeId) {
    const n = nodes.get(nodeId); if (!n) return { ok:false, reason:'no_node' };
    const prev = n.meta?.topo ?? null;
    const cls = classifyNode(nodeId);
    n.meta = n.meta || {};
    n.meta.topo = cls.topo;
    n.meta.degreeCenter = cls.degreeCenter;
    n.meta.risers = cls.risers;
    n.meta.riserRole = cls.riserRole ?? null;
    if (cls.topo === 'tee') {
      n.meta.tee = { runner: cls.runner, branch: cls.branch, colinearity: cls.colinearity };
    } else {
      delete n.meta.tee;
    }
    if (cls.topo === 'bend') n.meta.bendAngleRad = cls.bendAngleRad; else delete n.meta.bendAngleRad;
    // diff
    const changed = prev !== cls.topo;
    return { ok:true, changed, prev, next:cls.topo, classify:cls };
  }

  function classifyAndStoreMany(nodeIds) {
    const res = [];
    if (!nodeIds) return res;
    for (const nid of nodeIds) res.push(classifyAndStore(nid));
    return res;
  }

  function invalidateAroundEdge(edgeId) {
    const e = edges.get(edgeId); if (!e) return [];
    const near = new Set([e.a, e.b]);
    for (const nid of [...near]) {
      for (const { otherId } of neighbors(nid, { kind:'center' })) near.add(otherId);
    }
    return classifyAndStoreMany([...near]);
  }

  // ——— Ops helper: samla kanter som sitter i en mängd noder
  function collectAffectedEdges(nodeIds, { kinds = ['center'] } = {}) {
    const set = new Set();
    if (!nodeIds) return [];
    for (const nid of nodeIds) {
      const bag = adj.get(nid); if (!bag) continue;
      for (const eid of bag) {
        const e = edges.get(eid);
        if (!e) continue;
        if (kinds && !kinds.includes(e.kind)) continue;
        set.add(eid);
      }
    }
    return [...set];
  }

  return {
    // data
    nodes, edges, adj,
    // node API
    addNodeAt, getOrCreateNodeAt, getNode, allNodes,
    getNodeWorldPos, setNodeWorldY, findNodeNear,
    // edge API
    addEdge, getEdge, allEdges, neighbors, incidentEdges, edgeBetween,
    // geom + classify
    edgeDir3D, isRiserEdge, classifyNode,
    classifyAndStore, classifyAndStoreMany, invalidateAroundEdge,
    // specs + ops helpers
    setEdgeSpec, getEdgeSpec, equalSpecs,
    collectAffectedEdges,
    // thresholds (om UI/ops vill läsa)
    consts: { EPS, HORIZ_EPS, DOT_COLINEAR_MIN, DOT_ORTHO_MAX, TIE_MARGIN },
  };
}

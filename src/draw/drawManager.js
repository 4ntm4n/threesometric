// ──────────────────────────────────────────────────────────────────────────────
// src/draw/drawManager.js  (adds slope mode toggle: Tab cycles modes)
//  • S: aktivera slope-läget, klicka A och B
//  • Tab: toggla profil (balanced → lockTop → lockBottom → balanced …)
//  • Enter: commit
//  • Esc: cancel
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';
import { enterDrawMode, resetIsoAndFitAll } from '../scene/controls.js';
import { state } from '../state/appState.js';
import { angleToIsoDir3D, pixelsPerWorldUnit, snapAngleDeg } from '../core/utils.js';
import { ISO_ANGLES, COLORS } from '../core/constants.js';
import { makeSlopePreviewOnPath, applySlopePreview } from '../ops/slope.js';

export function createDrawManager({
  scene, camera, renderer3D, controls, overlay, picker, snapper, modelGroup, permanentVertices, graph
}) {
  state.camera = camera;
  state.ui.rendererEl = renderer3D.domElement;

  if (state.draw.isConstruction == null) state.draw.isConstruction = false;

  // Mappar för att kunna uppdatera 3D efter slope-commit
  const edgeIdToLine = new Map(); // endast center-edges
  const nodeIdToSphere = new Map();

  // Idle-markör (vit)
  const idleMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  idleMarker.renderOrder = 2;
  scene.add(idleMarker);

  function setIdleMarkerColor(hex) { idleMarker.material.color.setHex(hex); }

  // Hjälpare: world-pos för graph-node oavsett lagringsmodell
  function nodeWorldPos(n) {
    if (!n) return { x:0,y:0,z:0 };
    if (n.pos) return n.pos;
    const b = n.base || {x:0,y:0,z:0};
    const o = n.offset || {x:0,y:0,z:0};
    return { x:(b.x??0)+(o.x??0), y:(b.y??0)+(o.y??0), z:(b.z??0)+(o.z??0) };
  }

  function addVertexSphere(pos, nodeId, color = COLORS.vertex) {
    // om vi redan har en sphere kopplad till noden → uppdatera istället
    if (nodeId && nodeIdToSphere.has(nodeId)) {
      nodeIdToSphere.get(nodeId).position.set(pos.x, pos.y, pos.z);
      return;
    }
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })
    );
    s.renderOrder = 1;
    s.position.copy(pos);
    permanentVertices.add(s);
    if (nodeId) nodeIdToSphere.set(nodeId, s);
  }

  // Public API
  function getStartPoint() { return state.draw.lineStartPoint; }

  // Helpers
  function getNDC(e) {
    const rect = renderer3D.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x, y);
  }

  function isOnScreenPx(camera, canvas, point3D, marginPx = 20) {
    const v = point3D.clone().project(camera);
    if (v.z < -1 || v.z > 1) return false;
    const x = (v.x + 1) * 0.5 * canvas.width;
    const y = (-v.y + 1) * 0.5 * canvas.height;
    return (x>=marginPx && x<=canvas.width-marginPx && y>=marginPx && y<=canvas.height-marginPx);
  }

  // ——— Förhands-ändpunkt
  function predictEndPointAxis() {
    const dx = overlay.virtualCursorPix.x - overlay.start2D.x;
    const dy = overlay.start2D.y - overlay.virtualCursorPix.y;
    const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snapped = snapAngleDeg(rawAngle, ISO_ANGLES);
    const dir3D = angleToIsoDir3D(snapped);
    const ppu = pixelsPerWorldUnit(camera, overlay.canvas, dir3D, state.draw.lineStartPoint);
    const pixelsLen = Math.hypot(dx, dy);
    const worldLen = pixelsLen / ppu;
    const end3D = state.draw.lineStartPoint.clone().add(dir3D.multiplyScalar(worldLen));
    return { end3D, worldLen, snappedToNode: false };
  }

  function predictEndPointNormal() {
    const snapPos = snapper.findNearestNode2D(overlay.virtualCursorPix.x, overlay.virtualCursorPix.y);
    if (snapPos && snapPos.distanceToSquared(state.draw.lineStartPoint) > 1e-10) {
      const end3D = snapPos.clone();
      const worldLen = Math.sqrt(state.draw.lineStartPoint.distanceToSquared(end3D));
      return { end3D, worldLen, snappedToNode: true };
    }
    return predictEndPointAxis();
  }

  function predictEndPoint() {
    return state.draw.isConstruction ? predictEndPointAxis() : predictEndPointNormal();
  }

  function addModelLine(a, b, { dashed = false, edgeId = null } = {}) {
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = dashed
      ? new THREE.LineDashedMaterial({
          color: 0x9aa6b2,
          dashSize: 0.35,
          gapSize: 0.22,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
          depthWrite: false,
        })
      : new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false });

    const line = new THREE.Line(geom, mat);
    if (dashed && line.computeLineDistances) line.computeLineDistances();
    line.renderOrder = 1;
    modelGroup.add(line);

    if (!dashed && edgeId) edgeIdToLine.set(edgeId, line);

    const pickCyl = picker.makePickCylinder(a, b);
    if (pickCyl) picker.pickables.add(pickCyl);
    return line;
  }

  function commitIfAny() {
    const { end3D, worldLen } = predictEndPoint();
    if (worldLen <= 1e-6) return;

    // 1) uppdatera graf
    const kind = state.draw.isConstruction ? 'construction' : 'center';
    const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
    const { node: bNode } = graph.getOrCreateNodeAt(end3D);
    const edge = graph.addEdge(aNode.id, bNode.id, kind);

    // 2) 3D-linje
    const dashed = state.draw.isConstruction;
    addModelLine(
      new THREE.Vector3(state.draw.lineStartPoint.x, state.draw.lineStartPoint.y, state.draw.lineStartPoint.z),
      new THREE.Vector3(end3D.x, end3D.y, end3D.z),
      { dashed, edgeId: edge && edge.kind === 'center' ? edge.id : null }
    );

    // 3) nod-spheres
    addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
    addVertexSphere(end3D, bNode.id, COLORS.vertex);

    // 4) fortsätt rita från slutpunkten
    state.draw.lineStartPoint.copy(end3D);
    overlay.recenterCursorToStart();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Slope-läge (S → välj A, B → preview, Enter commit, Esc cancel, Tab toggle)
  // ───────────────────────────────────────────────────────────────────────────
  const slope = {
    active: false,
    stage: 0,        // 0=vänta på A, 1=vänta på B, 2=preview klar
    A: null,
    B: null,
    preview: null,   // { ok, path, yTargetByNode, affectedEdges, warnings? }
    group: new THREE.Group(),
    s: 0.01,         // 1%
    mode: 'balanced',
    modes: ['balanced','lockTop','lockBottom'],
  };
  slope.group.renderOrder = 3;
  scene.add(slope.group);

  function clearSlopePreview() {
    while (slope.group.children.length) slope.group.remove(slope.group.children[0]);
  }

  function toggleSlopeMode(on) {
    slope.active = on ?? !slope.active;
    slope.stage = slope.active ? 0 : 0;
    slope.A = slope.B = null;
    slope.mode = 'balanced';      // reset vid nytt aktiverat läge
    clearSlopePreview();
    slope.preview = null;
    setIdleMarkerColor(0xffffff);
  }

  function findGraphNodeIdNear(pos, tol = 1e-3) {
    const hit = graph.findNodeNear(pos, tol);
    return hit ? hit.id : null;
  }

  // ——— Preview rendering
  function buildSlopePreview3D() {
    clearSlopePreview();
    if (!slope.preview?.ok) return;

    // 🔶 gör preview tydlig
    const previewBoost = 4; // förstora lutning i preview (endast visuellt)
    const mat = new THREE.LineDashedMaterial({
      color: 0xffa640,
      dashSize: 0.5,
      gapSize: 0.3,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
    });

    const ids = slope.preview.path;
    let made = 0;

    for (let i = 0; i < ids.length - 1; i++) {
      const na = graph.getNode(ids[i]);
      const nb = graph.getNode(ids[i + 1]);
      if (!na || !nb) continue;

      const pa0 = nodeWorldPos(na);
      const pb0 = nodeWorldPos(nb);

      // mål-Y från preview + lite boost (endast för visning)
      const yA0 = slope.preview.yTargetByNode.get(ids[i])     ?? pa0.y;
      const yB0 = slope.preview.yTargetByNode.get(ids[i + 1]) ?? pb0.y;

      const yA = pa0.y + (yA0 - pa0.y) * previewBoost;
      const yB = pb0.y + (yB0 - pb0.y) * previewBoost;

      const a = new THREE.Vector3(pa0.x, yA, pa0.z);
      const b = new THREE.Vector3(pb0.x, yB, pb0.z);

      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      const l = new THREE.Line(g, mat);
      if (l.computeLineDistances) l.computeLineDistances(); // krävs för dashed
      l.renderOrder = 5;
      slope.group.add(l);
      made++;
    }

    // Visa nuvarande mode i konsolen (kan ersättas med HUD-chip om du vill)
    console.info('[Slope] Mode:', slope.mode, 'Preview lines:', made, 'Warnings:', slope.preview.warnings ?? []);
  }

  // ——— Mode-toggling & recompute
  function cycleSlopeMode(dir = +1) {
    const idx = slope.modes.indexOf(slope.mode);
    const next = (idx + (dir >= 0 ? 1 : slope.modes.length - 1)) % slope.modes.length;
    slope.mode = slope.modes[next];
    console.info('[Slope] Mode →', slope.mode);
  }

  function recomputeSlopePreview() {
    if (!slope.A || !slope.B) return;

    // 1) Första försök: valt mode
    let preview = makeSlopePreviewOnPath(graph, slope.A, slope.B, slope.s, { mode: slope.mode });

    // 2) Smart fallback: balanced ej möjlig när A<=B → hoppa till lockBottom
    if (!preview.ok && slope.mode === 'balanced' && /A_not_higher/i.test(preview.reason || '')) {
      console.warn('[Slope] balanced ej möjligt (A måste vara högre) – byter till lockBottom');
      slope.mode = 'lockBottom';
      preview = makeSlopePreviewOnPath(graph, slope.A, slope.B, slope.s, { mode: slope.mode });
    }

    slope.preview = preview;
    buildSlopePreview3D();
  }

  function commitSlopeIfPreview() {
  if (!slope.active || !slope.preview?.ok) return;

  // 1) Skriv in slopen i grafen (inkl. 3D-coincident propagation) och få diffar
  const res = applySlopePreview(graph, slope.preview);
  if (!res.ok) return;

  // 2) Uppdatera 3D-linjer för alla berörda center-edges
  //    (construction-linjer uppdateras inte här – de är bara referens,
  //     men deras pickables rebuildas i steg 4.)
  for (const eid of res.affectedEdges) {
    const e = graph.getEdge(eid);
    if (!e) continue;
    const la = graph.getNode(e.a);
    const lb = graph.getNode(e.b);
    if (!la || !lb) continue;

    const pa = nodeWorldPos(la);
    const pb = nodeWorldPos(lb);
    const line = edgeIdToLine.get(eid);
    if (line) {
      const A = new THREE.Vector3(pa.x, pa.y, pa.z);
      const B = new THREE.Vector3(pb.x, pb.y, pb.z);
      line.geometry.setFromPoints([A, B]);
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere?.();
      // dashed-linjer ligger inte i denna map (de är construction)
    }
  }

  // 3) Uppdatera nod-spheres för alla berörda noder (inte bara pathen)
  const nodesToUpdate = res.affectedNodes ?? [];
  for (const nid of nodesToUpdate) {
    const n = graph.getNode(nid);
    if (!n) continue;
    const p = nodeWorldPos(n);
    const sph = nodeIdToSphere.get(nid);
    if (sph) sph.position.set(p.x, p.y, p.z);
  }

  // 4) REBUILD PICKABLES – rensa alla och bygg om från grafens aktuella geometri
  //    (robustast nu; kan optimeras till per-edge senare)
  while (picker.pickables.children.length) {
    const obj = picker.pickables.children[0];
    picker.pickables.remove(obj);
    // Obs: vi låter material leva (kan vara delat); vill du, dispose:a geometry här:
    // obj.geometry?.dispose?.();
  }

  if (graph?.edges?.size) {
    for (const [eid, e] of graph.edges) {
      const la = graph.getNode(e.a);
      const lb = graph.getNode(e.b);
      if (!la || !lb) continue;

      const pa = nodeWorldPos(la);
      const pb = nodeWorldPos(lb);

      const A = new THREE.Vector3(pa.x, pa.y, pa.z);
      const B = new THREE.Vector3(pb.x, pb.y, pb.z);

      const pickCyl = picker.makePickCylinder(A, B);
      if (pickCyl) picker.pickables.add(pickCyl);
    }
  }

  // 5) Städa preview och lämna slope-läget
  clearSlopePreview();
  slope.preview = null;
  toggleSlopeMode(false);
}

  // Pointer events
  function onMouseMove(e, pickPlaneMesh) {
    if (document.pointerLockElement) {
      if (state.draw.isDrawing && state.draw.hasStart) {
        overlay.setVirtualCursorTo2D({
          x: overlay.virtualCursorPix.x + e.movementX,
          y: overlay.virtualCursorPix.y + e.movementY
        });
      }
      return;
    }

    // Slope-läge: visa idleMarker på närmaste nod vi kan snappa till
    if (slope.active) {
      const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
      if (nodeSnapPos) {
        idleMarker.position.copy(nodeSnapPos);
        setIdleMarkerColor(0xffa640);
      } else {
        setIdleMarkerColor(0xffffff);
      }
      return;
    }

    // INSPEKTION (vanlig hover)
    const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
    if (nodeSnapPos) {
      idleMarker.position.copy(nodeSnapPos);
      setIdleMarkerColor(0x80ff80);
      return;
    } else {
      setIdleMarkerColor(0xffffff);
    }

    const ndc = getNDC(e);
    picker.raycaster.setFromCamera(ndc, camera);

    const hits = picker.raycaster.intersectObjects(picker.pickables.children, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const seg = hit.object.userData;
      const nearest = picker.closestPointOnSegment(hit.point, seg.start, seg.end);
      idleMarker.position.copy(nearest);
      return;
    }

    const hit = picker.raycaster.intersectObject(pickPlaneMesh);
    if (hit.length) idleMarker.position.copy(hit[0].point);
  }

  function onPointerDown(e, pickPlaneMesh) {
    if (e.button !== 0) return;

    // Slope-läge (ingen pointer-lock)
    if (slope.active && !document.pointerLockElement) {
      const pos = snapper.findNearestNode2D(e.clientX, e.clientY);
      if (!pos) return;

      const nid = findGraphNodeIdNear(pos, 1e-3);
      if (!nid) return;

      if (slope.stage === 0) {
        slope.A = nid;
        slope.stage = 1;
        return;
      }
      if (slope.stage === 1) {
        if (nid === slope.A) return;
        slope.B = nid;

        // Gör preview med valt mode (ev. fallback)
        const aPos = nodeWorldPos(graph.getNode(slope.A));
        const bPos = nodeWorldPos(graph.getNode(slope.B));
        console.log('Slope A→B', { A: slope.A, aPos, B: slope.B, bPos, mode: slope.mode, s: slope.s });

        recomputeSlopePreview();
        if (!slope.preview?.ok) {
          console.warn('Slope preview failed:', slope.preview?.reason);
          // Vanligaste orsaken: A och B saknar center-path (val gjord via construction).
        }
        slope.stage = 2;
        return;
      }
      // stage 2: låt Enter committa / Esc avbryta
      return;
    }

    // Vanlig ritlogik (inspektion → välj start → draw mode)
    if (!document.pointerLockElement) {
      const nodeSnapPos = snapper.findNearestNode2D(e.clientX, e.clientY);
      if (nodeSnapPos) {
        state.draw.lineStartPoint.copy(nodeSnapPos);
        // koppla startpunkten till grafen om den saknas
        const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
        addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
        return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
      }

      const ndc = getNDC(e);
      picker.raycaster.setFromCamera(ndc, camera);

      const hits = picker.raycaster.intersectObjects(picker.pickables.children, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const seg = hit.object.userData;
        const nearest = picker.closestPointOnSegment(hit.point, seg.start, seg.end);
        state.draw.lineStartPoint.copy(nearest);
        const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
        addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
        return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
      }

      const hit = picker.raycaster.intersectObject(pickPlaneMesh);
      if (hit.length) {
        state.draw.lineStartPoint.copy(hit[0].point);
        const { node: aNode } = graph.getOrCreateNodeAt(state.draw.lineStartPoint);
        addVertexSphere(state.draw.lineStartPoint, aNode.id, COLORS.vertex);
        return enterDrawMode({ controls, startPoint: state.draw.lineStartPoint });
      }
    } else {
      // RITLÄGE: två-klicks
      if (state.draw.isDrawing && state.draw.hasStart && !state.draw.isInteracting) {
        const { end3D, worldLen } = predictEndPoint();
        if (worldLen <= 1e-6) return;

        const visible = isOnScreenPx(camera, overlay.canvas, end3D, 20);
        if (!visible) {
          const target = end3D.clone();
          const pos = target.clone().add(state.iso.ISO_OFFSET);
          controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, true);
          return; // första klicket: bara pan
        }
        commitIfAny();
      }
    }
  }

  function onKeyDown(e) {
    // Hindra browserns Tab-fokusnavigering när vi är i slope-läget
    if (slope.active && e.code === 'Tab') {
      if (e.repeat) { e.preventDefault(); return; }  // undvik auto-repeat spam
      e.preventDefault();
      // Shift+Tab = bakåt
      cycleSlopeMode(e.shiftKey ? -1 : +1);
      if (slope.stage === 2) {
        recomputeSlopePreview();
      }
      return;
    }
  }

  function onKeyUp(e, { resetIsoAndFitAll: reset }) {
    if (e.code === 'Escape') {
      // Avbryt slope-läge om aktivt
      if (slope.active) {
        clearSlopePreview();
        slope.preview = null;
        toggleSlopeMode(false);
        return;
      }
      // Avbryt ritning
      state.draw.isDrawing = false;
      state.draw.hasStart = false;
      state.draw.pending = false;
      if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'none';
      if (document.pointerLockElement) document.exitPointerLock();
      reset();
      return;
    }

    if (e.code === 'Enter') {
      if (slope.active && slope.stage === 2 && slope.preview?.ok) {
        commitSlopeIfPreview();
        return;
      }
    }

    // Toggle konstruktionsläge i ritläge
    if (e.code === 'KeyG' && document.pointerLockElement) {
      state.draw.isConstruction = !state.draw.isConstruction;
      return;
    }

    // Slope-läge på/av i inspektionsläge
    if (e.code === 'KeyS' && !document.pointerLockElement) {
      toggleSlopeMode();
      return;
    }

    // TAB: toggla slope-mode när slope-läge är aktivt
    // if (e.code === 'Tab' && slope.active) {
    //   e.preventDefault();
    //   // Shift+Tab = baklänges (valfritt, gratis)
    //   cycleSlopeMode(e.shiftKey ? -1 : +1);
    //   if (slope.stage === 2) {
    //     recomputeSlopePreview();
    //   }
    //   return;
    // }
  }

  function onPointerLockChange() {
    if (!document.pointerLockElement) {
      if (state.draw.isDrawing || state.draw.pending || state.draw.hasStart) {
        state.draw.isDrawing = false;
        state.draw.hasStart = false;
        state.draw.pending = false;
        if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'none';
        resetIsoAndFitAll({ scene, modelGroup, controls, camera });
      }
      return;
    }
    if (state.draw.hasStart) {
      if (state.ui.virtualCursor) state.ui.virtualCursor.style.display = 'block';
      overlay.recenterCursorToStart();
      if (state.draw.pending) {
        state.draw.isDrawing = true;
        state.draw.pending = false;
      }
    }
  }

  function onResize(camera, renderer3D) {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left   = -state.frustumSize * aspect / 2;
    camera.right  =  state.frustumSize * aspect / 2;
    camera.top    =  state.frustumSize / 2;
    camera.bottom = -state.frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer3D.setSize(window.innerWidth, window.innerHeight);
    overlay.setSize(window.innerWidth, window.innerHeight);
    if (state.draw.isDrawing && state.draw.hasStart) overlay.recomputeStart2D(state.draw.lineStartPoint);
  }

  return {
    getStartPoint,
    onMouseMove,
    onPointerDown,
    onKeyDown,
    onKeyUp,
    onPointerLockChange,
    onResize
  };
}

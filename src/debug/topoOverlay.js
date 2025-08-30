// ──────────────────────────────────────────────────────────────────────────────
// src/debug/topoOverlay.js
// Färgar nod-spheres efter node.meta.topo. Toggla med overlay.toggle().
// ──────────────────────────────────────────────────────────────────────────────

export function createTopoOverlay({ graph, nodeIdToSphere, addVertexSphere, nodeWorldPos, COLORS }) {
  const originalColors = new Map();
  let active = false;

  const palette = {
    endpoint: 0x35e06f,   // grön
    straight: 0x9aa6b2,   // gråblå
    bend:     0xffd166,   // gul
    tee:      0xff6b6b,   // röd
    junction: 0x8b5cf6,   // lila
    unknown:  0xffffff,   // vit
  };

  function topoColor(topo) {
    return palette[topo] ?? palette.unknown;
  }

  function update() {
    if (!active || typeof graph.allNodes !== 'function') return;
    for (const [nid, n] of graph.allNodes()) {
      let sph = nodeIdToSphere.get(nid);
      if (!sph) {
        // skapa en liten sphere så vi ser noden i overlayn
        const p = nodeWorldPos(n);
        addVertexSphere(p, nid, COLORS.vertex);
        sph = nodeIdToSphere.get(nid);
        if (!sph) continue;
      }
      if (!originalColors.has(nid)) {
        originalColors.set(nid, sph.material.color.getHex());
      }
      const topo = n.meta?.topo ?? 'unknown';
      sph.material.color.setHex(topoColor(topo));
    }
  }

  function toggle(on) {
    const next = on ?? !active;
    if (next === active) return;
    active = next;
    if (!active) {
      // återställ originalfärger
      for (const [nid, hex] of originalColors) {
        const sph = nodeIdToSphere.get(nid);
        if (sph) sph.material.color.setHex(hex);
      }
      originalColors.clear();
    } else {
      update();
    }
  }

  function isActive() { return active; }

  return { toggle, update, isActive };
}

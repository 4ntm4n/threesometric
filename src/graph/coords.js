// src/graph/coords.js
export function nodeWorldPos(n) {
  if (!n) return { x: 0, y: 0, z: 0 };
  if (n.pos) return n.pos;
  const b = n.base || { x: 0, y: 0, z: 0 };
  const o = n.offset || { x: 0, y: 0, z: 0 };
  return {
    x: (b.x ?? 0) + (o.x ?? 0),
    y: (b.y ?? 0) + (o.y ?? 0),
    z: (b.z ?? 0) + (o.z ?? 0),
  };
}
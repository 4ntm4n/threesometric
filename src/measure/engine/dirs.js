import { dominantAxis } from './math.js';

// Enhetsriktning: construction → strikt axelrät; center → verklig (normerad)
export function edgeUnitDirWorld(g, e) {
  const a = g.getNodeWorldPos(e.a), b = g.getNodeWorldPos(e.b);
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;

  if (e.kind === 'construction') {
    const ax = dominantAxis({ x:dx, y:dy, z:dz });
    const sx = (ax === 'X') ? (Math.sign(dx) || 1) : 0;
    const sy = (ax === 'Y') ? (Math.sign(dy) || 1) : 0;
    const sz = (ax === 'Z') ? (Math.sign(dz) || 1) : 0;
    return { x:sx, y:sy, z:sz };
  }
  const L = Math.hypot(dx, dy, dz) || 1;
  return { x:dx/L, y:dy/L, z:dz/L };
}

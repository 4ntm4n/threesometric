// src/measure/engine/lengthUtil.js
import { dominantAxis, dist3 } from './math.js';

/**
 * Returnerar aktuell längd för en kant:
 * - Om lösningens nodpositioner (solNodes) är kända → använd dem
 * - Annars fall tillbaka på world-coords
 * - Construction → strikt axelkomponent, Center → euklidisk
 */
export function edgeCurrentLengthFromSolOrWorld(g, e, solNodes) {
  const aM = solNodes?.get?.(e.a);
  const bM = solNodes?.get?.(e.b);
  if (aM?.known && bM?.known) return dist3(aM, bM);

  const aW = g.getNodeWorldPos(e.a), bW = g.getNodeWorldPos(e.b);
  if (!aW || !bW) return 0;

  if (e.kind === 'construction') {
    const axis = dominantAxis({ x:bW.x-aW.x, y:bW.y-aW.y, z:bW.z-aW.z });
    const k = axis.toLowerCase();
    return Math.abs(bW[k] - aW[k]); // strikt axelkomponent
  }
  return Math.hypot(bW.x-aW.x, bW.y-aW.y, bW.z-aW.z);
}

export function getUserEditedAt(edge) {
  const t = edge?.dim?.userEditedAt;
  return (typeof t === 'number' && isFinite(t)) ? t : Number.NEGATIVE_INFINITY;
}

// sanity-export för snabb koll i Network-tabben
export const __length_ok = true;

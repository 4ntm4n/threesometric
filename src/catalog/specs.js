// src/catalog/specs.js
export const PIPE_SPECS = [
  { id: 'SMS25x1.2', standard: 'SMS', od: 25.0, wt: 1.2, id_mm: 25.0 - 2*1.2, material: '316L' },
  { id: 'SMS38x1.2', standard: 'SMS', od: 38.0, wt: 1.2, id_mm: 38.0 - 2*1.2, material: '316L' },
  { id: 'SMS51x1.2', standard: 'SMS', od: 51.0, wt: 1.2, id_mm: 51.0 - 2*1.2, material: '316L' },
];

export function getSpecById(id) {
  return PIPE_SPECS.find(s => s.id === id) || null;
}
export function indexOfSpec(id) {
  return Math.max(0, PIPE_SPECS.findIndex(s => s.id === id));
}
export function cycleSpec(id, dir = +1) {
  const i = indexOfSpec(id);
  const n = PIPE_SPECS.length;
  return PIPE_SPECS[(i + (dir >= 0 ? 1 : n - 1)) % n].id;
}

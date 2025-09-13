// Rena mattehjälpare
export function dist3(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function dominantAxis(d) {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return 'X';
  if (az >= ax && az >= ay) return 'Z';
  return 'Y';
}

export function validNumber(x) {
  return (typeof x === 'number' && isFinite(x)) ? x : null;
}

// src/core/camera.js
export function isOnScreenPx(camera, canvas, point3D, marginPx = 20) {
  const v = point3D.clone().project(camera);
  if (v.z < -1 || v.z > 1) return false;
  const x = (v.x + 1) * 0.5 * canvas.width;
  const y = (-v.y + 1) * 0.5 * canvas.height;
  return (
    x >= marginPx &&
    x <= canvas.width - marginPx &&
    y >= marginPx &&
    y <= canvas.height - marginPx
  );
}

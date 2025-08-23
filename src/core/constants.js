// ──────────────────────────────────────────────────────────────────────────────
// src/core/constants.js
// ──────────────────────────────────────────────────────────────────────────────
import { THREE } from '../platform/three.js';

export const COLORS = {
  background: 0x0f3a2d,
  gridMajor:  0x3a6f62,
  gridMinor:  0x64b2a3,
  vertex:     0xffdede,
  white:      0xffffff,
};

export const FRUSTUM_SIZE = 20;

export const BASELINE_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-60, -5, -60),
  new THREE.Vector3( 60,  5,  60)
);

export const SNAP_RADIUS_PX = 12;
export const ISO_ANGLES = [30, 90, 150, 210, 270, 330];

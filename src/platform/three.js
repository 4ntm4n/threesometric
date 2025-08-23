// src/platform/three.js
import * as THREE from 'three';
import CameraControls from 'camera-controls';

// Installera kontrollerna exakt en gång, centralt
CameraControls.install({ THREE });

export { THREE, CameraControls };

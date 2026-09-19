// Camera presets, spherical helpers and the cinematic loop.

import * as THREE from 'three';

export const PRESETS = {
  orbit: { r: 14.0, lat: 22, az: 35, label: 'Orbit' },
  pole: { r: 12.0, lat: 78, az: 25, label: 'Pole' },
  edge: { r: 18.0, lat: 4.0, az: 10, label: 'Edge-on' },
  cine: { r: 13.0, lat: 6, az: 0, label: 'Cine' },
};

const D2R = Math.PI / 180;

// lat/az in degrees -> cartesian (Y up, az measured from +Z towards +X)
export function latAzToPos(r, lat, az) {
  const la = lat * D2R;
  const aa = az * D2R;
  return new THREE.Vector3(
    r * Math.cos(la) * Math.sin(aa),
    r * Math.sin(la),
    r * Math.cos(la) * Math.cos(aa)
  );
}

export function applyPreset(camera, presetId, target) {
  const p = PRESETS[presetId] || PRESETS.orbit;
  camera.position.copy(latAzToPos(p.r, p.lat, p.az));
  target.set(0, 0, 0);
  camera.lookAt(target);
}

// ---------------------------------------------------------------- cinematic
// Loop period 75 s; sum-of-sines path => C-infinity smooth, perfectly periodic.
const T = 75;
const TWO_PI = Math.PI * 2;

function s(f) { return Math.sin(TWO_PI * f); }

export function cinematicPose(t) {
  const ph = t / T;
  const az = 360 * ph + 35 * s(ph + 0.11);
  const lat = -4 + 11 * s(ph + 0.24) + 4 * s(2 * ph + 0.53);
  const r = 12.5 + 2.6 * s(ph + 0.08) + 0.9 * s(3 * ph + 0.71);
  const pos = latAzToPos(Math.min(Math.max(r, 9.5), 16.0), Math.min(Math.max(lat, -40), 58), az);
  const tx = 0.30 * s(ph * 1.0 + 0.10) + 0.12 * s(ph * 2.3 + 1.1);
  const ty = 0.22 * s(ph * 1.4 + 0.60);
  const tz = 0.30 * s(ph * 0.8 + 0.90);
  const fov = 45 + 2.6 * s(2 * ph + 0.31);
  return { pos, target: new THREE.Vector3(tx, ty, tz), fov };
}

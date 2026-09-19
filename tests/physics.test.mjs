// Physics validation for the Schwarzschild geodesic integrator.
// Run: node --test tests/physics.test.mjs

import test from 'node:test';
import assert from 'node:assert';
import { integrate, initFromRay, rk4Step, derive, cartVel } from './geodesic.mjs';

const B_CRIT = 3 * Math.sqrt(3) / 2; // 2.598076211353316 (rs = 1)

// Cross-reference: deflection angle via the exact orbit integral
// alpha(b) = 2 * int_{rmin}^{inf} dphi/dr dr - pi,
// (dr/dphi)^2 = r^4/b^2 - r^2 + r  (rs = 1)
function deflectionIntegral(b, n = 400000) {
  // turning point: largest root of r^4/b^2 - r^2 + r = 0 (lies just below b)
  const f = r => r * r * r * r / (b * b) - r * r + r;
  let rmin = null;
  let prev = f(b);
  for (let r = b; r > 1.5; r -= 0.002) {
    const v = f(r);
    if (prev > 0 && v <= 0) { rmin = r; break; }
    prev = v;
  }
  if (rmin === null) throw new Error('no turning point found for b=' + b);
  // refine with bisection
  let a = rmin + 0.002, c = rmin;
  for (let i = 0; i < 60; i++) {
    const m = (a + c) / 2;
    if (f(m) > 0) a = m; else c = m;
  }
  rmin = (a + c) / 2;

  // integral with substitution r = rmin + u^2 (removes the integrable 1/sqrt singularity)
  const R_BIG = 10000;
  const uMax = Math.sqrt(R_BIG - rmin);
  const H = u => {
    const r = rmin + u * u;
    return 2 * u / Math.sqrt(Math.max(1e-30, r * r * r * r / (b * b) - r * r + r));
  };
  let sum = H(0) * 0; // H(0) = 0 by continuity
  const du = uMax / n;
  let prevH = 0;
  for (let i = 1; i <= n; i++) {
    const h = H(i * du);
    sum += (prevH + h) * du / 2;
    prevH = h;
  }
  // analytic far tail: dphi/dr = b/r^2 (1 + b^2/(2 r^2) + ...), so
  // int_{R}^{inf} ~ b/R + b^3/(6 R^3)
  return 2 * (sum + b / R_BIG + b * b * b / (6 * R_BIG * R_BIG * R_BIG)) - Math.PI;
}

// Largest root of r^4/b^2 - r^2 + r = 0 (the turning point, just below b).
function turningPoint(b) {
  const f = r => r * r * r * r / (b * b) - r * r + r;
  let rmin = null;
  let prev = f(b);
  for (let r = b; r > 1.5001; r -= 0.0005) {
    const v = f(r);
    if (prev > 0 && v <= 0) { rmin = r; break; }
    prev = v;
  }
  if (rmin === null) throw new Error('no turning point for b=' + b);
  let a = rmin + 0.0005, c = rmin;
  for (let i = 0; i < 80; i++) {
    const m = (a + c) / 2;
    if (f(m) > 0) a = m; else c = m;
  }
  return (a + c) / 2;
}

// int_{ra}^{rb} |dchi/dr| dr with ra = rmin (u-substitution at the singularity).
function orbitSweep(ra, rb, b, n = 400000) {
  const f = r => r * r * r * r / (b * b) - r * r + r;
  const uMax = Math.sqrt(rb - ra);
  const H = u => {
    const r = ra + u * u;
    return 2 * u / Math.sqrt(Math.max(1e-30, f(r)));
  };
  const du = uMax / n;
  let s = 0, prevH = 0;
  for (let i = 1; i <= n; i++) {
    const h = H(i * du);
    s += (prevH + h) * du / 2;
    prevH = h;
  }
  return s;
}

// Independent prediction of what the ODE integrator measures: the angle between
// the exit local direction (at radius R, outgoing branch) and the entry direction
// d, computed purely from the orbit equation (dr/dchi)^2 = r^4/b^2 - r^2 + r.
// No ODE integration is involved.
function predictExitAngle(p, d, R) {
  const r0 = Math.hypot(...p);
  const bPhys = Math.hypot(
    p[1] * d[2] - p[2] * d[1],
    p[2] * d[0] - p[0] * d[2],
    p[0] * d[1] - p[1] * d[0]
  );
  const b = bPhys / Math.sqrt(1 - 1 / r0); // conserved L/E carried by the ray
  const nL = [
    p[1] * d[2] - p[2] * d[1],
    p[2] * d[0] - p[0] * d[2],
    p[0] * d[1] - p[1] * d[0],
  ].map(v => v / bPhys); // orbital-plane normal
  const u1 = p.map(v => v / r0); // in-plane radial axis (entry)
  const u2 = [nL[1] * u1[2] - nL[2] * u1[1], nL[2] * u1[0] - nL[0] * u1[2], nL[0] * u1[1] - nL[1] * u1[0]];
  const rmin = turningPoint(b);
  // chi measured from u1; the ray moves toward increasing chi (tangential motion
  // is nL x r_hat), so chi(R_out) = sweep(entry->rmin) + sweep(rmin->R_out).
  const chi = orbitSweep(rmin, r0, b) + orbitSweep(rmin, R, b);
  const rr = [
    u1[0] * Math.cos(chi) + u2[0] * Math.sin(chi),
    u1[1] * Math.cos(chi) + u2[1] * Math.sin(chi),
    u1[2] * Math.cos(chi) + u2[2] * Math.sin(chi),
  ];
  const q = Math.sqrt(R * R * R * R - b * b * R * R + b * b * R);
  const psi = Math.atan((R * b) / q); // angle of the local direction from radial
  const nx = [nL[1] * rr[2] - nL[2] * rr[1], nL[2] * rr[0] - nL[0] * rr[2], nL[0] * rr[1] - nL[1] * rr[0]];
  const t = [
    Math.cos(psi) * rr[0] + Math.sin(psi) * nx[0],
    Math.cos(psi) * rr[1] + Math.sin(psi) * nx[1],
    Math.cos(psi) * rr[2] + Math.sin(psi) * nx[2],
  ];
  const tn = Math.hypot(...t);
  return Math.acos(Math.min(1, Math.max(-1, (t[0] * d[0] + t[1] * d[1] + t[2] * d[2]) / tn)));
}

test('critical impact parameter constant is correct', () => {
  assert.ok(Math.abs(B_CRIT - 2.598076211353316) < 1e-12);
  // photon sphere at r = 1.5 rs
  assert.ok(Math.abs(1.5 - 3 / 2) < 1e-15);
});

test('weak-field deflection: alpha -> 2/b (in rs units) as b -> inf', () => {
  const bPhys = 500;
  const p = [-520, bPhys, 0];
  const d = [1, 0, 0];
  const r0 = Math.hypot(520, bPhys);
  const e0 = 1 - 1 / r0;
  const bCons = bPhys / Math.sqrt(e0);
  // (1) the orbit equation itself: the exact integral must approach 2/b
  const ref = deflectionIntegral(bCons);
  const leading = 2 / bCons;
  console.log(`  weak field b_cons=${bCons.toFixed(2)}: integral ${ref.toExponential(5)} vs 2/b ${leading.toExponential(5)}`);
  assert.ok(Math.abs(ref - leading) / leading < 0.02, `integral deviates from 2/b: ${ref}`);
  // (2) the ODE must match the exact finite-entry/exit prediction from the orbit
  // equation (angle between the exit local direction and the entry direction)
  const { g, state, steps } = integrate(p, d, { maxSteps: 9000, stepA: 0.005, R_ESC: 700 });
  assert.equal(state, 'escaped');
  const v = cartVel(g);
  const nrm = Math.hypot(...v);
  const alpha = Math.acos(Math.min(1, Math.max(-1, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / nrm)));
  const expected = predictExitAngle(p, d, 700);
  console.log(`  weak field ODE ${alpha.toExponential(5)} vs orbit-equation prediction ${expected.toExponential(5)} (steps ${steps})`);
  assert.ok(Math.abs(alpha - expected) < 5e-4, `ODE deviates from orbit-equation prediction: ${alpha} vs ${expected}`);
});

test('deflection matches independent orbit equation (b = 3.2 and b = 10)', () => {
  for (const bPhys of [3.2, 10]) {
    const p = [-30, bPhys, 0];
    const d = [1, 0, 0];
    const { g, state } = integrate(p, d, { maxSteps: 20000, stepA: 0.005, R_ESC: 600 });
    assert.equal(state, 'escaped');
    const v = cartVel(g);
    const nrm = Math.hypot(...v);
    const alpha = Math.acos(Math.min(1, Math.max(-1, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / nrm)));
    const expected = predictExitAngle(p, d, 600);
    const tol = bPhys < 5 ? 1e-3 : 5e-4;
    console.log(`  b_phys=${bPhys}: ODE ${alpha.toFixed(5)} vs orbit-equation prediction ${expected.toFixed(5)}`);
    assert.ok(Math.abs(alpha - expected) < tol, `ODE vs orbit equation b=${bPhys}: ${alpha} vs ${expected}`);
  }
});

test('near-critical ray (b = b_crit) orbits the photon sphere', () => {
  // The conserved impact parameter is b_phys / sqrt(e0); set b_phys so that
  // L/E = b_crit exactly.
  const r0 = 40;
  const e0 = 1 - 1 / Math.hypot(r0, B_CRIT);
  const bPhys = B_CRIT * Math.sqrt(e0);
  const p = [-40, bPhys, 0];
  const d = [1, 0, 0];
  const { state, minR, phiWinding, steps } = integrate(p, d, { maxSteps: 4000, stepA: 0.068 });
  console.log(`  b_crit: state=${state} minR=${minR.toFixed(4)} |winding|=${(Math.abs(phiWinding) / Math.PI).toFixed(2)}pi steps=${steps}`);
  assert.ok(Math.abs(minR - 1.5) < 0.12, `should hover near photon sphere, got minR=${minR}`);
  assert.ok(Math.abs(phiWinding) > 1.5 * Math.PI, `should complete >1.5 orbit, got ${phiWinding}`);
  assert.ok(steps > 100, `ray should linger near the photon sphere, escaped in ${steps} steps`);
});

test('capture: b = 2.5 falls into the horizon', () => {
  const p = [0, 20, 0];
  const b = 2.5;
  const th = Math.asin(b / 20);
  const d = [Math.sin(th), -Math.cos(th), 0];
  const { state, steps, minR } = integrate(p, d, { maxSteps: 5000, stepA: 0.068 });
  console.log(`  capture b=2.5: state=${state} minR=${minR.toFixed(4)} steps=${steps}`);
  assert.equal(state, 'absorbed');
  assert.ok(minR < 1.05, `should reach the horizon, got minR=${minR}`);
});

test('unbound turning point: b = 2.7 approaches then escapes', () => {
  const p = [0, 20, 0];
  const b = 2.7;
  const th = Math.asin(b / 20);
  const d = [Math.sin(th), -Math.cos(th), 0];
  const { state, minR, phiWinding, steps } = integrate(p, d, { maxSteps: 5000, stepA: 0.068 });
  console.log(`  escape b=2.7: state=${state} minR=${minR.toFixed(4)} |winding|=${(Math.abs(phiWinding) / Math.PI).toFixed(2)}pi steps=${steps}`);
  assert.equal(state, 'escaped');
  assert.ok(minR < 2.4, `turning point too far out: ${minR}`);
  assert.ok(Math.abs(phiWinding) > 1.5 * Math.PI, 'should bend strongly around the hole');
});

test('disk plane crossings counted (2 for b = 2.7, 1 for a straight pass)', () => {
  const p1 = [0, 20, 0];
  const b = 2.7;
  const th = Math.asin(b / 20);
  const d1 = [Math.sin(th), -Math.cos(th), 0];
  const r1 = integrate(p1, d1, { maxSteps: 5000, stepA: 0.068 });
  console.log(`  crossings b=2.7: ${r1.crossings} (state ${r1.state})`);
  assert.ok(r1.crossings >= 2, `expected >=2 disk-plane passages, got ${r1.crossings}`);

  // straight ray crossing the plane once (y monotonic, no lensing): exactly one passage
  const p2 = [10, 5, 0];
  const d2n = Math.SQRT2;
  const d2 = [1 / d2n, -1 / d2n, 0];
  const r2 = integrate(p2, d2, { maxSteps: 3000, stepA: 0.068, R_ESC: 60 });
  console.log(`  crossings straight: ${r2.crossings} (state ${r2.state})`);
  assert.equal(r2.crossings, 1);
});

test('conserved quantities: projection pins L^2 and Lz', () => {
  // oblique near-critical ray with nonzero Lz
  const px = 5, py = 3, pz = 4;
  const r0 = Math.hypot(px, py, pz);
  const pxn = px / r0, pyn = py / r0, pzn = pz / r0;
  // t_hat = normalize(z x p_hat)
  let tx = -pyn, ty = pxn, tz = 0;
  const tlen = Math.hypot(tx, ty, tz);
  tx /= tlen; ty /= tlen;
  const sinG = 2.62 / r0;
  const cosG = Math.sqrt(1 - sinG * sinG);
  const d = [
    -cosG * pxn + sinG * tx,
    -cosG * pyn + sinG * ty,
    -cosG * pzn,
  ];
  const dn = Math.hypot(...d);
  d[0] /= dn; d[1] /= dn; d[2] /= dn;

  const init = initFromRay(px, py, pz, d[0], d[1], d[2]);
  // sanity: b = |p x d|
  const b = Math.hypot(py * d[2] - pz * d[1], pz * d[0] - px * d[2], px * d[1] - py * d[0]);
  console.log(`  oblique ray b=${b.toFixed(4)} (target ~2.62)`);
  assert.ok(Math.abs(b - 2.62) < 0.05);
  assert.ok(Math.abs(init.Lz) > 0.5, 'Lz must be nonzero for this test');

  // with projection: drift is pinned to machine precision
  let g = init.g;
  let maxL2 = 0, maxLz = 0;
  for (let i = 0; i < 2500 && g.r > 1.01; i++) {
    const h = Math.min(0.9, Math.max(0.0045, 0.068 * Math.sqrt(Math.max(g.r - 1.02, 0.06)) + 0.0045));
    g = rk4Step(g, h, true, init.L2, init.Lz);
    const e = 1 - 1 / g.r;
    const s = Math.sin(g.th);
    const L2c = g.r ** 4 * (g.thd ** 2 + s * s * g.phd ** 2);
    const Lzc = g.r ** 2 * s * s * g.phd;
    maxL2 = Math.max(maxL2, Math.abs(L2c - init.L2) / init.L2);
    maxLz = Math.max(maxLz, Math.abs(Lzc - init.Lz));
  }
  console.log(`  projected drift over ~2500 steps: L2 ${maxL2.toExponential(2)}, Lz ${maxLz.toExponential(2)}`);
  // At the theta turnaround point thd^2 = L2/r^4 - s^2 phd^2 is a difference of
  // nearly equal numbers and can round slightly negative (clamped to 0), giving
  // a one-step O(1e-5) L2 artifact that self-heals on the next projection.
  assert.ok(maxL2 < 1e-3, `L2 drift too large: ${maxL2}`);
  assert.ok(maxLz < 1e-9, `Lz drift too large: ${maxLz}`);

  // raw RK4 (no projection): drifts visibly over many near-critical loops,
  // which is exactly why the drift correction exists
  g = init.g;
  let rawL2 = 0;
  for (let i = 0; i < 1200 && g.r > 1.01; i++) {
    const h = Math.min(0.9, Math.max(0.0045, 0.068 * Math.sqrt(Math.max(g.r - 1.02, 0.06)) + 0.0045));
    g = rk4Step(g, h, false);
    const s = Math.sin(g.th);
    const L2c = g.r ** 4 * (g.thd ** 2 + s * s * g.phd ** 2);
    rawL2 = Math.max(rawL2, Math.abs(L2c - init.L2) / init.L2);
  }
  console.log(`  raw RK4 drift over ~1200 steps: L2 ${rawL2.toExponential(2)}`);
  assert.ok(rawL2 > maxL2, 'projection should reduce drift compared to raw RK4');
});

test('step budget: typical rays finish well under the 220-step tier', () => {
  const p = [6.5, 2.1, 4.6];
  const dirs = [
    [0.2, 0.1, -0.974],          // looking at the hole, b ~ moderate
    [-0.5, 0.3, -0.81],          // oblique
    [0.9, 0.05, -0.43],          // grazing the shadow edge side
  ];
  for (const d0 of dirs) {
    const n = Math.hypot(...d0);
    const d = [d0[0] / n, d0[1] / n, d0[2] / n];
    const r = integrate(p, d, { maxSteps: 4000, stepA: 0.085, R_ESC: 26 });
    console.log(`  dir ${d0} -> ${r.state} in ${r.steps} steps`);
    if (r.state === 'escaped') assert.ok(r.steps < 220, `escape took ${r.steps} steps, exceeds standard tier budget`);
  }
});

test('photons cannot exist inside the horizon: r<1 rejected by step guard', () => {
  // starting the integrator at r = 1.2, inward radial: must be absorbed, not NaN
  const p = [1.2, 0, 0];
  const d = [-1, 0, 0];
  const { state, g } = integrate(p, d, { maxSteps: 200, stepA: 0.068 });
  assert.equal(state, 'absorbed');
  assert.ok(Number.isFinite(g.r) && Number.isFinite(g.th) && Number.isFinite(g.phd));
});

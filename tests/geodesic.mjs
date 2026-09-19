// Double-precision port of the GLSL geodesic integrator (same formulas).
// Used by tests to validate the physics before it ships in the shader.

export class Geo {
  constructor(r, th, ph, rd, thd, phd) {
    this.r = r; this.th = th; this.ph = ph;
    this.rd = rd; this.thd = thd; this.phd = phd;
  }
}

export function derive(g) {
  const r = g.r, th = g.th, rd = g.rd, thd = g.thd, phd = g.phd;
  const s = Math.sin(th);
  const c = Math.cos(th);
  // Schwarzschild, E = 1 (rd/thd/phd are coordinate derivatives per this affine
  // parameter). The Gamma^r_tt and Gamma^r_rr (rd^2) terms cancel via the null
  // constraint, leaving exactly:  r'' = (r - 3/2)(th'^2 + sin^2(th) ph'^2).
  const drd = (r - 1.5) * (thd * thd + s * s * phd * phd);
  const dthd = -rd * thd / r + s * c * phd * phd;
  const dphd = -phd * rd / r - (c / Math.max(s, 1e-4)) * thd * phd;
  return { dp: [rd, thd, phd], dv: [drd, dthd, dphd] };
}

function add(g, k, h) {
  return new Geo(
    g.r + h * k.dp[0], g.th + h * k.dp[1], g.ph + h * k.dp[2],
    g.rd + h * k.dv[0], g.thd + h * k.dv[1], g.phd + h * k.dv[2]
  );
}

export function rk4Step(g, h, withProjection = true, L2 = 0, Lz = 0) {
  const k1 = derive(g);
  const g2 = add(g, k1, 0.5 * h);
  const k2 = derive(g2);
  const g3 = add(g, k2, 0.5 * h);
  const k3 = derive(g3);
  const g4 = add(g, k3, h);
  const k4 = derive(g4);

  const out = new Geo(
    g.r + h / 6 * (k1.dp[0] + 2 * k2.dp[0] + 2 * k3.dp[0] + k4.dp[0]),
    g.th + h / 6 * (k1.dp[1] + 2 * k2.dp[1] + 2 * k3.dp[1] + k4.dp[1]),
    g.ph + h / 6 * (k1.dp[2] + 2 * k2.dp[2] + 2 * k3.dp[2] + k4.dp[2]),
    g.rd + h / 6 * (k1.dv[0] + 2 * k2.dv[0] + 2 * k3.dv[0] + k4.dv[0]),
    g.thd + h / 6 * (k1.dv[1] + 2 * k2.dv[1] + 2 * k3.dv[1] + k4.dv[1]),
    g.phd + h / 6 * (k1.dv[2] + 2 * k2.dv[2] + 2 * k3.dv[2] + k4.dv[2])
  );

  if (withProjection) {
    const e = 1 - 1 / Math.max(out.r, 1.0001);
    const s = Math.sin(out.th);
    out.phd = Lz / (out.r * out.r * Math.max(s * s, 1e-9));
    const thd2 = L2 / (out.r ** 4) - out.phd * out.phd * s * s;
    const rd2 = 1 - e * L2 / (out.r * out.r);
    out.thd = Math.sign(out.thd || 1) * Math.sqrt(Math.max(thd2, 0));
    out.rd = Math.sign(out.rd || 1) * Math.sqrt(Math.max(rd2, 0));
    out.r = Math.max(out.r, 0.9);
  }
  return out;
}

// Initial state from camera position p=[x,y,z] and unit direction d=[x,y,z]
export function initFromRay(px, py, pz, dx, dy, dz, stepA = 0.068) {
  const r0 = Math.hypot(px, py, pz);
  const nx = px / r0, ny = py / r0, nz = pz / r0;
  const th0 = Math.acos(Math.min(1, Math.max(-1, ny)));
  const ph0 = Math.atan2(nz, nx);
  const s0 = Math.max(Math.sin(th0), 1e-5);
  const e0 = 1 - 1 / r0;
  const se0 = Math.sqrt(Math.max(e0, 1e-6));

  const eR = [nx, ny, nz];
  const eTh = [Math.cos(th0) * Math.cos(ph0), -Math.sin(th0), Math.cos(th0) * Math.sin(ph0)];
  const ePh = [-Math.sin(ph0), 0, Math.cos(ph0)];
  const dr0 = dx * eR[0] + dy * eR[1] + dz * eR[2];
  const dth = dx * eTh[0] + dy * eTh[1] + dz * eTh[2];
  const dph = dx * ePh[0] + dy * ePh[1] + dz * ePh[2];

  const rd0 = dr0;
  const thd0 = dth / (r0 * se0);
  const phd0 = dph / (r0 * s0 * se0);
  const L2 = r0 * r0 * (1 - dr0 * dr0) / e0;
  const Lz = r0 * s0 * dph / se0;

  return {
    g: new Geo(r0, th0, ph0, rd0, thd0, phd0),
    L2, Lz, stepA,
    r0,
  };
}

export function stepH(r, stepA) {
  return Math.min(0.9, Math.max(0.0045, stepA * Math.sqrt(Math.max(r - 1.02, 0.06)) + 0.0045));
}

export function cart(g) {
  const s = Math.sin(g.th);
  return [
    s * Math.cos(g.ph) * g.r,
    Math.cos(g.th) * g.r,
    s * Math.sin(g.ph) * g.r,
  ];
}

export function cartVel(g) {
  const s = Math.sin(g.th);
  const c = Math.cos(g.th);
  const er = [s * Math.cos(g.ph), c, s * Math.sin(g.ph)];
  const eTh = [Math.cos(g.th) * Math.cos(g.ph), -s, Math.cos(g.th) * Math.sin(g.ph)];
  const ePh = [-Math.sin(g.ph), 0, Math.cos(g.ph)];
  return [
    g.rd * er[0] + g.r * g.thd * eTh[0] + g.r * s * g.phd * ePh[0],
    g.rd * er[1] + g.r * g.thd * eTh[1] + g.r * s * g.phd * ePh[1],
    g.rd * er[2] + g.r * g.thd * eTh[2] + g.r * s * g.phd * ePh[2],
  ];
}

/**
 * Integrate a ray. Returns:
 *  { state: 'absorbed'|'escaped'|'inflight', steps, g, crossings, minR, phiWinding }
 */
export function integrate(p, d, { maxSteps = 4000, stepA = 0.068, R_ESC = 40, track = false } = {}) {
  const init = initFromRay(p[0], p[1], p[2], d[0], d[1], d[2], stepA);
  let g = init.g;
  let state = 'inflight';
  let steps = 0;
  let minR = Infinity;
  let prevY = p[1];
  let crossings = 0;
  let phiWinding = 0;
  let maxDriftL2 = 0, maxDriftLz = 0;

  // orbital-plane normal (for winding counting that also works for
  // rays whose plane contains the pole, where the global phi is constant)
  const Lvec = [
    p[1] * d[2] - p[2] * d[1],
    p[2] * d[0] - p[0] * d[2],
    p[0] * d[1] - p[1] * d[0],
  ];
  const Lnorm = Math.hypot(...Lvec);
  const nL = Lnorm > 1e-12 ? Lvec.map(v => v / Lnorm) : null;
  let prevCart = [p[0], p[1], p[2]];

  for (let i = 0; i < maxSteps; i++) {
    steps = i;
    if (track) {
      // measure conserved-quantity drift directly
      const e = 1 - 1 / g.r;
      const s = Math.sin(g.th);
      const L2c = g.r ** 4 * (g.thd * g.thd + s * s * g.phd * g.phd);
      const Lzc = g.r * g.r * s * s * g.phd;
      maxDriftL2 = Math.max(maxDriftL2, Math.abs(L2c - init.L2) / Math.max(init.L2, 1e-9));
      maxDriftLz = Math.max(maxDriftLz, Math.abs(Lzc - init.Lz) / 1.0);
    }
    if (g.r < 1.0045) { state = 'absorbed'; break; }
    if (g.r > R_ESC && g.rd > 0) { state = 'escaped'; break; }
    minR = Math.min(minR, g.r);

    const h = stepH(g.r, init.stepA);
    g = rk4Step(g, h, true, init.L2, init.Lz);

    // winding around the orbital-plane normal
    if (nL) {
      const cur = cart(g);
      const cx = cur[1] * prevCart[2] - cur[2] * prevCart[1];
      const cy = cur[2] * prevCart[0] - cur[0] * prevCart[2];
      const cz = cur[0] * prevCart[1] - cur[1] * prevCart[0];
      const dotc = cx * nL[0] + cy * nL[1] + cz * nL[2];
      const dotd = cur[0] * prevCart[0] + cur[1] * prevCart[1] + cur[2] * prevCart[2];
      phiWinding += Math.atan2(dotc, dotd);
      prevCart = cur;
    }

    // disk-plane passage counter (y = 0): count every sign change
    const yNow = Math.cos(g.th) * g.r;
    if (prevY !== 0 && yNow !== 0 && (prevY > 0) !== (yNow > 0)) crossings++;
    prevY = yNow;
  }

  return { state, steps, g, crossings, minR, phiWinding, maxDriftL2, maxDriftLz };
}

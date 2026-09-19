// GARGANTUA — Schwarzschild black hole raytracer (main fragment shader)
// Full null-geodesic integration in the Schwarzschild metric (rs = 1),
// RK4 + drift-correcting velocity reprojection, volumetric accretion disk,
// procedural starfield / galaxy, gravitational lensing, Doppler beaming,
// gravitational redshift.
//
// Placeholders substituted at compile time:
//   @@MAX_STEPS@@ — integration step budget (int)
//   @@STEP_A@@    — step-size scale (float)
//   @@HALF_FLOAT_OK@@ — 1.0 / 0.0 (informational)

export const SCENE_VERTEX = `precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const SCENE_FRAGMENT = `precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uCamFwd;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform float uTanFov;
uniform int   uDebug;

// accretion disk
uniform float uDiskRIn;
uniform float uDiskROut;
uniform float uDiskH0;
uniform float uDiskFlare;
uniform float uDiskOpacity;
uniform float uDiskTemp;
uniform float uDiskEmis;
uniform float uDiskTurb;
uniform float uDiskTurbSpd;
uniform float uDiskSwirl;
uniform float uDiskPrecess;
// relativistic effects
uniform float uDoppler;
uniform float uRedshift;
// background
uniform float uStars;
uniform float uGalaxy;
uniform float uDust;

#define RS 1.0
#define R_HORIZON 1.0
#define R_HORIZON_HIT 1.0045
#define R_ESC 26.0
#define SIGMA_CUT 7.5
#define EMIT_SCALE 0.065
#define MAX_STEPS @@MAX_STEPS@@
#define STEP_A @@STEP_A@@

// ---------------------------------------------------------------- hashing
float h13(vec3 p) {
  p = fract(p * 0.1031 + 0.53);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec3 h33(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 269.5, 113.5)),
    dot(p, vec3(269.5, 183.3, 271.9)),
    dot(p, vec3(113.5, 271.9, 183.3))
  ) * 0.017 + 0.71;
  p = fract(p) + dot(p, p.xyx + 19.19);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float h21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

// ---------------------------------------------------------------- noise
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h13(i);
  float b = h13(i + vec3(1.0, 0.0, 0.0));
  float c = h13(i + vec3(0.0, 1.0, 0.0));
  float d = h13(i + vec3(1.0, 1.0, 0.0));
  float e = h13(i + vec3(0.0, 0.0, 1.0));
  float g = h13(i + vec3(1.0, 0.0, 1.0));
  float h = h13(i + vec3(0.0, 1.0, 1.0));
  float k = h13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

float fbm3(vec3 p) {
  float s = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    s += amp * vnoise3(p);
    p = p * 2.13 + 11.7;
    amp *= 0.5;
  }
  return s;
}

float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21(i);
  float b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0));
  float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2(vec2 p) {
  float s = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    s += amp * vnoise2(p);
    p = p * 2.17 + 7.31;
    amp *= 0.5;
  }
  return s;
}

// ---------------------------------------------------------------- color
vec3 blackbody(float T) {
  float t = clamp(T / 100.0, 2.0, 400.0);
  float r, g, b;
  if (t <= 66.0) {
    r = 255.0;
    g = 99.4708025861 * log(t) - 161.1195681601;
    b = t <= 19.0 ? 0.0 : 138.5177312231 * log(t - 10.0) - 317.2845675305;
  } else {
    r = 329.698727446 * pow(t - 10.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 10.0, -0.0755148492);
    b = 255.0;
  }
  return clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
}

vec3 rainbow(float t) {
  return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
}

// ---------------------------------------------------------------- background
void addStars(vec3 d, out vec3 cO, float scale, float thresh, float amp, bool twinkle) {
  vec3 g = floor(d * scale);
  vec3 h = h33(g);
  if (h.x < thresh) {
    vec3 f = fract(d * scale) - 0.5 - (h * 2.0 - 1.0) * 0.40;
    float r2 = dot(f, f);
    float s = smoothstep(0.10, 0.015, r2) * (0.35 + 0.65 * h.z);
    vec3 tint = mix(vec3(1.0, 0.82, 0.60), vec3(0.62, 0.78, 1.0), h33(g + 31.7).x);
    float tw = 1.0;
    if (twinkle) {
      tw = 0.78 + 0.22 * sin(uTime * (0.3 + 2.2 * h.y) + h.z * 43.7);
    }
    cO += tint * s * amp * tw;
  }
}

vec3 galaxy(vec3 d) {
  vec3 gp = normalize(vec3(0.30, 0.945, 0.155));
  float w = dot(d, gp);
  float sg = 0.135;
  float band = exp(-w * w / (2.0 * sg * sg));
  vec3 e1 = normalize(cross(gp, vec3(0.0, 0.0, 1.0)));
  vec3 e2 = cross(gp, e1);
  float u = atan(dot(d, e2), dot(d, e1));
  float v = asin(clamp(w, -1.0, 1.0));
  vec2 p2 = vec2(u * 3.0, v * 9.0 - u * 1.7);
  float fil = 0.25 + 0.95 * smoothstep(0.34, 0.78, fbm2(p2 * 1.9));
  float clump = fbm2(p2 * 4.7 + 9.2);
  float dustM = fbm2(p2 * 2.6 + 23.1);
  float u0 = -1.15;
  float core = exp(-pow(length(vec2(u - u0, v * 3.2)), 2.0) / 0.6);
  vec3 col = mix(vec3(0.52, 0.66, 1.0), vec3(1.0, 0.93, 0.80), clamp(0.40 + 0.60 * core + 0.30 * fil, 0.0, 1.0));
  float dustDark = smoothstep(0.45, 0.85, dustM) * (1.0 - 0.35 * fil);
  float I = band * (0.16 + 0.62 * fil * fil + 0.45 * clump * band) * (1.0 - uDust * dustDark * 0.9);
  I += core * 0.85;
  return col * I * 0.6;
}

vec3 background(vec3 d) {
  vec3 c = vec3(0.008, 0.012, 0.020) * (0.55 + 0.45 * h13(d * 2.3 + 1.7));
  vec3 st = vec3(0.0);
  addStars(d, st, 760.0, 0.00042, 2.4, true);
  addStars(d, st, 400.0, 0.0038, 0.55, false);
  addStars(d, st, 190.0, 0.020, 0.13, false);
  c += st * uStars;
  c += galaxy(d) * uGalaxy;
  c += vec3(0.012, 0.016, 0.030) * 0.35 * exp(-pow(dot(d, vec3(-0.62, 0.25, -0.74)) * 3.0 - 1.0, 2.0));
  return c;
}

// ---------------------------------------------------------------- geometry
vec3 cart(float r, float th, float ph) {
  float s = sin(th);
  return vec3(s * cos(ph), cos(th), s * sin(ph)) * r;
}

vec3 cartVel(float r, float th, float ph, float rd, float thd, float phd) {
  float s = sin(th);
  vec3 er  = vec3(s * cos(ph), cos(th), s * sin(ph));
  vec3 eTh = vec3(cos(th) * cos(ph), -s, cos(th) * sin(ph));
  vec3 ePh = vec3(-sin(ph), 0.0, cos(ph));
  return rd * er + r * thd * eTh + r * s * phd * ePh;
}

// ---------------------------------------------------------------- geodesic
// state: r, th, ph (position), rd, thd, phd (derivatives w.r.t. affine lambda)
// conserved: E = 1, L2 = |L|^2, Lz = L.y
void derive(float r, float th, float ph, float rd, float thd, float phd,
            out vec3 dp, out vec3 dv) {
  float s = sin(th);
  float c = cos(th);
  // dp/dlambda
  dp = vec3(rd, thd, phd);
  // dv/dlambda (Schwarzschild, E = 1). Using the null constraint
  // rd^2 + e*(r*thd)^2 + e*(r*s*phd)^2 = 1, the -Gamma^r_tt*t'^2 and
  // -Gamma^r_rr*rd^2 terms cancel, leaving exactly:
  //   r'' = (r - 3/2) * (th'^2 + sin^2(th)*ph'^2)
  float drd = (r - 1.5) * (thd * thd + s * s * phd * phd);
  float dthd = -rd * thd / r + s * c * phd * phd;
  float dphd = -phd * rd / r - (c / max(s, 1e-4)) * thd * phd;
  dv = vec3(drd, dthd, dphd);
}

float stepH(float r) {
  return clamp(STEP_A * sqrt(max(r - 1.02, 0.06)) + 0.0045, 0.0045, 0.9);
}

// RK4 step; gMid is the 0.5h substage state (good midpoint position)
void rk4Step(float r, float th, float ph, float rd, float thd, float phd, float h,
             out float nr, out float nth, out float nph, out float nrd, out float nthd, out float nphd,
             out float mr, out float mth, out float mph) {
  vec3 p1, v1, p2, v2, p3, v3, p4, v4;
  derive(r, th, ph, rd, thd, phd, p1, v1);
  float r2 = r + 0.5 * h * p1.x;
  float th2 = th + 0.5 * h * p1.y;
  float ph2 = ph + 0.5 * h * p1.z;
  derive(r2, th2, ph2, rd + 0.5 * h * v1.x, thd + 0.5 * h * v1.y, phd + 0.5 * h * v1.z, p2, v2);
  float r3 = r + 0.5 * h * p2.x;
  float th3 = th + 0.5 * h * p2.y;
  float ph3 = ph + 0.5 * h * p2.z;
  derive(r3, th3, ph3, rd + 0.5 * h * v2.x, thd + 0.5 * h * v2.y, phd + 0.5 * h * v2.z, p3, v3);
  mr = r3; mth = th3; mph = ph3;
  float r4 = r + h * p3.x;
  float th4 = th + h * p3.y;
  float ph4 = ph + h * p3.z;
  derive(r4, th4, ph4, rd + h * v3.x, thd + h * v3.y, phd + h * v3.z, p4, v4);
  nr = r + h / 6.0 * (p1.x + 2.0 * p2.x + 2.0 * p3.x + p4.x);
  nth = th + h / 6.0 * (p1.y + 2.0 * p2.y + 2.0 * p3.y + p4.y);
  nph = ph + h / 6.0 * (p1.z + 2.0 * p2.z + 2.0 * p3.z + p4.z);
  nrd = rd + h / 6.0 * (v1.x + 2.0 * v2.x + 2.0 * v3.x + v4.x);
  nthd = thd + h / 6.0 * (v1.y + 2.0 * v2.y + 2.0 * v3.y + v4.y);
  nphd = phd + h / 6.0 * (v1.z + 2.0 * v2.z + 2.0 * v3.z + v4.z);
}

// ---------------------------------------------------------------- disk
float diskH(float mR) {
  return uDiskH0 * pow(max(mR, 0.4) / 3.0, uDiskFlare);
}

// returns 0 when no disk present, else fills density/emission-related outputs
float diskSample(vec3 mp, out float deltaOut, out float gGravOut, out vec3 emitOut,
                 out bool inDiskOut) {
  float mR = length(mp.xz);
  float H = diskH(mR);
  float vert = exp(-(mp.y * mp.y) / (2.0 * H * H));
  if (vert < 1e-4) {
    deltaOut = 1.0; gGravOut = 1.0; emitOut = vec3(0.0); inDiskOut = false;
    return 0.0;
  }
  float radial = smoothstep(uDiskRIn, uDiskRIn + 0.35, mR) *
                 (1.0 - smoothstep(uDiskROut * 0.5, uDiskROut, mR));
  if (radial < 1e-3) {
    deltaOut = 1.0; gGravOut = 1.0; emitOut = vec3(0.0); inDiskOut = false;
    return 0.0;
  }

  float phiM = atan(mp.z, mp.x);
  float prec = uDiskPrecess * uTime;
  float omega = uDiskSwirl * 0.55 / sqrt(mR + 0.6);
  float psi = phiM - omega * uTime * (0.25 + 0.75 * uDiskTurbSpd) + prec;

  vec3 tp = vec3(mR * 0.42, psi * mR, mp.y / max(H, 0.05) * 1.8);
  float n1 = fbm3(tp + 0.6 * vec3(fbm3(tp * 1.8 + 4.2)));
  float turb = 0.70 + 0.45 * uDiskTurb * (n1 * 2.0 - 1.0);
  float hot = 0.88 + 0.24 * uDiskTurb * (fbm3(tp * 2.1 + 9.7) * 2.0 - 1.0);

  float dens = vert * radial * max(turb, 0.04);

  // Keplerian orbital velocity (c = 1), counter-clockwise seen from +Y
  float vv = sqrt(0.5 / max(mR, 1.15));
  vec3 vdir = normalize(vec3(mp.z, 0.0, -mp.x));
  vec3 nobs = normalize(uCamPos - mp);
  float gam = inversesqrt(1.0 - vv * vv);
  float delta = 1.0 / (gam * (1.0 - dot(vdir, nobs) * vv));
  float gGrav = sqrt(max(1.0 - 1.0 / max(mR, 1.0), 0.02));

  float dEff = mix(1.0, delta, uDoppler);
  float gEff = mix(1.0, gGrav, uRedshift);
  float Te = uDiskTemp * pow(uDiskRIn / max(mR, 1.2), 0.75);
  float Tobs = clamp(Te * gEff * dEff, 700.0, 90000.0);
  vec3 col = blackbody(Tobs);
  float bol = pow(gEff * Te / 5800.0, 4.0);
  float boost = mix(1.0, pow(max(delta, 0.15), 4.0), uDoppler);
  float emis = pow(uDiskRIn / max(mR, 1.2), uDiskEmis);
  float surf = 1.0 + 0.45 * exp(-abs(mp.y) / (H * 0.55));

  emitOut = col * bol * boost * emis * hot * surf * dens * EMIT_SCALE;
  deltaOut = delta;
  gGravOut = gGrav;
  inDiskOut = dens > 0.0035;
  return dens;
}

// ---------------------------------------------------------------- main
void main() {
  vec2 frc = gl_FragCoord.xy;
  vec2 uv = (frc - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(uTanFov * (uv.x * uCamRight + uv.y * uCamUp) + uCamFwd);

  // -------- initial geodesic state from camera ray --------
  // The camera ray direction is the photon direction measured by the static
  // local observer (orthonormal frame). Coordinate quantities:
  //   E = 1, L2c = r0^2 (1 - dr^2) / e0   (coordinate L^2)
  //   Lzc = r0 sin(th0) dph / sqrt(e0)    (coordinate Lz)
  //   rd0 = dr,  thd0 = dth/(r0 sqrt(e0)),  phd0 = dph/(r0 sin(th0) sqrt(e0))
  vec3 p = uCamPos;
  float r0 = length(p);
  vec3 n0 = p / r0;
  float c0 = dot(n0, rd);
  float th0 = acos(clamp(n0.y, -1.0, 1.0));
  float ph0 = atan(n0.z, n0.x);
  float s0 = max(sin(th0), 1e-5);
  float e0 = 1.0 - 1.0 / r0;
  float se0 = sqrt(max(e0, 1e-6));

  vec3 eR = n0;
  vec3 eTh = vec3(cos(th0) * cos(ph0), -sin(th0), cos(th0) * sin(ph0));
  vec3 ePh = vec3(-sin(ph0), 0.0, cos(ph0));
  float dr0 = dot(rd, eR);
  float dth = dot(rd, eTh);
  float dph = dot(rd, ePh);

  float rd0 = dr0;
  float thd0 = dth / (r0 * se0);
  float phd0 = dph / (r0 * s0 * se0);
  float L2 = r0 * r0 * (1.0 - dr0 * dr0) / e0;
  float Lz = r0 * s0 * dph / se0;

  float r = r0, th = th0, ph = ph0, rdv = rd0, thdv = thd0, phdv = phd0;

  // -------- pure background debug --------
  if (uDebug == 7) {
    fragColor = vec4(background(rd), 1.0);
    return;
  }

  vec3 L = vec3(0.0);
  float sigma = 0.0;
  float trans = 1.0;
  int crossings = 0;
  bool inDisk = false;
  float hLast = 0.0;
  float deltaLast = 1.0;
  float gGravLast = 1.0;
  float densLast = 0.0;
  int state = 0; // 0 in flight, 1 absorbed, 2 escaped, 3 sigma cut
  int steps = MAX_STEPS;

  for (int i = 0; i < MAX_STEPS; i++) {
    steps = i;
    if (r < R_HORIZON_HIT) { state = 1; break; }
    if (r > R_ESC && rdv > 0.0) { state = 2; break; }

    float h = stepH(r);
    hLast = h;

    float nr, nth, nph, nrd, nthd, nphd, mr, mth, mph;
    rk4Step(r, th, ph, rdv, thdv, phdv, h, nr, nth, nph, nrd, nthd, nphd, mr, mth, mph);

    // drift correction: re-derive velocity magnitudes from conserved (E, L2, Lz)
    {
      float e = 1.0 - 1.0 / max(nr, 1.0001);
      float s = sin(nth);
      nphd = Lz / (nr * nr * max(s * s, 1e-9));
      float thd2n = L2 / (nr * nr * nr * nr) - nphd * nphd * s * s;
      float rd2n = 1.0 - e * L2 / (nr * nr);
      nthd = sign(nthd) * sqrt(max(thd2n, 0.0));
      nrd = sign(nrd) * sqrt(max(rd2n, 0.0));
      nr = max(nr, 0.9);
    }

    // -------- volumetric disk sample at the RK4 midpoint --------
    vec3 mp = cart(mr, mth, mph);
    float eMid = 1.0 - 1.0 / max(mr, 1.0001);
    float ds = h / sqrt(max(eMid, 0.002));
    float deltaLoc = 1.0;
    float gGravLoc = 1.0;
    vec3 emitLoc = vec3(0.0);
    bool inNow = false;
    float dens = 0.0;
    if (mr > uDiskRIn * 0.55 && mr < uDiskROut * 1.05 && abs(mp.y) < 4.0 * diskH(mr)) {
      dens = diskSample(mp, deltaLoc, gGravLoc, emitLoc, inNow);
      float dSig = dens * uDiskOpacity * ds;
      if (dens > 0.0) {
        L += trans * emitLoc * ds;
        sigma += dSig;
        trans *= exp(-dSig);
        deltaLast = deltaLoc;
        gGravLast = gGravLoc;
        densLast = dens;
        if (inNow && !inDisk) crossings++;
        inDisk = inNow;
      }
    }

    r = nr; th = nth; ph = nph; rdv = nrd; thdv = nthd; phdv = nphd;

    if (sigma > SIGMA_CUT) { state = 3; break; }
  }

  // -------- accumulate background for escaped rays --------
  if (state == 2) {
    vec3 vel = cartVel(r, th, ph, rdv, thdv, phdv);
    vec3 dirOut = normalize(vel);
    L += trans * background(dirOut);
  } else if (state == 0) {
    // budget exhausted (near-critical orbit): fade contribution softly
    vec3 vel = cartVel(r, th, ph, rdv, thdv, phdv);
    vec3 dirOut = normalize(vel);
    L += trans * 0.4 * background(dirOut);
  }

  // -------- output / debug views --------
  if (uDebug == 0) {
    fragColor = vec4(L, 1.0);
  } else if (uDebug == 1) {
    fragColor = vec4(rainbow(float(steps) / float(MAX_STEPS)), 1.0);
  } else if (uDebug == 2) {
    fragColor = vec4(vec3(densLast) * 3.0, 1.0);
  } else if (uDebug == 3) {
    fragColor = vec4(vec3(sigma / SIGMA_CUT), 1.0);
  } else if (uDebug == 4) {
    fragColor = vec4(clamp(vec3(deltaLast / 2.0), 0.0, 1.0) * rainbow(0.31) * 2.0, 1.0);
  } else if (uDebug == 5) {
    fragColor = vec4(vec3(gGravLast), 1.0);
  } else if (uDebug == 6) {
    vec3 cc = crossings <= 0 ? vec3(0.05, 0.05, 0.08)
             : crossings == 1 ? vec3(0.2, 0.9, 1.0)
             : crossings == 2 ? vec3(1.0, 0.85, 0.25)
             : crossings == 3 ? vec3(1.0, 0.3, 0.75)
             : vec3(0.6, 1.0, 0.4);
    fragColor = vec4(cc, 1.0);
  } else if (uDebug == 8) {
    fragColor = vec4(vec3(clamp(hLast * 2.2, 0.0, 1.0)), 1.0);
  } else if (uDebug == 9) {
    vec3 mc = state == 1 ? vec3(0.0)
             : state == 2 ? vec3(1.0)
             : state == 3 ? vec3(0.45, 0.45, 0.45)
             : vec3(0.15, 0.2, 0.3);
    fragColor = vec4(mc, 1.0);
  } else {
    fragColor = vec4(vec3(1.0, 0.0, 0.0), 1.0);
  }
}
`;

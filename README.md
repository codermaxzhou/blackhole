# GARGANTUA — Schwarzschild Black Hole Raytracer

A real-time, full-screen raytracer of a Schwarzschild (non-spinning) black hole
with a volumetric accretion disk. The whole image is computed per-pixel in a
single fragment shader: null geodesics are integrated in the Schwarzschild
metric (in units where the horizon radius `r_s = 1`) with RK4 and a
drift-correcting reprojection onto the conserved quantities `(E, L², L_z)`,
so gravitational lensing, the photon sphere, Doppler beaming, gravitational
redshift and the multiple lensed images of the disk are all *exact*, not
faked with sprites or textures.

No build step, no bundler, no framework. Just static files + ES modules.

## Run it

Any static file server works. Examples:

```sh
# from the project root
python3 -m http.server 8000
# or
npx serve .
# or
npx http-server -p 8000
```

Then open `http://localhost:8000/`.

Requirements: a browser with **WebGL2** (all evergreen desktop/mobile
browsers). The page degrades gracefully with an on-screen error if WebGL2 is
unavailable.

## What you see

- **Volumetric accretion disk** — a 3D (not flat) disk of hot plasma between
  `r_in = 3 r_s` and `r_out = 12 r_s`, with a vertical Gaussian scale height
  and radial flaring. Light is emitted along the ray's path and attenuated by
  optical depth, so you see the disk from any angle, including edge-on.
- **Gravitational lensing** — the black hole's shadow, the photon ring, and
  the disk's near/far faces bent around the hole.
- **Relativistic effects** — Doppler beaming (the approaching side of the disk
  is brighter/bluer) and gravitational redshift (light climbing out of the
  potential well is dimmer/redder). Both are toggleable per-parameter.
- **Deep-space background** — procedural starfield, a galactic band, and dust
  lanes, all lensed by the hole.
- **Disk appearance** — seamless advected filaments, a warm outer disk and
  cooler bright inner emission. A 0.32× artistic visible-band temperature mapping
  controls the palette; intensity still uses the unscaled temperature. Analytic
  per-step emission/absorption reduces brightness changes between quality tiers.
- **Post** — soft-knee HDR bloom (multi-tap gaussian), ACES tonemapping, subtle
  chromatic aberration, vignette, film grain, and dither.

## Controls

- **Drag** — orbit the camera. **Scroll / pinch** — zoom.
- **Presets** — `Q` orbit, `W` pole (top-down), `E` edge-on, `T` cinematic.
- **`C`** — enter/exit the automatic cinematic camera loop.
- **`0`–`9`** — debug views (see below).
- **`Space`** — pause/resume disk time. **`M`** — ambient audio on/off.
- **`H`** — minimal HUD. **`D`** — parameter panel.
- **`[` / `]`** — step quality tier down/up.
- **`F`** — fullscreen. **`S`** — save a PNG screenshot.
- **`R`** — reset all parameters to defaults.

## Debug views (`0`–`9`)

| Key | View |
|-----|------|
| 0 | Normal render |
| 1 | Integration step count (rainbow = fraction of the step budget used) |
| 2 | Disk density at the last sample |
| 3 | Accumulated optical depth σ (normalized to the cut-off) |
| 4 | Doppler factor δ at the last sample |
| 5 | Gravitational redshift factor at the last sample |
| 6 | Number of disk-plane crossings (lensed multiple images) |
| 7 | Pure background (no disk, no geodesic absorption) |
| 8 | Integrator step size `h` |
| 9 | Ray end-state: white = escaped, gray = σ cut, blue = step-budget, black = absorbed |

## Quality tiers

| Tier | Render scale | Max geodesic steps | Step scale |
|------|-------------:|-------------------:|-----------:|
| standard | 0.55 | 220 | 0.085 |
| high | 0.78 | 340 | 0.068 |
| cinematic | 1.00 | 512 | 0.052 |

Desktop defaults to **high**; mobile starts at **standard**. A sustained-low-FPS
detector auto-drops the tier one step if the device can't keep up. The tier is
chosen by default but can be forced via URL or keys.

## URL parameters

The app reads its state from the URL (highest precedence, over local storage):

| Param | Meaning |
|-------|---------|
| `q` | quality tier: `standard` \| `high` \| `cinematic` |
| `preset` | `orbit` \| `pole` \| `edge` \| `cine` |
| `debug` | `0`–`9` (debug view on load) |
| `t` | initial disk time (seconds) |
| `fov` | vertical field of view, degrees (20–100) |
| `cam` | `R,lat,az` — spherical camera (R in `r_s`, angles in degrees) |
| `hud` / `panel` | `0` to hide the HUD / parameter panel |
| `still` | pause the time loop on load |
| `shot` | after ~10 warm-up frames, expose a PNG data-URL screenshot (see below) |
| `download` | with `shot`, also trigger a download |
| `disk.rIn`, `post.grain`, … | any of the 21 parameters, by key (see "Parameters") |

**Screenshot automation.** Load `?q=high&shot&t=4&debug=0`. After the warm-up,
the page sets `document.documentElement.dataset.gargantuaReady = "true"`, adds a
hidden `<img id="gargantua-shot">` whose `src` is the PNG data-URL, and fires a
`gargantua:shot` CustomEvent. A headless browser can then read the image.

**Automation API.** `window.GARGANTUA` exposes: `version`, `params()`,
`set(key, value)`, `setDebug(n)`, `setQuality(tier)`, `setPreset(id)`,
`cinematic(on)`, `audio(on)`, `setTime(t)`, `getCamera()`, `getStats()`
(`{ fps, resolution, tier, steps, debug, time }`), `screenshot()`
(→ Promise<data-URL>), and `on(event, cb)` for `ready`, `quality`, `preset`,
`debug`, `cinematic`.

## Parameters (21)

The parameter panel (`D`) groups them:

- **Accretion Disk (11)** — `disk.rIn`, `disk.rOut`, `disk.h0` (scale height),
  `disk.flare`, `disk.opacity` (optical depth), `disk.temp` (inner
  temperature), `disk.emis` (radial emission exponent), `disk.turb`,
  `disk.turbSpd`, `disk.swirl`, `disk.precess`.
- **Relativistic Effects (2)** — `phys.doppler` (beaming strength),
  `phys.redshift` (gravitational redshift strength).
- **Deep-Space Background (3)** — `bg.stars`, `bg.galaxy`, `bg.dust`.
- **Post-Processing (5)** — `post.bloom`, `post.bloomThresh`,
  `post.vignette`, `post.grain`, `post.exposure`.

State (parameters, tier, debug view, preset, FOV, HUD/audio) persists to
`localStorage` (`gargantua.v1`).

## Project layout

```
index.html            page shell + import map (three from ./vendor/)
css/style.css         full-screen canvas, HUD, panel, fallback
vendor/three/         three@0.169.0 (three.module.js + OrbitControls.js)
src/main.js           bootstrap, main loop, keys, presets, screenshot, API
src/core/
  params.js           the 21 parameter specs + defaults
  state.js            defaults <- localStorage <- URL, persistence, URL parse
  camera.js           presets, spherical helpers, cinematic camera loop
  renderer.js         WebGL2 pipeline: RTs, bloom chain, tier/resize, ctx loss
  audio.js            optional ambient loop (assets/audio/ambient_loop.wav)
src/ui/
  hud.js              toasts, minimal HUD
  panel.js            parameter panel
src/shaders/
  scene.js            the raytracer fragment shader (geodesics + disk + bg)
  post.js             bright-pass / blur / composite (bloom, ACES, grain)
tools/make_audio.mjs  regenerate the ambient WAV (deterministic, no deps)
tools/visual-test/    headless visual acceptance test (Playwright, optional)
tests/geodesic.mjs    double-precision reference geodesic integrator
tests/physics.test.mjs  validation suite (Node's built-in test runner)
tests/out/            screenshots + results.json from the visual test
assets/audio/         ambient_loop.wav
```

## Physics validation

`tests/geodesic.mjs` is a double-precision port of the shader's geodesic
integrator. `tests/physics.test.mjs` checks it against the exact Schwarzschild
orbits (via the 1-D orbit equation and a high-accuracy deflection integral):

```sh
node --test tests/physics.test.mjs
```

Covers: weak-field deflection α ≈ 2/b (and the 2nd-order correction),
strong-field deflection at small impact parameter, the critical impact
parameter `b_crit = 3√3/2 ≈ 2.598` and photon-sphere capture, unbound turning
points, disk-plane crossing counts, conservation of `L²`/`L_z` under the
reprojection, and the step budget. **Result: 10/10 passing.**

## Visual acceptance (headless)

`tools/visual-test/visual.mjs` drives headless Chromium (SwiftShader WebGL) to
assert: zero console/page errors, non-black content in every preset/tier/debug
view, the shadow's dark center, the Doppler left/right asymmetry, the `?shot`
screenshot automation, and state persistence.

```sh
cd tools/visual-test
npm i && npx playwright install chromium
node visual.mjs
```

For black-level and HDR/sRGB GPU regression checks, plus all presets and quality tiers:

```sh
node tools/visual-test/render-regression.mjs
```

Regression screenshots land in `/tmp/blackhole-regression/`.

Screenshots from the full visual suite land in `tests/out/` (plus `results.json`). The last run produced
**zero console errors, zero page errors**, all views rendering with the
expected structure, and passing shot/persistence checks.

## Notes & assumptions

- Units: `r_s = 1`. The horizon is at `r = 1`, the photon sphere at `r = 1.5`.
- The disk is a *visualization* of a thin accretion flow; its emission profile,
  temperature, and turbulence are artistic, but the light propagation
  (geodesics, lensing, Doppler, redshift) is the exact Schwarzschild physics.
- The integrator is a 3rd-order-ish RK4 on the coordinate geodesic ODEs with a
  per-step reprojection that re-derives the velocity components from the
  conserved `(E, L², L_z)`, keeping the trajectory on the constraint surface
  and killing numerical drift over hundreds of steps.

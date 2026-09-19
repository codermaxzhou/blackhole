// GARGANTUA — bootstrap / main loop / interaction.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { Pipeline, TIER_SPECS } from './core/renderer.js';
import { PRESETS, latAzToPos, applyPreset, cinematicPose } from './core/camera.js';
import { createState, scheduleSave, QUALITIES, PRESET_IDS } from './core/state.js';
import { PARAM_MAP, PARAMS } from './core/params.js';
import { Hud } from './ui/hud.js';
import { Panel } from './ui/panel.js';
import { AmbientAudio } from './core/audio.js';

const VERSION = '1.0.0';

// ---------------------------------------------------------------- state
const state = createState();
if (state.still) state.paused = true;

// ---------------------------------------------------------------- dom
const canvas = document.getElementById('gl');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error-card');
const hudRoot = document.getElementById('hud');

let pipeline = null;
let camera = null;
let controls = null;
let hud = null;
let panel = null;
let audio = null;

let cinematic = state.preset === 'cine';
let simTime = state.time || 0;
let running = true;
let firstFrameDone = false;
let warmupFrames = 0;
let shotDone = false;
let shotResolve = null;
let shotPending = false;
let fpsEma = 60;
let lastFrame = performance.now();
let lastHud = 0;
let degradeTimer = 0;
let lastDegrade = 0;
let ctxLost = false;

const listeners = new Map();
function emit(name, detail) {
  for (const cb of listeners.get(name) || []) {
    try { cb(detail); } catch { /* listener error must not break the loop */ }
  }
}
function on(name, cb) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(cb);
  return () => listeners.get(name).delete(cb);
}

// ---------------------------------------------------------------- helpers
function cssSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function setParam(key, value) {
  const spec = PARAM_MAP[key];
  if (!spec) return false;
  value = Math.min(spec.max, Math.max(spec.min, value));
  state.params[key] = value;
  const u = pipeline.sceneMat.uniforms[spec.uniform];
  if (u) u.value = spec.toUniform ? spec.toUniform(value) : value;
  if (key === 'post.bloomThresh') pipeline.brightMat.uniforms.uThresh.value = value;
  if (key === 'post.bloom') pipeline.compMat.uniforms.uBloomStr.value = value;
  if (key === 'post.vignette') pipeline.compMat.uniforms.uVignette.value = value;
  if (key === 'post.grain') pipeline.compMat.uniforms.uGrain.value = value;
  if (key === 'post.exposure') pipeline.compMat.uniforms.uExposure.value = value;
  panel && panel.refresh(key);
  scheduleSave(state);
  return true;
}

function syncAllUniforms() {
  for (const p of PARAMS) {
    const spec = PARAM_MAP[p.key];
    const u = pipeline.sceneMat.uniforms[spec.uniform];
    if (u) u.value = spec.toUniform ? spec.toUniform(state.params[spec.key]) : state.params[spec.key];
  }
  pipeline.brightMat.uniforms.uThresh.value = state.params['post.bloomThresh'];
  pipeline.compMat.uniforms.uBloomStr.value = state.params['post.bloom'];
  pipeline.compMat.uniforms.uVignette.value = state.params['post.vignette'];
  pipeline.compMat.uniforms.uGrain.value = state.params['post.grain'];
  pipeline.compMat.uniforms.uExposure.value = state.params['post.exposure'];
}

function applyQuality(tier) {
  state.quality = tier;
  const { w, h } = pipeline.setTier(tier, cssSize().w, cssSize().h, window.devicePixelRatio || 1, state.mobile);
  syncAllUniforms();
  hud && hud.toast(`Quality: ${tier.toUpperCase()} (${w}×${h}, ${TIER_SPECS[tier].steps} steps)`, 2400);
  emit('quality', tier);
  scheduleSave(state);
}

function cycleQuality(dir) {
  const i = QUALITIES.indexOf(state.quality);
  applyQuality(QUALITIES[Math.min(QUALITIES.length - 1, Math.max(0, i + dir))]);
}

function setDebug(n, { toast = true } = {}) {
  n = Math.round(n);
  if (n < 0 || n > 9) return;
  state.debug = n;
  hud && toast && hud.toast(`Debug view ${n}`, 1600);
  emit('debug', n);
  scheduleSave(state);
}

function setPreset(id, { toast = true } = {}) {
  if (!PRESET_IDS.includes(id)) return;
  state.preset = id;
  if (id === 'cine') {
    enterCinematic(true);
  } else {
    exitCinematic();
    applyPreset(camera, id, controls.target);
  }
  hud && toast && hud.toast(`View: ${PRESETS[id].label}`, 1600);
  emit('preset', id);
  scheduleSave(state);
}

function enterCinematic(toast = true) {
  cinematic = true;
  if (controls) controls.enabled = false;
  hud && toast && hud.toast('Cinematic camera (C to exit)', 2000);
  emit('cinematic', true);
}

function exitCinematic() {
  if (!cinematic) return;
  cinematic = false;
  if (controls) {
    controls.target.copy(lastCineTarget);
    controls.enabled = true;
    controls.update();
  }
  emit('cinematic', false);
}

const lastCineTarget = new THREE.Vector3();

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    pipeline = new Pipeline(canvas);
  } catch (err) {
    showFatal('WebGL2 is not available on this device/browser.', err);
    return;
  }

  camera = new THREE.PerspectiveCamera(state.fov, 1, 0.1, 200);
  camera.up.set(0, 1, 0);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 2.15;
  controls.maxDistance = 40;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.target.set(0, 0, 0);

  // camera from URL override or preset
  if (state.camOverride) {
    const c = state.camOverride;
    camera.position.copy(latAzToPos(c.r, c.lat, c.az));
  } else {
    applyPreset(camera, state.preset, controls.target);
  }
  camera.lookAt(controls.target);
  if (state.preset === 'cine') cinematic = true;

  pipeline.tier = state.quality;
  resizeWindow();
  syncAllUniforms();
  hudRoot.hidden = !state.hud;

  hud = new Hud(hudRoot);
  panel = new Panel(document.getElementById('panel'), {
    getParam: k => state.params[k],
    setParam,
    onOpenChange: () => scheduleSave(state),
  });
  if (state.panel) panel.open();

  audio = new AmbientAudio();
  audio.onStateChange = enabled => {
    state.music = enabled;
    scheduleSave(state);
    hud.toast(enabled ? 'Ambient audio on' : 'Ambient audio off', 1600);
  };

  bindKeys();
  bindButtons();

  pipeline.onContextLost = () => {
    ctxLost = true;
    hud.toast('WebGL context lost — waiting for recovery…', 6000);
  };
  pipeline.onContextRestored = () => {
    ctxLost = false;
    syncAllUniforms();
    hud.toast('WebGL context restored', 2500);
  };

  window.addEventListener('resize', resizeWindow);
  window.addEventListener('visibilitychange', () => {
    lastFrame = performance.now();
  });

  // autoplay-intent audio: browser requires a gesture
  if (state.music) {
    hud.toast('Press M to start ambient audio', 4000);
    const arm = () => {
      if (state.music && !audio.active) audio.start();
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
  }

  // expose automation API
  window.GARGANTUA = {
    version: VERSION,
    params: () => ({ ...state.params }),
    set: (k, v) => setParam(k, v),
    setDebug: n => setDebug(n, { toast: false }),
    setQuality: q => applyQuality(q),
    setPreset: id => setPreset(id, { toast: false }),
    cinematic: v => (v ? enterCinematic(false) : exitCinematic()),
    audio: v => audio.setEnabled(v),
    setTime: t => { simTime = Number(t) || 0; },
    getCamera: () => ({
      position: camera.position.clone(),
      target: controls.target.clone(),
      fov: camera.fov,
    }),
    getStats: () => {
      const rt = pipeline.sceneRT;
      return { fps: Math.round(fpsEma), resolution: [rt.width, rt.height], tier: state.quality, steps: TIER_SPECS[state.quality].steps, debug: state.debug, time: simTime };
    },
    screenshot: () => new Promise(resolve => {
      shotPending = true;
      shotResolve = resolve;
    }),
    on,
  };

  animate();
}

function showFatal(msg, err) {
  if (loadingEl) loadingEl.style.display = 'none';
  if (errorEl) {
    errorEl.removeAttribute('hidden');
    errorEl.style.display = 'flex';
    const d = errorEl.querySelector('#error-detail');
    if (d) d.textContent = err ? (err.message || String(err)) : '';
    const m = errorEl.querySelector('#error-msg');
    if (m) m.textContent = msg;
  }
  // degraded CSS fallback so the page is never fully black
  document.body.classList.add('fallback-bg');
  console.error('[GARGANTUA] fatal:', err); // single, expected, diagnostic
}

function resizeWindow() {
  if (!pipeline) return;
  const { w, h } = cssSize();
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  pipeline.resize(w, h, window.devicePixelRatio || 1, state.mobile);
}

// ---------------------------------------------------------------- loop
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  dt = Math.min(dt, 0.1);

  fpsEma = fpsEma * 0.92 + (dt > 0 ? 1 / dt : 60) * 0.08;

  if (!ctxLost && running) {
    if (!state.paused) simTime += dt;

    if (cinematic) {
      const pose = cinematicPose(simTime);
      camera.position.copy(pose.pos);
      camera.fov = pose.fov;
      lastCineTarget.copy(pose.target);
      camera.lookAt(pose.target);
      camera.updateProjectionMatrix();
    } else {
      controls.update();
      // keep the camera outside the horizon
      const r = camera.position.length();
      if (r < 2.15) {
        camera.position.setLength(2.15);
        controls.update();
      }
    }

    pipeline.renderFrame(camera, simTime, state.debug);

    if (!firstFrameDone) {
      firstFrameDone = true;
      if (loadingEl) {
        loadingEl.classList.add('done');
        setTimeout(() => { loadingEl.style.display = 'none'; }, 600);
      }
      emit('ready', null);
    }
    warmupFrames++;

    // URL screenshot automation
    if (state.shot && !shotDone && warmupFrames >= 10) {
      shotDone = true;
      doScreenshot(url => {
        const img = document.createElement('img');
        img.id = 'gargantua-shot';
        img.src = url;
        img.style.display = 'none';
        document.body.appendChild(img);
        document.documentElement.dataset.gargantuaReady = 'true';
        window.dispatchEvent(new CustomEvent('gargantua:shot', { detail: { url } }));
        console.info(`[GARGANTUA] shot-ready (${url.length} chars, debug=${state.debug}, tier=${state.quality})`);
        if (state.download) {
          const a = document.createElement('a');
          a.href = url;
          a.download = `gargantua_d${state.debug}_${state.quality}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      });
    }

    // pending screenshot request
    if (shotPending) {
      shotPending = false;
      doScreenshot(url => {
        if (shotResolve) { shotResolve(url); shotResolve = null; }
      });
    }

    // HUD @ ~4 Hz
    if (now - lastHud > 250) {
      lastHud = now;
      updateHud();
      // adaptive quality: sustained low fps -> drop one tier
      if (fpsEma < 24 && state.quality !== 'standard' && now - lastDegrade > 20000) {
        degradeTimer += 0.25;
        if (degradeTimer > 4) {
          degradeTimer = 0;
          lastDegrade = now;
          const i = QUALITIES.indexOf(state.quality);
          hud.toast('Low FPS — auto-dropping quality tier');
          applyQuality(QUALITIES[i - 1]);
        }
      } else {
        degradeTimer = Math.max(0, degradeTimer - 0.05);
      }
    }
  }
}

function doScreenshot(cb) {
  requestAnimationFrame(() => {
    try {
      // Read immediately after rendering; the drawing buffer is not preserved.
      pipeline.renderFrame(camera, simTime, state.debug);
      cb(canvas.toDataURL('image/png'));
    } catch (err) {
      console.error('[GARGANTUA] screenshot failed:', err);
      cb('');
    }
  });
}

function cameraLatAz() {
  const p = camera.position;
  const r = p.length();
  const lat = Math.asin(Math.min(1, Math.max(-1, p.y / r))) * 180 / Math.PI;
  const az = (Math.atan2(p.x, p.z) * 180 / Math.PI + 360) % 360;
  return { r, lat, az };
}

function updateHud() {
  const rt = pipeline.sceneRT;
  const c = cameraLatAz();
  hud.setTelemetry({
    fps: Math.round(fpsEma),
    res: [rt.width, rt.height],
    tier: state.quality,
    steps: TIER_SPECS[state.quality].steps,
    time: simTime,
    paused: state.paused,
  });
  hud.setCamera({ ...c, fov: camera.fov });
  hud.setMode(cinematic ? 'Cinematic' : PRESETS[state.preset].label, state.debug);
}

// ---------------------------------------------------------------- keys
function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key;
    if (k >= '0' && k <= '9') {
      setDebug(parseInt(k, 10));
    } else if (k === 'q' || k === 'Q') {
      setPreset('orbit');
    } else if (k === 'w' || k === 'W') {
      setPreset('pole');
    } else if (k === 'e' || k === 'E') {
      setPreset('edge');
    } else if (k === 't' || k === 'T') {
      setPreset('cine');
    } else if (k === 'c' || k === 'C') {
      if (cinematic) { exitCinematic(); setPreset(state.preset === 'cine' ? 'orbit' : state.preset, { toast: false }); }
      else enterCinematic();
    } else if (k === ' ') {
      e.preventDefault();
      state.paused = !state.paused;
      hud.toast(state.paused ? 'Time paused' : 'Time resumed', 1400);
    } else if (k === 'm' || k === 'M') {
      audio.setEnabled(!audio.active);
    } else if (k === 'h' || k === 'H') {
      hudRoot.classList.toggle('minimal');
    } else if (k === 'd' || k === 'D') {
      panel.isOpen ? panel.close() : panel.open();
    } else if (k === '[') {
      cycleQuality(-1);
    } else if (k === ']') {
      cycleQuality(1);
    } else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (k === 's' || k === 'S') {
      doScreenshot(url => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `gargantua_d${state.debug}_${state.quality}_${Math.round(simTime)}s.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        hud.toast('Screenshot saved', 1800);
      });
    } else if (k === 'r' || k === 'R') {
      for (const p of PARAMS) setParam(p.key, p.def);
      hud.toast('Parameters reset', 1600);
    }
  });

  // any manual orbit interaction breaks cinematic mode
  controls.addEventListener('start', () => {
    if (cinematic) {
      cinematic = false;
      controls.enabled = true;
      controls.target.copy(lastCineTarget);
      hud.toast('Cinematic off — free orbit (C to resume)', 1800);
      emit('cinematic', false);
    }
  });
}

// ---------------------------------------------------------------- buttons
function bindButtons() {
  const btn = id => document.getElementById(id);
  const bTier = btn('btn-tier');
  const bView = btn('btn-view');
  const bAudio = btn('btn-audio');
  const bShot = btn('btn-shot');
  const bPanel = btn('btn-panel');

  const refreshTierBtn = () => { bTier.textContent = state.quality.toUpperCase(); };
  const refreshViewBtn = () => { bView.textContent = cinematic ? 'CINE' : PRESETS[state.preset].label.toUpperCase(); };
  const refreshAudioBtn = () => { bAudio.textContent = audio.active ? 'SOUND ON' : 'SOUND OFF'; bAudio.classList.toggle('on', audio.active); };

  refreshTierBtn(); refreshViewBtn(); refreshAudioBtn();
  on('quality', refreshTierBtn);
  on('preset', refreshViewBtn);
  on('cinematic', refreshViewBtn);
  audio.onStateChange = enabled => {
    state.music = enabled;
    scheduleSave(state);
    refreshAudioBtn();
  };

  bTier.addEventListener('click', () => cycleQuality(1));
  bView.addEventListener('click', () => {
    if (cinematic) {
      exitCinematic();
      setPreset('orbit', { toast: false });
    } else {
      const i = PRESET_IDS.indexOf(state.preset);
      setPreset(PRESET_IDS[(i + 1) % PRESET_IDS.length]);
    }
  });
  bAudio.addEventListener('click', () => audio.setEnabled(!audio.active));
  bShot.addEventListener('click', () => {
    doScreenshot(url => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `gargantua_d${state.debug}_${state.quality}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });
  bPanel.addEventListener('click', () => (panel.isOpen ? panel.close() : panel.open()));
}

// ---------------------------------------------------------------- go
boot().catch(err => showFatal('Failed to start.', err));

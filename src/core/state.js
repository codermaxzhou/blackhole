// Application state: defaults <- localStorage <- URL query (precedence).
// Also exposes the URL automation interface.

import { PARAM_MAP, defaultParams } from './params.js';

const STORAGE_KEY = 'gargantua.v1';

export const QUALITIES = ['standard', 'high', 'cinematic'];
export const PRESET_IDS = ['orbit', 'pole', 'edge', 'cine'];

export function isMobile() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820;
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function parseUrl() {
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const out = {
    params: {},
    quality: q.get('q') || q.get('quality') || null,
    preset: q.get('preset') || q.get('view') || null,
    debug: q.get('debug') !== null ? parseInt(q.get('debug'), 10) : null,
    time: q.get('t') !== null ? parseFloat(q.get('t')) : null,
    still: q.has('still'),
    shot: q.has('shot') || q.get('shot') === '1',
    download: q.has('download') || q.get('download') === '1',
    fov: q.get('fov') !== null ? parseFloat(q.get('fov')) : null,
    hud: q.get('hud') !== null ? q.get('hud') !== '0' : null,
    panel: q.get('panel') !== null ? q.get('panel') !== '0' : null,
    cam: null,
  };
  if (out.debug === NaN || out.debug < 0 || out.debug > 9) out.debug = null;
  if (out.fov !== null && (isNaN(out.fov) || out.fov < 20 || out.fov > 100)) out.fov = null;

  // ?cam=R,lat,az  (r in rs, lat/az in degrees)
  if (q.get('cam')) {
    const parts = q.get('cam').split(',').map(parseFloat);
    if (parts.length === 3 && parts.every(v => !isNaN(v))) {
      out.cam = { r: clamp(parts[0], 2.2, 60), lat: clamp(parts[1], -85, 85), az: parts[2] };
    }
  }
  // individual parameter overrides: ?disk.turb=1.2&post.grain=0.2
  for (const key of Object.keys(PARAM_MAP)) {
    const raw = q.get(key);
    if (raw === null) continue;
    const v = parseFloat(raw);
    if (!isNaN(v)) out.params[key] = v;
  }
  return out;
}

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

export function createState() {
  const url = parseUrl();
  const stored = loadStorage();
  const mobile = isMobile();

  const params = defaultParams();
  if (stored && stored.params) {
    for (const key of Object.keys(PARAM_MAP)) {
      if (typeof stored.params[key] === 'number') params[key] = stored.params[key];
    }
  }
  for (const key of Object.keys(url.params)) {
    const spec = PARAM_MAP[key];
    params[key] = clamp(url.params[key], spec.min, spec.max);
  }
  // clamp stored values too
  for (const key of Object.keys(params)) {
    const spec = PARAM_MAP[key];
    params[key] = clamp(params[key], spec.min, spec.max);
  }

  let quality = QUALITIES.includes(url.quality) ? url.quality
    : QUALITIES.includes(stored?.quality) ? stored.quality
    : mobile ? 'standard' : 'high';

  const state = {
    params,
    quality,
    debug: url.debug ?? stored?.debug ?? 0,
    preset: PRESET_IDS.includes(url.preset ?? stored?.preset) ? (url.preset ?? stored.preset) : 'orbit',
    fov: url.fov ?? stored?.fov ?? 45,
    camOverride: url.cam,
    time: url.time ?? 0,
    still: url.still,
    shot: url.shot,
    download: url.download,
    hud: url.hud ?? stored?.hud ?? true,
    panel: url.panel ?? false,
    music: stored?.music ?? false,
    paused: false,
    mobile,
    saved: false,
  };
  return state;
}

let saveTimer = 0;
export function scheduleSave(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const { params, quality, debug, preset, fov, hud, music } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 1, params, quality, debug, preset, fov, hud, music,
      }));
      state.saved = true;
    } catch {
      // storage unavailable (private mode) — ignore
    }
  }, 300);
}

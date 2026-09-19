// HUD: top-left telemetry, bottom-right controls, key help, toasts.

export class Hud {
  constructor(root) {
    this.root = root;
    this.data = root.querySelector('#hud-data');
    this.cam = root.querySelector('#hud-cam');
    this.mode = root.querySelector('#hud-mode');
    this.help = root.querySelector('#hud-help');
    this.toasts = root.querySelector('#toasts');
    this.fps = 0;
  }

  setTelemetry({ fps, res, tier, steps, time, paused }) {
    if (this.data) {
      this.data.textContent =
        `FPS ${fps}  ·  ${res[0]}×${res[1]}  ·  ${tier.toUpperCase()}  ·  ${steps} STEP  ·  T ${time.toFixed(1)}s${paused ? '  ·  PAUSED' : ''}`;
    }
  }

  setCamera({ r, lat, az, fov }) {
    if (this.cam) {
      this.cam.textContent = `CAM  r ${r.toFixed(2)} rs · lat ${lat.toFixed(1)}° · az ${az.toFixed(0)}° · fov ${fov.toFixed(1)}°`;
    }
  }

  setMode(mode, debug) {
    if (this.mode) {
      this.mode.textContent = `MODE ${mode}  ·  DEBUG ${debug}`;
    }
  }

  setHelpVisible(on) {
    if (this.help) this.help.style.display = on ? '' : 'none';
  }

  toast(msg, ms = 3200) {
    if (!this.toasts) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, ms);
  }
}

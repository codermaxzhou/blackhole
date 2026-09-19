// Optional ambient audio. Primary source: fully procedural WebAudio graph
// (low drones, deep sub, filtered "air", periodic slow swells). Fallback:
// the generated loop asset assets/audio/ambient_loop.wav.

const DRONE_BASE = 54; // Hz

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.nodes = null;
    this.enabled = false;
    this.waveEl = null;
    this.onStateChange = null;
  }

  get active() {
    return this.enabled;
  }

  async start() {
    if (this.enabled) return;
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (this._buildGraph()) {
        this.enabled = true;
      } else {
        this._startWavFallback();
      }
    } catch {
      this._startWavFallback();
    }
    this._emit();
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      if (this.nodes) {
        const g = this.nodes.master;
        const t = this.ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.6);
        setTimeout(() => {
          if (this.nodes) {
            this.nodes.master.disconnect();
            this.nodes = null;
          }
        }, 700);
      }
      if (this.waveEl) {
        this.waveEl.pause();
        this.waveEl = null;
      }
    } catch { /* ignore */ }
    this._emit();
  }

  setEnabled(on) {
    if (on) this.start(); else this.stop();
  }

  _emit() {
    if (this.onStateChange) this.onStateChange(this.enabled);
  }

  _buildGraph() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    if (this.nodes) this.nodes.master.disconnect();

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 2.5);
    const masterLp = ctx.createBiquadFilter();
    masterLp.type = 'lowpass';
    masterLp.frequency.value = 7000;
    master.connect(masterLp).connect(ctx.destination);

    const lfos = [];
    const mkLfo = (freq, depth, target) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start();
      lfos.push(o);
    };

    // sub drone 36 Hz
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = DRONE_BASE * 2 / 3;
    const subG = ctx.createGain();
    subG.gain.value = 0.34;
    sub.connect(subG).connect(master);
    sub.start();
    mkLfo(0.043, 0.12, subG.gain);
    lfos.push(sub);

    // root drone 54 Hz
    const d1 = ctx.createOscillator();
    d1.type = 'sine';
    d1.frequency.value = DRONE_BASE;
    const d1G = ctx.createGain();
    d1G.gain.value = 0.40;
    d1.connect(d1G).connect(master);
    d1.start();
    mkLfo(0.051, 0.16, d1G.gain);
    lfos.push(d1);

    // fifth, slightly detuned
    const d2 = ctx.createOscillator();
    d2.type = 'triangle';
    d2.frequency.value = DRONE_BASE * 1.5;
    d2.detune.value = 4;
    const d2G = ctx.createGain();
    d2G.gain.value = 0.13;
    d2.connect(d2G).connect(master);
    d2.start();
    mkLfo(0.031, 0.05, d2G.gain);
    lfos.push(d2);

    // airy noise bed
    const nlen = ctx.sampleRate * 4;
    const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nlen; i++) {
      const w = Math.random() * 2 - 1;
      last = 0.985 * last + 0.015 * w; // pinkish
      nd[i] = last * 0.9;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = nbuf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150;
    bp.Q.value = 0.45;
    const nG = ctx.createGain();
    nG.gain.value = 0.05;
    noise.connect(bp).connect(nG).connect(master);
    noise.start();
    mkLfo(0.021, 620, bp.frequency);
    mkLfo(0.017, 0.02, nG.gain);
    lfos.push(noise);

    // periodic slow swells every ~19 s
    let swellTimer = 0;
    const swell = () => {
      if (!this.enabled) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(72, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 5.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 2.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 7);
      swellTimer = setTimeout(swell, 19000 + Math.random() * 5000);
    };
    swellTimer = setTimeout(swell, 9000);

    this.nodes = { master, lfos, swellTimer };
    return true;
  }

  _startWavFallback() {
    try {
      const el = new Audio('assets/audio/ambient_loop.wav');
      el.loop = true;
      el.volume = 0.5;
      el.play().then(() => {
        this.waveEl = el;
        this.enabled = true;
        this._emit();
      }).catch(() => {});
    } catch {
      this._emit();
    }
  }
}

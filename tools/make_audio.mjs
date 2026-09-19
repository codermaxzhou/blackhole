// Generates assets/audio/ambient_loop.wav — a seamless 12 s "deep space"
// drone loop (sub pulse + detuned sines + filtered noise bed), 44.1 kHz
// 16-bit mono. Pure Node, no dependencies.
//
// Usage: node tools/make_audio.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'assets', 'audio', 'ambient_loop.wav');

const SR = 44100;
const SECONDS = 12;
const N = SR * SECONDS;

function s2s(x) { // seconds -> samples
  return Math.round(x * SR);
}

// phase-continuous periodic components (freq * SECONDS = integer cycles)
const subFreq = 36.0;      // 432 cycles / 12 s
const d1Freq = 54.0;       // 648 cycles
const d2Freq = 81.0;       // 972 cycles
const d3Freq = 108.0;      // 1296 cycles (octave shimmer, very quiet)

// slow amplitude LFOs, integer cycles over the loop
const lfo1 = 2;   // 0.166 Hz
const lfo2 = 3;   // 0.25 Hz
const lfo3 = 5;   // ~0.417 Hz

// precompute a looping pink-ish noise buffer (blend at the seam)
function makeLoopNoise(n, sr, fade) {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = 0.985 * last + 0.015 * w;
    out[i] = last * 3.2;
  }
  // crossfades at both ends to guarantee a seamless loop
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const env = 0.5 * (1 - Math.cos(Math.PI * t));
    out[i] *= env;
    out[n - 1 - i] *= env;
  }
  // bandpass-ish: one-pole low + high shelf approx
  let lp = 0, hp = 0, prevIn = 0;
  const aLp = Math.exp(-2 * Math.PI * 900 / sr);
  const aHp = 0.985;
  for (let i = 0; i < n; i++) {
    lp = aLp * lp + (1 - aLp) * out[i];
    hp = aHp * (hp + out[i] - prevIn);
    prevIn = out[i];
    out[i] = lp * 0.7 + hp * 1.6;
  }
  return out;
}

const noise = makeLoopNoise(N, SR, SR);

const data = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const ph = (i / N) * Math.PI * 2; // 0..2pi over the loop

  const am1 = 0.5 + 0.5 * Math.sin(ph * lfo1);
  const am2 = 0.5 + 0.5 * Math.sin(ph * lfo2 + 1.2);
  const am3 = 0.5 + 0.5 * Math.sin(ph * lfo3 + 2.1);

  const sub = Math.sin(2 * Math.PI * subFreq * t) * (0.30 + 0.22 * am1);
  const d1 = Math.sin(2 * Math.PI * d1Freq * t) * (0.24 + 0.14 * am2);
  const d2 = Math.sin(2 * Math.PI * d2Freq * t + 0.4) * (0.09 + 0.05 * am1);
  const d3 = Math.sin(2 * Math.PI * d3Freq * t + 0.9) * (0.035 * am3);

  // slow "air" swell
  const swell = 0.5 + 0.5 * Math.sin(ph * 1 + 0.7); // 1 cycle
  const air = noise[i] * (0.018 + 0.030 * swell);

  // occasional deep pulse near the loop point (2 per loop)
  let pulse = 0;
  for (const p0 of [0.22, 0.74]) {
    const rel = ((t / SECONDS - p0) + 1) % 1;
    if (rel < 0.5) {
      const env = Math.exp(-rel * 9.0);
      pulse += Math.sin(2 * Math.PI * (46 - 14 * rel) * t) * env * 0.10;
    }
  }

  const s = sub + d1 + d2 + d3 + air + pulse;
  data[i] = s;
  const a = Math.abs(s);
  if (a > peak) peak = a;
}

// normalize to -6 dB-ish with headroom
const g = 0.26 / Math.max(peak, 1e-6);
for (let i = 0; i < N; i++) data[i] *= g;

// final global fade at the very ends (40 ms) to silence clicks
const ff = Math.round(0.04 * SR);
for (let i = 0; i < ff; i++) {
  const t = i / ff;
  data[i] *= t;
  data[N - 1 - i] *= t;
}

// ---- WAV (PCM 16-bit mono) ----
function toWav(samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    let v = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, toWav(data, SR));
console.log(`wrote ${outPath} (${SECONDS}s, 44.1 kHz, 16-bit mono, ${(toWav(data, SR).length / 1024 / 1024).toFixed(2)} MB)`);

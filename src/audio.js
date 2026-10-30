// Fully synthesized audio (WebAudio): weapons, voices, explosions, ambience.
import { clamp, rand } from './core.js';

export const A = {
  ctx: null, listener: { x: 0, z: 0, yaw: 0 },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = c.createGain(); this.master.gain.value = 0.6;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(c.destination);
    const verb = c.createConvolver(), len = c.sampleRate * 2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
    verb.buffer = ir;
    this.verbIn = c.createGain(); this.verbIn.gain.value = 0.35;
    this.verbIn.connect(verb); verb.connect(this.master);
    const nl = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, nl, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    this.ambience();
  },
  bus(gain = 1, pan = 0, wet = 0.3) {
    const c = this.ctx, g = c.createGain(), p = c.createStereoPanner();
    g.gain.value = gain; p.pan.value = clamp(pan, -1, 1);
    g.connect(p); p.connect(this.master);
    if (wet > 0) { const s = c.createGain(); s.gain.value = wet; p.connect(s); s.connect(this.verbIn); }
    return g;
  },
  // positional bus; returns null when out of earshot
  at(x, z, gain = 1, wet = 0.3) {
    if (!this.ctx) return null;
    const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    if (d > 70) return null;
    const g = gain / (1 + d * d * 0.008 + d * 0.06);
    const pan = d < 0.5 ? 0 : (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d * 0.85;
    return this.bus(g, pan, wet + Math.min(0.3, d * 0.01));
  },
  noise(dest, { start = 0, dur = 0.2, type = 'lowpass', f0 = 2000, f1 = 0, q = 1, gain = 1, attack = 0.002 }) {
    if (!dest) return;
    const c = this.ctx, t = c.currentTime + start;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  },
  tone(dest, { start = 0, dur = 0.2, type = 'sine', f0 = 200, f1 = 0, gain = 0.5, attack = 0.005 }) {
    if (!dest) return;
    const c = this.ctx, t = c.currentTime + start, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  },
  shot(kind, x, z) {
    const b = this.at(x, z, 1, 0.35);
    if (!b) return;
    switch (kind) {
      case 'axe': this.noise(b, { dur: 0.18, type: 'bandpass', f0: 1800, f1: 500, q: 1.5, gain: 0.5, attack: 0.03 }); break;
      case 'shotgun':
        this.noise(b, { dur: 0.4, f0: 3200, f1: 180, gain: 1 }); this.tone(b, { dur: 0.25, f0: 120, f1: 35, gain: 0.9 });
        this.noise(b, { start: 0.28, dur: 0.06, type: 'bandpass', f0: 1500, q: 3, gain: 0.35 }); this.noise(b, { start: 0.42, dur: 0.07, type: 'bandpass', f0: 1100, q: 3, gain: 0.4 });
        break;
      case 'sshotgun':
        this.noise(b, { dur: 0.6, f0: 2600, f1: 120, gain: 1.3 }); this.tone(b, { dur: 0.35, f0: 95, f1: 28, gain: 1.1 });
        this.noise(b, { start: 0.45, dur: 0.05, type: 'bandpass', f0: 2200, q: 4, gain: 0.35 }); this.noise(b, { start: 0.75, dur: 0.06, type: 'bandpass', f0: 1400, q: 4, gain: 0.45 });
        break;
      case 'tommy': this.noise(b, { dur: 0.11, f0: 4500, f1: 600, gain: 0.7 }); this.tone(b, { dur: 0.06, f0: 210, f1: 70, gain: 0.45 }); break;
      case 'grenade': this.tone(b, { dur: 0.15, f0: 180, f1: 60, gain: 0.8 }); this.noise(b, { dur: 0.25, f0: 900, f1: 200, gain: 0.6 }); break;
      case 'rocket': this.noise(b, { dur: 0.6, type: 'bandpass', f0: 900, f1: 200, q: 0.8, gain: 1, attack: 0.02 }); this.tone(b, { dur: 0.3, f0: 120, f1: 50, gain: 0.7 }); break;
      case 'tesla': this.tone(b, { dur: 0.1, type: 'sawtooth', f0: rand(70, 110), f1: rand(140, 220), gain: 0.25 }); this.noise(b, { dur: 0.1, type: 'highpass', f0: 3000, gain: 0.25 }); break;
    }
  },
  click() { if (this.ctx) this.noise(this.bus(0.4, 0, 0), { dur: 0.03, type: 'bandpass', f0: 3500, q: 6, gain: 0.6 }); },
  empty() { if (this.ctx) this.tone(this.bus(0.4, 0, 0), { dur: 0.03, type: 'square', f0: 1800, f1: 900, gain: 0.2 }); },
  thud(x, z) { const b = this.at(x, z, 0.6, 0.1); this.noise(b, { dur: 0.1, f0: 900, f1: 200, gain: 0.9 }); },
  bounce(x, z) { const b = this.at(x, z, 0.5, 0.1); this.tone(b, { dur: 0.06, type: 'triangle', f0: 900, f1: 500, gain: 0.3 }); },
  voice(x, z, pitch, { dur, up, down, vol = 0.5, filt = 600, wet = 0.3 }) {
    const b = this.at(x, z, 1, wet);
    if (!b) return null;
    const c = this.ctx, t = c.currentTime, base = pitch * rand(0.9, 1.1);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * up, t); o.frequency.exponentialRampToValueAtTime(base * down, t + dur);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.value = filt;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(b); o.start(t); o.stop(t + dur + 0.05);
    return b;
  },
  pain(x, z, pitch) { this.voice(x, z, pitch, { dur: 0.22, up: 1.6, down: 1.1, vol: 0.55, filt: 900 }); },
  death(x, z, pitch) { const b = this.voice(x, z, pitch, { dur: 0.9, up: 1.8, down: 0.4, vol: 0.6, filt: 700 }); this.noise(b, { start: 0.25, dur: 0.25, f0: 300, f1: 80, gain: 0.6 }); },
  gib(x, z) { const b = this.at(x, z, 1, 0.2); this.noise(b, { dur: 0.35, f0: 700, f1: 90, gain: 1 }); this.noise(b, { start: 0.08, dur: 0.2, type: 'bandpass', f0: 400, q: 2, gain: 0.7 }); },
  jump(x, z, pitch) { this.voice(x, z, pitch * 1.3, { dur: 0.12, up: 1, down: 1.3, vol: 0.2, filt: 900, wet: 0.05 }); },
  land(x, z) { const b = this.at(x, z, 0.45, 0.05); this.noise(b, { dur: 0.15, f0: 300, f1: 80, gain: 1 }); },
  footstep(x, z) { const b = this.at(x, z, 0.22, 0.05); this.noise(b, { dur: 0.08, f0: rand(400, 650), f1: 120, gain: 0.8 }); },
  explosion(x, z) {
    const b = this.at(x, z, 1.4, 0.6);
    this.noise(b, { dur: 1.3, f0: 1500, f1: 60, gain: 1.2 }); this.tone(b, { dur: 0.9, f0: 70, f1: 25, gain: 1 });
    this.noise(b, { dur: 0.3, type: 'highpass', f0: 2000, gain: 0.4 });
  },
  teleport(x, z) { const b = this.at(x, z, 0.8, 0.5); this.tone(b, { dur: 0.5, f0: 180, f1: 1400, gain: 0.25, type: 'triangle' }); this.noise(b, { dur: 0.6, type: 'bandpass', f0: 600, f1: 4000, q: 4, gain: 0.4 }); },
  respawnItem(x, z) { const b = this.at(x, z, 0.35, 0.4); this.tone(b, { dur: 0.3, type: 'triangle', f0: 600, f1: 1200, gain: 0.2 }); },
  pickup(kind) {
    if (!this.ctx) return;
    const b = this.bus(0.45, 0, 0.2);
    if (kind === 'weapon') { this.noise(b, { dur: 0.06, type: 'bandpass', f0: 1200, q: 3, gain: 0.8 }); this.noise(b, { start: 0.14, dur: 0.08, type: 'bandpass', f0: 900, q: 3, gain: 0.9 }); this.tone(b, { start: 0.14, dur: 0.2, f0: 90, f1: 60, gain: 0.5 }); }
    else if (kind === 'power') { [220, 330, 440, 660].forEach((f, i) => this.tone(b, { start: i * 0.07, dur: 0.4, type: 'square', f0: f, gain: 0.08 })); }
    else if (kind === 'armor') { this.noise(b, { dur: 0.25, type: 'bandpass', f0: 2500, q: 2, gain: 0.6 }); this.tone(b, { dur: 0.2, f0: 300, gain: 0.2 }); }
    else { this.tone(b, { dur: 0.08, type: 'square', f0: 660, gain: 0.15 }); this.tone(b, { start: 0.07, dur: 0.12, type: 'square', f0: 990, gain: 0.12 }); }
  },
  frag() { if (!this.ctx) return; const b = this.bus(0.35, 0, 0.3); this.tone(b, { dur: 0.15, type: 'square', f0: 880, gain: 0.12 }); this.tone(b, { start: 0.1, dur: 0.3, type: 'square', f0: 1320, gain: 0.1 }); },
  hit() { if (this.ctx) this.tone(this.bus(0.25, 0, 0), { dur: 0.04, type: 'square', f0: 1400, gain: 0.12 }); },
  sizzle(x, z) { const b = this.at(x, z, 0.5, 0.1); this.noise(b, { dur: 0.3, type: 'highpass', f0: 2500, gain: 0.4 }); },
  rage() { if (!this.ctx) return; const b = this.bus(0.3, 0, 0.5); this.tone(b, { dur: 0.25, type: 'sawtooth', f0: 70, f1: 110, gain: 0.15 }); },
  win() { if (!this.ctx) return; const b = this.bus(0.5, 0, 0.6); [262, 330, 392, 523].forEach((f, i) => this.tone(b, { start: i * 0.18, dur: 0.9, type: 'square', f0: f, gain: 0.07 })); },
  ambience() {
    const c = this.ctx, g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(0.4, c.currentTime + 4);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    lp.connect(g); g.connect(this.master);
    [[41, 'sine', 0.22], [41.7, 'sine', 0.22], [61.5, 'triangle', 0.07]].forEach(([f, type, v]) => {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f; og.gain.value = v; o.connect(og); og.connect(lp); o.start();
    });
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
    const wg = c.createGain(); wg.gain.value = 0.05;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.06; lg.gain.value = 0.04;
    lfo.connect(lg); lg.connect(wg.gain); src.connect(bp); bp.connect(wg); wg.connect(this.master); wg.connect(this.verbIn);
    src.start(); lfo.start();
  },
};

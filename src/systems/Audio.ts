/**
 * Small procedural sound engine (no audio files): wind, a soft generative music bed per map, ambient layers per
 * map (birds, city hum, gulls, forest ...), footsteps per ground, and the one-shot effects of the game.
 *
 * Each map picks its sound with `MapData.audio` (app 5+): a music preset, ambient layers, footstep kind, wind
 * strength. Unknown ids are skipped, so a newer map never breaks an older app; maps without it use AUDIO_DEFAULTS.
 */
export type StepKind = 'grass' | 'stone' | 'metal' | 'wood' | 'soft' | 'candy';
export type AudioProfile = { music?: string; amb?: string[]; steps?: StepKind; wind?: number };

export const AUDIO_DEFAULTS: Record<string, AudioProfile> = {
  map001: { music: 'village', amb: ['birds', 'bells', 'chimes'], steps: 'grass', wind: 1 },
  map002: { music: 'city', amb: ['city', 'horns', 'pigeons'], steps: 'stone', wind: 1.1 },
  map003: { music: 'port', amb: ['gulls', 'shiphorn', 'metal', 'water'], steps: 'metal', wind: 1.2 },
  map004: { music: 'candy', amb: ['sparkle', 'pops', 'birds'], steps: 'candy', wind: 0.8 },
  map005: { music: 'toy', amb: ['toys', 'sparkle'], steps: 'wood', wind: 0.9 },
  map006: { music: 'forest', amb: ['drips', 'frogs', 'crickets', 'owl'], steps: 'grass', wind: 0.7 },
  map007: { music: 'playground', amb: ['playground', 'birds', 'chimes'], steps: 'soft', wind: 0.9 },
};

/** a music preset: scale (semitones), root (MIDI), chord progression (scale degrees), tempo, voices */
type Music = {
  root: number; scale: number[]; prog: number[]; bpm: number; density: number;
  lead: 'flute' | 'epiano' | 'marimba' | 'celesta' | 'musicbox' | 'bell' | 'pluck';
  pad: OscillatorType; padCut: number; bass: boolean; leadOct?: number;
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11], DORIAN = [0, 2, 3, 5, 7, 9, 10], MIXO = [0, 2, 4, 5, 7, 9, 10], AEOL = [0, 2, 3, 5, 7, 8, 10];
const MUSIC: Record<string, Music> = {
  village: { root: 62, scale: MAJOR, prog: [0, 5, 3, 4], bpm: 82, density: 0.42, lead: 'flute', pad: 'sine', padCut: 900, bass: false },
  city: { root: 57, scale: DORIAN, prog: [0, 3, 6, 4], bpm: 76, density: 0.36, lead: 'epiano', pad: 'triangle', padCut: 700, bass: true },
  port: { root: 55, scale: MIXO, prog: [0, 6, 3, 0], bpm: 92, density: 0.5, lead: 'marimba', pad: 'sine', padCut: 800, bass: true },
  candy: { root: 72, scale: MAJOR, prog: [0, 3, 4, 5], bpm: 100, density: 0.55, lead: 'celesta', pad: 'sine', padCut: 1200, bass: false, leadOct: 0 },
  toy: { root: 65, scale: MAJOR, prog: [0, 4, 5, 3], bpm: 112, density: 0.58, lead: 'musicbox', pad: 'triangle', padCut: 1000, bass: true, leadOct: 1 },
  forest: { root: 52, scale: AEOL, prog: [0, 5, 2, 6], bpm: 64, density: 0.3, lead: 'bell', pad: 'triangle', padCut: 600, bass: false, leadOct: 1 },
  playground: { root: 67, scale: MAJOR, prog: [0, 4, 5, 3], bpm: 108, density: 0.55, lead: 'pluck', pad: 'sine', padCut: 1100, bass: true },
};
const MUS_K = 1.2; // music bus level (the bed sits a little under the wind)
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class AudioEngine {
  ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private mus!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  volume = 0.7;
  music = 0.6;
  // map profile
  private profileId = '';
  private profile: AudioProfile = {};
  private timers = new Map<string, number>();
  private beds = new Map<string, { g: GainNode; stop: () => void }>();
  // music scheduler
  private preset: Music | null = null;
  private nextNote = 0;
  private stepIdx = 0;
  private motif: (number | null)[] = [];
  private lastDeg = 0;
  // loops driven by the player (sliding / zipline friction)
  private rub: { g: GainNode; f: BiquadFilterNode } | null = null;
  /** air of a nearby fan */
  private hum: GainNode | null = null;

  /** `given`: render into another context (devtools record the sound offline) */
  init(given?: BaseAudioContext) {
    if (this.ctx && !given) { if (this.ctx.state === 'suspended' && 'resume' in this.ctx) void (this.ctx as AudioContext).resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC && !given) return;
    const ctx = given ?? new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = this.music * MUS_K; this.mus.connect(this.master);
    // white-ish noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.97 + w * 0.03; d[i] = w * 0.5 + last * 3; }
    // wind loop
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    src.start();
    // friction loop (slides, ziplines): silent until used
    const rs = ctx.createBufferSource(); rs.buffer = this.noise; rs.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 700; rf.Q.value = 1.2;
    const rg = ctx.createGain(); rg.gain.value = 0;
    rs.connect(rf).connect(rg).connect(this.sfx); rs.start();
    this.rub = { g: rg, f: rf };
    const hs = ctx.createBufferSource(); hs.buffer = this.noise; hs.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 260; hf.Q.value = 0.8;
    this.hum = ctx.createGain(); this.hum.gain.value = 0;
    hs.connect(hf).connect(this.hum).connect(this.sfx); hs.start();
    const p = this.profileId; this.profileId = ''; if (p) this.setMap(p, this.profile);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  setMusic(v: number) {
    this.music = v;
    if (this.ctx) this.mus.gain.setTargetAtTime(v * MUS_K, this.ctx.currentTime, 0.1);
  }

  /** the map the player is in: its music, ambient layers and footsteps (cross-fades on a change) */
  setMap(id: string | undefined, prof?: AudioProfile | null) {
    const key = id ?? '';
    if (key === this.profileId) return;
    this.profileId = key;
    this.profile = prof ?? AUDIO_DEFAULTS[key] ?? { amb: ['birds'], steps: 'stone' };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const want = new Set(this.profile.amb ?? []);
    for (const [k, b] of this.beds) if (!want.has(k)) { b.g.gain.setTargetAtTime(0, t, 0.8); const s = b.stop; setTimeout(s, 4000); this.beds.delete(k); }
    this.timers.clear();
    for (const k of want) { this.timers.set(k, 1 + Math.random() * 4); if (BEDS[k] && !this.beds.has(k)) this.beds.set(k, BEDS[k](this)); }
    const m = this.profile.music ? MUSIC[this.profile.music] ?? null : null;
    if (m !== this.preset) {
      // fade the bed out, then start the new tune on its first bar
      this.mus.gain.setTargetAtTime(0, t, 0.6);
      this.mus.gain.setTargetAtTime(this.music * MUS_K, t + 2.2, 0.8);
      this.preset = m; this.stepIdx = 0; this.motif = []; this.nextNote = t + 2.2;
    }
  }

  /** height: metres, fallSpeed: m/s downward */
  // parameter changes are sent ~12 times a second, not every frame: each one is an automation event the audio
  // thread has to process (60 a second per parameter piled up work there and on the main thread)
  private paramT = 0;
  private sent = new Map<AudioParam, number>();
  private setParam(p: AudioParam, v: number, tc: number, eps: number) {
    const was = this.sent.get(p);
    if (was !== undefined && Math.abs(was - v) < eps) return;
    this.sent.set(p, v);
    p.setTargetAtTime(v, this.ctx!.currentTime, tc);
  }

  update(dt: number, height: number, fallSpeed: number, time: number) {
    if (!this.ctx) return;
    this.paramT -= dt;
    const doParams = this.paramT <= 0;
    if (doParams) this.paramT = 0.08;
    if (!doParams) { this.tickShots(dt); this.scheduleMusic(); return; }
    const h = Math.min(1, height / 200), wk = this.profile.wind ?? 1;
    const gust = 0.5 + 0.5 * Math.sin(time * 0.37) * Math.sin(time * 0.13 + 1);
    const g = (0.025 + h * 0.07 + gust * 0.02 * (0.3 + h)) * wk + Math.min(0.25, Math.max(0, fallSpeed - 8) * 0.012);
    this.setParam(this.windGain.gain, g, 0.25, 0.002);
    this.setParam(this.windFilter.frequency, 300 + h * 300 + gust * 150 + Math.max(0, fallSpeed - 8) * 30, 0.3, 8);
    this.tickShots(dt);
    this.scheduleMusic();
  }

  private shotDt = 0;
  private tickShots(dt: number) {
    this.shotDt += dt;
    if (this.shotDt < 0.08) return;
    dt = this.shotDt;
    this.shotDt = 0;
    // ambient one-shots
    for (const [k, left] of this.timers) {
      const f = SHOTS[k];
      if (!f) continue;
      const l = left - dt;
      if (l > 0) { this.timers.set(k, l); continue; }
      this.timers.set(k, f(this));
    }
  }

  /** sliding / zipline friction: 0 = silent, speed in m/s */
  rubbing(speed: number) {
    if (!this.ctx || !this.rub) return;
    const k = Math.min(1, speed / 12);
    this.setParam(this.rub.g.gain, speed > 0.5 ? 0.04 + k * 0.09 : 0, 0.08, 0.004);
    this.setParam(this.rub.f.frequency, 500 + k * 900, 0.1, 20);
  }

  /** a fan blowing nearby: 0..1 */
  fan(k: number) { if (this.ctx && this.hum) this.setParam(this.hum.gain, k * 0.1, 0.15, 0.003); }

  // ------------------------------------------------------------------ building blocks
  private env(g: GainNode, t: number, a: number, peak: number, dcy: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }
  private out(dest: AudioNode, pan: number) {
    if (!pan || !this.ctx!.createStereoPanner) return dest;
    const p = this.ctx!.createStereoPanner(); p.pan.value = pan; p.connect(dest); return p;
  }

  tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0, dest?: AudioNode, pan = 0, attack = 0.008) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(this.out(dest ?? this.sfx, pan));
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  burst(freq: number, q: number, dur: number, peak: number, type: BiquadFilterType = 'bandpass', delay = 0, dest?: AudioNode, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, 0.005, peak, dur);
    s.connect(f).connect(g).connect(this.out(dest ?? this.sfx, pan));
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  /** a note at an absolute time (music) */
  private note(type: OscillatorType, f: number, t: number, a: number, dur: number, peak: number, dest: AudioNode, cut = 0, vib = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    let node: AudioNode = o;
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2; lg.gain.value = f * vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + a + dur + 0.1); }
    if (cut) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; o.connect(fl); node = fl; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    node.connect(g).connect(dest);
    o.start(t); o.stop(t + a + dur + 0.05);
  }

  // ------------------------------------------------------------------ music
  private scheduleMusic() {
    const m = this.preset, ctx = this.ctx!;
    if (!m || this.music <= 0.001) return;
    const eighth = 30 / m.bpm;
    if (this.nextNote < ctx.currentTime - 0.5) this.nextNote = ctx.currentTime + 0.05; // tab was asleep
    while (this.nextNote < ctx.currentTime + 0.25) {
      this.playStep(m, this.stepIdx, this.nextNote, eighth);
      this.nextNote += eighth * (this.stepIdx % 2 === 0 ? 1.04 : 0.96); // a touch of swing
      this.stepIdx = (this.stepIdx + 1) % (8 * 16);
    }
  }

  private playStep(m: Music, i: number, t: number, e: number) {
    const bar = Math.floor(i / 8) % 16, pos = i % 8;
    const deg = m.prog[bar % m.prog.length];
    const sc = (d: number, oct = 0) => { const n = m.scale.length; return m.root + m.scale[((d % n) + n) % n] + 12 * (Math.floor(d / n) + oct); };
    // a new two-bar motif every four bars, played twice (the second time a little changed): it sounds like a tune
    if (pos === 0 && bar % 4 === 0) {
      this.motif = [];
      let d = this.lastDeg;
      for (let k = 0; k < 16; k++) {
        const strong = k % 4 === 0;
        if (Math.random() < (strong ? m.density + 0.25 : m.density) && !(k % 8 === 7)) { d = Math.max(-2, Math.min(9, d + Math.round((Math.random() - 0.5) * 4))); this.motif.push(d); }
        else this.motif.push(null);
      }
      this.lastDeg = d;
    }
    if (pos === 0 && bar % 4 === 2) for (let k = 0; k < 3; k++) { const j = Math.floor(Math.random() * 16); if (this.motif[j] !== null) this.motif[j] = (this.motif[j] as number) + (Math.random() < 0.5 ? 1 : -1); }
    const dest = this.mus;
    if (pos === 0) {
      // pad: the bar's chord, soft and slow
      for (const k of [0, 2, 4]) this.note(m.pad, hz(sc(deg + k, -1)), t, 0.5, e * 8 - 0.2, 0.035, dest, m.padCut);
      if (m.bass) this.note('triangle', hz(sc(deg, -2)), t, 0.02, e * 3, 0.07, dest, 500);
    }
    if (m.bass && pos === 4) this.note('triangle', hz(sc(deg + 4, -2)), t, 0.02, e * 3, 0.05, dest, 500);
    const md = this.motif[((bar % 2) * 8 + pos) % 16];
    if (md === null || md === undefined || bar % 8 === 7 && pos > 3) return; // breathe at the end of a phrase
    // lean the melody onto the chord on the strong beats
    let d = md;
    if (pos % 4 === 0) { const ct = [deg, deg + 2, deg + 4, deg + 7]; d = ct.reduce((a, b) => (Math.abs(b - md) < Math.abs(a - md) ? b : a)); }
    const f = hz(sc(d, m.leadOct ?? 0));
    switch (m.lead) {
      case 'flute': this.note('triangle', f, t, 0.04, e * 1.6, 0.05, dest, 2400, 0.006); break;
      case 'epiano': this.note('sine', f, t, 0.01, e * 2.5, 0.06, dest); this.note('sine', f * 2, t, 0.005, e * 0.8, 0.012, dest); break;
      case 'marimba': this.note('sine', f, t, 0.005, e * 1.2, 0.07, dest); this.note('sine', f * 4, t, 0.003, e * 0.25, 0.015, dest); break;
      case 'celesta': this.note('sine', f, t, 0.004, e * 2.4, 0.05, dest); this.note('sine', f * 3, t, 0.003, e * 0.6, 0.012, dest); break;
      case 'musicbox': this.note('sine', f, t, 0.003, e * 2.0, 0.05, dest); this.note('triangle', f * 2, t, 0.003, e * 0.4, 0.012, dest); break;
      case 'bell': this.note('sine', f, t, 0.006, e * 4, 0.045, dest); this.note('sine', f * 2.76, t, 0.004, e * 1.5, 0.01, dest); break;
      case 'pluck': this.note('triangle', f, t, 0.004, e * 1.1, 0.06, dest, 2600); this.note('sine', f * 2, t, 0.003, e * 0.4, 0.015, dest); break;
    }
  }

  // ------------------------------------------------------------------ game effects
  jump() { this.burst(1200, 0.8, 0.18, 0.12); this.tone('sine', 320, 520, 0.12, 0.05); }
  land(intensity: number) {
    const k = Math.min(1, intensity), s = this.profile.steps;
    this.burst(260, 0.7, 0.12 + k * 0.25, 0.12 + k * 0.3, 'lowpass');
    this.tone('sine', 110, 45, 0.12 + k * 0.25, 0.08 + k * 0.3);
    if (s === 'metal') this.tone('triangle', 520, 480, 0.25 + k * 0.3, 0.02 + k * 0.03);
    else if (s === 'wood') this.tone('sine', 220, 180, 0.1, 0.05 + k * 0.05);
    else if (s === 'candy' || s === 'soft') this.tone('sine', 160, 90, 0.15, 0.05);
  }
  step(run: boolean) {
    const v = run ? 1 : 0.65, r = 0.9 + Math.random() * 0.2;
    switch (this.profile.steps) {
      case 'grass': this.burst(2400 * r, 0.6, 0.07, 0.04 * v, 'highpass'); this.burst(500 * r, 1, 0.05, 0.02 * v); break;
      case 'metal': this.burst(900 * r, 1.2, 0.05, 0.065 * v); this.tone('triangle', 1700 * r, 1650 * r, 0.08, 0.008 * v); break;
      case 'wood': this.burst(420 * r, 1.6, 0.05, 0.06 * v); this.tone('sine', 190 * r, 170 * r, 0.05, 0.025 * v); break;
      case 'soft': this.burst(300 * r, 0.8, 0.06, 0.05 * v, 'lowpass'); break;
      case 'candy': this.burst(380 * r, 1, 0.06, 0.05 * v, 'lowpass'); this.tone('sine', 300 * r, 420 * r, 0.04, 0.012 * v); break;
      default: this.burst(run ? 900 : 700, 1.2, 0.05, run ? 0.05 : 0.03);
    }
  }
  /** wading through a ball pit: plastic balls knocking together */
  balls() { for (let i = 0; i < 4; i++) this.tone('sine', 900 + Math.random() * 900, 700, 0.03, 0.02, i * 0.03 + Math.random() * 0.02, undefined, (Math.random() - 0.5) * 0.6); }
  grab() { this.tone('triangle', 260, 180, 0.08, 0.12); this.burst(1800, 2, 0.05, 0.06); }
  climb() { this.burst(500, 1, 0.12, 0.08); this.burst(450, 1, 0.12, 0.07, 'bandpass', 0.35); }
  click() { this.tone('sine', 880, 660, 0.06, 0.05); }
  boing() { this.tone('sine', 180, 720, 0.32, 0.14); this.tone('triangle', 360, 1200, 0.22, 0.05, 0.03); this.burst(900, 1.5, 0.1, 0.05); }
  whoosh() { this.burst(1600, 0.7, 0.45, 0.14, 'bandpass', 0.05); this.tone('sine', 420, 880, 0.3, 0.05); }
  clank() { this.tone('square', 140, 120, 0.06, 0.03); this.burst(2600, 3, 0.05, 0.05); }
  /** a cannon firing */
  boom() { this.burst(140, 0.5, 0.6, 0.3, 'lowpass'); this.tone('sine', 90, 35, 0.5, 0.3); this.burst(1200, 0.6, 0.25, 0.08, 'bandpass', 0.02); }
  /** a crumbling floor starts to give way */
  crack(k = 1) { for (let i = 0; i < 3; i++) this.burst(1600 + Math.random() * 1400, 2.5, 0.04, 0.07 * k, 'bandpass', i * 0.07 + Math.random() * 0.04); this.tone('sawtooth', 120, 80, 0.2, 0.02 * k, 0.05); }
  /** a swing seat at the top of its swing */
  creak(k = 1) { this.tone('sawtooth', 330 + Math.random() * 60, 260, 0.22, 0.015 * k, 0, undefined, 0, 0.06); this.tone('sawtooth', 420, 380, 0.12, 0.01 * k, 0.2); }
  /** a plate puzzle step / a revealed piece */
  rise() { [392, 523.25, 659.25].forEach((f, i) => this.tone('triangle', f, f * 1.01, 0.18, 0.04, i * 0.06)); }
  chime() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone('sine', f, f, 0.5, 0.09, i * 0.09)); }
  fanfare() { [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => { this.tone('triangle', f, f, 0.6, 0.08, i * 0.12); this.tone('sine', f * 2, f * 2, 0.4, 0.03, i * 0.12); }); }

  // ambient helpers (used by SHOTS / BEDS)
  get ambBus() { return this.amb; }
  get noiseBuf() { return this.noise; }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pan = () => (Math.random() - 0.5) * 1.4;

/** ambient one-shots: play, return seconds until the next one */
const SHOTS: Record<string, (a: AudioEngine) => number> = {
  birds: (a) => { const b = rnd(2200, 3800), n = 2 + Math.floor(Math.random() * 3), p = pan(); for (let i = 0; i < n; i++) a.tone('sine', b, b * rnd(1.2, 1.55), 0.07, 0.016, i * 0.11, a.ambBus, p); return rnd(2.5, 8); },
  bells: (a) => { const f = [196, 220, 247][Math.floor(Math.random() * 3)], p = pan(); for (let i = 0; i < 3; i++) for (const [m, k] of [[1, 1], [2.76, 0.35], [5.4, 0.15]]) a.tone('sine', f * m * (i === 1 ? 1.122 : 1), f * m * (i === 1 ? 1.122 : 1), 2.8, 0.012 * k, i * 0.9, a.ambBus, p, 0.01); return rnd(25, 50); },
  chimes: (a) => { const sc = [0, 2, 4, 7, 9], p = pan(), n = 3 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) { const f = hz(84 + sc[Math.floor(Math.random() * 5)] + (Math.random() < 0.3 ? 12 : 0)); a.tone('sine', f, f, 1.6, 0.008, i * rnd(0.12, 0.35), a.ambBus, p, 0.004); } return rnd(9, 20); },
  horns: (a) => { const p = pan(), f = rnd(330, 420); a.tone('square', f, f, 0.25, 0.006, 0, a.ambBus, p); a.tone('square', f * 1.26, f * 1.26, 0.25, 0.005, 0, a.ambBus, p); if (Math.random() < 0.5) { a.tone('square', f, f, 0.18, 0.006, 0.35, a.ambBus, p); } return rnd(7, 18); },
  pigeons: (a) => { const p = pan(); for (let i = 0; i < 3; i++) a.tone('sine', 420, 330, 0.28, 0.01, i * 0.45, a.ambBus, p, 0.08); return rnd(10, 22); },
  gulls: (a) => { const p = pan(), n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) { a.tone('triangle', rnd(1500, 1900), rnd(900, 1100), 0.32, 0.012, i * 0.38, a.ambBus, p, 0.03); } return rnd(5, 13); },
  shiphorn: (a) => { const p = pan() * 0.5; a.tone('sawtooth', 73, 71, 2.6, 0.02, 0, a.ambBus, p, 0.4); a.tone('sawtooth', 110, 107, 2.6, 0.012, 0, a.ambBus, p, 0.4); a.burst(150, 0.7, 2.6, 0.01, 'lowpass', 0, a.ambBus, p); return rnd(35, 70); },
  metal: (a) => { const p = pan(); if (Math.random() < 0.5) { a.tone('triangle', rnd(300, 600), rnd(280, 560), 0.9, 0.008, 0, a.ambBus, p, 0.005); a.burst(2400, 4, 0.05, 0.02, 'bandpass', 0, a.ambBus, p); } else a.tone('sawtooth', rnd(90, 130), rnd(140, 180), 0.7, 0.006, 0, a.ambBus, p, 0.2); return rnd(6, 15); },
  sparkle: (a) => { const p = pan(), b = 84 + Math.floor(Math.random() * 5) * 2; for (let i = 0; i < 4; i++) { const f = hz(b + [0, 4, 7, 12][i]); a.tone('sine', f, f, 0.35, 0.006, i * 0.06, a.ambBus, p, 0.003); } return rnd(6, 14); },
  pops: (a) => { const p = pan(), n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) a.tone('sine', rnd(250, 400), rnd(800, 1200), 0.06, 0.018, i * rnd(0.1, 0.25), a.ambBus, p); return rnd(4, 10); },
  toys: (a) => { const p = pan(); if (Math.random() < 0.5) for (let i = 0; i < 8; i++) a.burst(3000, 6, 0.015, 0.025, 'bandpass', i * 0.12, a.ambBus, p); else { const f = rnd(500, 900); for (let i = 0; i < 3; i++) a.tone('square', f * [1, 1.5, 1.25][i], f * [1, 1.5, 1.25][i], 0.07, 0.006, i * 0.1, a.ambBus, p); } return rnd(6, 14); },
  drips: (a) => { const p = pan(); a.tone('sine', rnd(1300, 1800), rnd(500, 700), 0.08, 0.02, 0, a.ambBus, p); return rnd(1.5, 5); },
  frogs: (a) => { const p = pan(), f = rnd(150, 220), n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) a.tone('square', f, f * 0.8, 0.12, 0.006, i * 0.22, a.ambBus, p, 0.02); return rnd(6, 15); },
  owl: (a) => { const p = pan(); a.tone('sine', 390, 350, 0.35, 0.02, 0, a.ambBus, p, 0.06); a.tone('sine', 390, 330, 0.55, 0.02, 0.6, a.ambBus, p, 0.06); return rnd(25, 45); },
  crickets: (a) => { const p = pan(), f = rnd(4200, 5200); for (let i = 0; i < 6; i++) a.tone('sine', f, f, 0.03, 0.004, i * 0.06, a.ambBus, p, 0.004); return rnd(0.8, 2.5); },
  playground: (a) => {
    const p = pan(), r = Math.random();
    if (r < 0.35) { a.tone('sine', 2100, 2000, 0.5, 0.008, 0, a.ambBus, p, 0.02); } // a distant whistle
    else if (r < 0.7) { a.tone('sawtooth', 380, 300, 0.25, 0.004, 0, a.ambBus, p, 0.05); a.tone('sawtooth', 460, 420, 0.2, 0.003, 0.9, a.ambBus, p, 0.05); } // a swing creaking
    else { a.tone('sine', 160, 600, 0.25, 0.01, 0, a.ambBus, p); } // someone bouncing
    return rnd(5, 12);
  },
  city: () => 999,
  water: () => 999,
};

/** continuous beds: a low city hum, water lapping */
const BEDS: Record<string, (a: AudioEngine) => { g: GainNode; stop: () => void }> = {
  city: (a) => bed(a, 'lowpass', 160, 0.7, 0.05, 0.03),
  water: (a) => bed(a, 'lowpass', 420, 0.5, 0.025, 0.12),
};
function bed(a: AudioEngine, type: BiquadFilterType, freq: number, q: number, level: number, lfo: number) {
  const ctx = a.ctx!;
  const s = ctx.createBufferSource(); s.buffer = a.noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(level, ctx.currentTime, 1.5);
  // slow swell (traffic, waves)
  const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = lfo; lg.gain.value = level * 0.5; l.connect(lg).connect(g.gain); l.start();
  s.connect(f).connect(g).connect(a.ambBus); s.start(ctx.currentTime, Math.random());
  return { g, stop: () => { try { s.stop(); l.stop(); } catch { /* already stopped */ } } };
}

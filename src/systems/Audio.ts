/** Small procedural sound engine (no audio files): wind ambience, jump/land/grab/steps, chimes. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private birdsTimer = 3;
  volume = 0.7;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
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
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** height: metres, fallSpeed: m/s downward */
  update(dt: number, height: number, fallSpeed: number, time: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const h = Math.min(1, height / 140);
    const gust = 0.5 + 0.5 * Math.sin(time * 0.37) * Math.sin(time * 0.13 + 1);
    const g = 0.025 + h * 0.07 + gust * 0.02 * (0.3 + h) + Math.min(0.25, Math.max(0, fallSpeed - 8) * 0.012);
    this.windGain.gain.setTargetAtTime(g, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(300 + h * 300 + gust * 150 + Math.max(0, fallSpeed - 8) * 30, t, 0.3);
    // birds near the village
    if (height < 25) {
      this.birdsTimer -= dt;
      if (this.birdsTimer <= 0) { this.birdsTimer = 2.5 + Math.random() * 6; this.chirp(); }
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, dcy: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, 0.008, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(freq: number, q: number, dur: number, peak: number, type: BiquadFilterType = 'bandpass', delay = 0) {
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
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  jump() { this.burst(1200, 0.8, 0.18, 0.12); this.tone('sine', 320, 520, 0.12, 0.05); }
  land(intensity: number) {
    const k = Math.min(1, intensity);
    this.burst(260, 0.7, 0.12 + k * 0.25, 0.12 + k * 0.3, 'lowpass');
    this.tone('sine', 110, 45, 0.12 + k * 0.25, 0.08 + k * 0.3);
  }
  step(run: boolean) { this.burst(run ? 900 : 700, 1.2, 0.05, run ? 0.05 : 0.03); }
  grab() { this.tone('triangle', 260, 180, 0.08, 0.12); this.burst(1800, 2, 0.05, 0.06); }
  climb() { this.burst(500, 1, 0.12, 0.08); this.burst(450, 1, 0.12, 0.07, 'bandpass', 0.35); }
  click() { this.tone('sine', 880, 660, 0.06, 0.05); }
  chime() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone('sine', f, f, 0.5, 0.09, i * 0.09)); }
  fanfare() { [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => { this.tone('triangle', f, f, 0.6, 0.08, i * 0.12); this.tone('sine', f * 2, f * 2, 0.4, 0.03, i * 0.12); }); }
  private chirp() {
    const base = 2200 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone('sine', base, base * (1.25 + Math.random() * 0.3), 0.07, 0.018, i * 0.11);
  }
}

/** Original procedural score: no samples, network requests, or third-party composition. */
export class Synth {
  private context?: AudioContext;
  private music = 0.3;
  private effects = 0.45;
  private muted = false;
  private beat = -1;
  unlock(): void {
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => undefined);
    } catch {
      /* Audio is optional. */
    }
  }
  configure(music: number, sfx: number, muted: boolean): void {
    this.music = music;
    this.effects = sfx;
    this.muted = muted;
  }
  reset(): void {
    this.beat = -1;
  }
  private note(hz: number, duration: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.muted || gain === 0) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = type;
    osc.frequency.value = hz;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain * 0.15, t + 0.009);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
  tick(tick: number, bpm: number): void {
    const beat = Math.floor((((tick / 60) * bpm) / 60) * 2);
    if (beat === this.beat) return;
    this.beat = beat;
    const melody = [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 3, 7, 10, 7];
    this.note(130.81 * 2 ** ((melody[beat % 16] ?? 0) / 12), 0.22, this.music, 'triangle');
    if (beat % 4 === 0) this.note(65.4 * 2 ** ((melody[beat % 16] ?? 0) / 12), 0.32, this.music * 1.4);
    if (beat % 2 === 0) this.note(48, 0.09, this.music * 1.2);
  }
  jump(): void {
    this.note(440, 0.07, this.effects, 'triangle');
  }
  death(): void {
    this.note(75, 0.15, this.effects, 'sawtooth');
  }
  win(): void {
    for (const hz of [261.6, 329.6, 392]) this.note(hz, 0.6, this.effects);
  }
  dispose(): void {
    void this.context?.close().catch(() => undefined);
  }
}

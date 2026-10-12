/** Original procedural score: no samples, network requests, or third-party composition. */
type Patch = {
  root: number;
  melody: readonly number[];
  bass: readonly number[];
  subdivisions: number;
  timbre: OscillatorType;
  length: number;
  gain: number;
};
const patches: Record<string, Patch> = {
  'first-light': {
    root: 130.81,
    melody: [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 3, 7, 10, 7],
    bass: [0, 3, 5, 3],
    subdivisions: 2,
    timbre: 'triangle',
    length: 0.22,
    gain: 1,
  },
  overclock: {
    root: 146.83,
    melody: [12, 7, 0, 7, 15, 12, 7, 3, 17, 12, 5, 12, 19, 14, 7, 10],
    bass: [0, 0, 5, 7],
    subdivisions: 4,
    timbre: 'square',
    length: 0.08,
    gain: 0.4,
  },
  'night-shift': {
    root: 110,
    melody: [12, -1, 19, 15, 10, -1, 17, 14, 8, 15, -1, 19, 7, 14, 10, -1],
    bass: [0, -2, -4, -5],
    subdivisions: 2,
    timbre: 'sine',
    length: 0.35,
    gain: 1.2,
  },
  'pulse-120': {
    root: 123.47,
    melody: [0, 12, 7, 15, 0, 10, 7, 12],
    bass: [0, 3, 5, 7],
    subdivisions: 2,
    timbre: 'triangle',
    length: 0.16,
    gain: 0.8,
  },
};
export class Synth {
  private context?: AudioContext;
  private music = 0.3;
  private effects = 0.45;
  private muted = false;
  private beat = -1;
  private patch = patches['pulse-120']!;
  selectPatch(audioId: string): void {
    this.patch = Object.hasOwn(patches, audioId) ? patches[audioId]! : patches['pulse-120']!;
    this.reset();
  }
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
    const patch = this.patch;
    const beat = Math.floor((((tick / 60) * bpm) / 60) * patch.subdivisions);
    if (beat === this.beat) return;
    this.beat = beat;
    const note = patch.melody[beat % patch.melody.length] ?? -1;
    if (note >= 0)
      this.note(patch.root * 2 ** (note / 12), patch.length, this.music * patch.gain, patch.timbre);
    if (beat % (patch.subdivisions * 2) === 0) {
      const bass = patch.bass[Math.floor(beat / (patch.subdivisions * 4)) % patch.bass.length] ?? 0;
      this.note((patch.root / 2) * 2 ** (bass / 12), 0.38, this.music * 1.4);
    }
    if (beat % patch.subdivisions === 0) this.note(48, 0.09, this.music * 1.2);
    if (beat % patch.subdivisions === patch.subdivisions - 1) this.note(4200, 0.025, this.music * 0.1);
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

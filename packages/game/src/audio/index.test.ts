import { afterEach, expect, it, vi } from 'vitest';
import { Synth } from './index';
type Tone = { hz: number; type: string };
const tones: Tone[] = [];
class TestAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { value: 0 },
      connect() {},
      start() {
        tones.push({ hz: this.frequency.value, type: this.type });
      },
      stop() {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  tones.length = 0;
});
it('plays distinct original scores for curated audio IDs and a stable repo fallback', () => {
  vi.stubGlobal('AudioContext', TestAudioContext);
  const signatures: string[] = [];
  for (const id of ['first-light', 'overclock', 'night-shift', 'pulse-120', 'unknown-patch']) {
    tones.length = 0;
    const synth = new Synth();
    synth.selectPatch(id);
    synth.unlock();
    for (let tick = 0; tick < 120; tick++) synth.tick(tick, 120);
    signatures.push(JSON.stringify(tones));
    synth.dispose();
  }
  expect(new Set(signatures.slice(0, 4)).size).toBe(4);
  expect(signatures[4]).toBe(signatures[3]);
});
it('deduplicates music subdivisions and honors mute without requiring an audio device', () => {
  vi.stubGlobal('AudioContext', TestAudioContext);
  const synth = new Synth();
  synth.unlock();
  synth.tick(0, 120);
  const count = tones.length;
  synth.tick(0, 120);
  expect(tones.length).toBe(count);
  synth.configure(1, 1, true);
  synth.tick(30, 120);
  synth.jump();
  expect(tones.length).toBe(count);
  synth.dispose();
});

import Phaser from 'phaser';
import type { LevelSpec } from '../../../level-schema/src/index';
import {
  createRun,
  stepRun,
  restartRun,
  setCheckpoint,
  restoreCheckpoint,
  type RunState,
} from '../simulation/index';
import { Synth } from '../audio/index';

export type Palette = { accent: number; sky: number; mountain: number; floor: number };
export const palettes: Record<string, Palette> = {
  signal: { accent: 0xb2ff61, sky: 0x080d0b, mountain: 0x11271c, floor: 0x15251a },
  glacier: { accent: 0x79dfff, sky: 0x090e16, mountain: 0x142936, floor: 0x172a36 },
  ember: { accent: 0xffb36b, sky: 0x150c0b, mountain: 0x382017, floor: 0x352019 },
};
export type GameOptions = {
  level: LevelSpec;
  practice: boolean;
  theme: string;
  reducedMotion: boolean;
  music: number;
  sfx: number;
  muted: boolean;
  onState: (state: RunState, flush?: boolean) => void;
  onPause: () => void;
};
export class GameHost {
  private game: Phaser.Game;
  private state: RunState;
  private paused = false;
  private held = false;
  private pressed = false;
  private accumulator = 0;
  private synth = new Synth();
  private lastPublish = 0;
  private element: HTMLElement;
  private options: GameOptions;
  private trail: { x: number; y: number }[] = [];
  constructor(element: HTMLElement, options: GameOptions) {
    this.element = element;
    this.options = options;
    this.state = createRun(options.level, options.practice);
    this.synth.selectPatch(options.level.audioId);
    this.synth.configure(options.music, options.sfx, options.muted);
    this.synth.unlock();
    const owner = this;
    class RunScene extends Phaser.Scene {
      private pen!: Phaser.GameObjects.Graphics;
      create(): void {
        this.pen = this.add.graphics();
      }
      update(_time: number, delta: number): void {
        owner.update(delta);
        owner.draw(this.pen);
      }
    }
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: element,
      width: 960,
      height: 540,
      backgroundColor: '#080d0b',
      antialias: true,
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: RunScene,
      banner: false,
    });
    element.addEventListener('pointerdown', this.pointerDown);
    window.addEventListener('pointerup', this.release);
    window.addEventListener('pointercancel', this.release);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    options.onState(this.state);
  }
  private release = (): void => {
    this.held = false;
  };
  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.paused) return;
    event.preventDefault();
    this.element.focus();
    this.synth.unlock();
    this.held = true;
    this.pressed = true;
  };
  private keyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('button,input,select,textarea,a,[role="dialog"]')
    )
      return;
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault();
      this.options.onPause();
      return;
    }
    if (this.paused) return;
    if (event.code === 'KeyR') {
      event.preventDefault();
      this.retry();
      return;
    }
    if (event.code === 'KeyC' && this.options.practice) {
      event.preventDefault();
      this.checkpoint();
      return;
    }
    if (event.code === 'Space' || event.code === 'ArrowUp') {
      event.preventDefault();
      if (!event.repeat) this.pressed = true;
      this.held = true;
      this.synth.unlock();
    }
  };
  private keyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space' || event.code === 'ArrowUp') this.held = false;
  };
  private blur = (): void => {
    this.held = false;
    this.pressed = false;
    if (!this.paused && this.state.status === 'playing') this.options.onPause();
  };
  private visibility = (): void => {
    if (document.hidden) this.blur();
  };
  configure(options: Pick<GameOptions, 'theme' | 'reducedMotion' | 'music' | 'sfx' | 'muted'>): void {
    Object.assign(this.options, options);
    this.synth.configure(options.music, options.sfx, options.muted);
  }
  pause(value: boolean): void {
    if (value) this.flushProgress();
    this.paused = value;
    this.held = false;
    this.pressed = false;
    this.accumulator = 0;
    if (!value) {
      this.element.focus();
      this.synth.unlock();
    }
  }
  retry(): void {
    this.flushProgress();
    this.state =
      this.options.practice && this.state.checkpoint
        ? restoreCheckpoint(this.options.level, this.state)
        : restartRun(this.options.level, this.state);
    this.trail = [];
    this.accumulator = 0;
    this.held = false;
    this.pressed = false;
    this.synth.reset();
    this.options.onState(this.state);
    this.element.focus();
  }
  checkpoint(): void {
    this.state = setCheckpoint(this.options.level, this.state);
    this.options.onState(this.state);
  }
  flushProgress(): void {
    this.options.onState(this.state, true);
  }
  private update(delta: number): void {
    if (this.paused || this.state.status !== 'playing') return;
    this.accumulator = Math.min(this.accumulator + delta, 100);
    while (this.accumulator >= 1000 / 60 && this.state.status === 'playing') {
      const before = this.state;
      this.state = stepRun(this.options.level, this.state, {
        jumpPressed: this.pressed,
        jumpHeld: this.held,
      });
      this.pressed = false;
      this.accumulator -= 1000 / 60;
      if (before.grounded && !this.state.grounded && this.state.vy > 0) this.synth.jump();
      this.synth.tick(this.state.tick, this.options.level.bpm);
      if (this.state.status === 'dead') this.synth.death();
      if (this.state.status === 'completed') this.synth.win();
      if (!this.options.reducedMotion) {
        this.trail.unshift({ x: this.state.x, y: this.state.y });
        if (this.trail.length > 12) this.trail.pop();
      }
    }
    if (
      this.state.tick - this.lastPublish >= 6 ||
      this.state.status !== 'playing' ||
      this.state.tick < this.lastPublish
    ) {
      this.lastPublish = this.state.tick;
      this.options.onState(this.state);
    }
  }
  private draw(g: Phaser.GameObjects.Graphics): void {
    const p = palettes[this.options.theme] ?? palettes.signal!;
    const s = this.state;
    const camera = s.x - 170;
    const ground = 410;
    g.clear();
    g.fillStyle(p.sky);
    g.fillRect(0, 0, 960, 540);
    g.lineStyle(1, p.accent, 0.045);
    for (let x = -((s.x * 0.15) % 60); x < 960; x += 60) g.lineBetween(x, 0, x, 540);
    for (let y = 50; y < 540; y += 60) g.lineBetween(0, y, 960, y);
    // Quiet geometric skyline; all artwork is generated locally.
    for (let i = -1; i < 16; i++) {
      const x = i * 90 - ((s.x * 0.22) % 90);
      const h = 65 + (((i + Math.floor((s.x * 0.22) / 90) + 24) * 47) % 145);
      g.fillStyle(p.mountain, 0.6);
      g.fillRect(x, ground - h, 63, h);
      g.lineStyle(1, p.accent, 0.08);
      g.strokeRect(x, ground - h, 63, h);
      g.lineStyle(1, p.accent, 0.09);
      g.lineBetween(x + 10, ground - h + 13, x + 30, ground - h + 13);
    }
    g.fillStyle(p.floor);
    g.fillRect(0, ground, 960, 130);
    g.lineStyle(2, p.accent, 0.6);
    g.lineBetween(0, ground, 960, ground);
    g.lineStyle(1, p.accent, 0.08);
    for (let x = -(s.x % 48); x < 960; x += 48) g.lineBetween(x, ground, x - 100, 540);
    for (const chunk of this.options.level.chunks)
      for (const o of chunk.obstacleInstances) {
        const x = o.x - camera;
        if (x + o.width < -50 || x > 1010) continue;
        if (o.kind === 'gap') {
          g.fillStyle(p.sky);
          g.fillRect(x, ground, o.width, 130);
          g.lineStyle(2, p.accent, 0.6);
          g.lineBetween(x, ground, x, ground + 24);
          g.lineBetween(x + o.width, ground, x + o.width, ground + 24);
        } else if (o.kind === 'spike') {
          g.fillStyle(0x0b120e);
          g.fillTriangle(
            x,
            ground - o.y,
            x + o.width / 2,
            ground - o.y - o.height,
            x + o.width,
            ground - o.y,
          );
          g.lineStyle(2, p.accent, 0.95);
          g.strokeTriangle(
            x,
            ground - o.y,
            x + o.width / 2,
            ground - o.y - o.height,
            x + o.width,
            ground - o.y,
          );
          g.fillStyle(p.accent, 0.3);
          g.fillTriangle(
            x + o.width * 0.3,
            ground - o.y - 4,
            x + o.width / 2,
            ground - o.y - o.height * 0.6,
            x + o.width * 0.7,
            ground - o.y - 4,
          );
        } else if (o.kind === 'block' || o.kind === 'platform') {
          const top = ground - o.y - (o.kind === 'block' ? o.height : 0);
          g.fillStyle(p.mountain);
          g.fillRect(x, top, o.width, o.height);
          g.lineStyle(2, p.accent, 0.8);
          g.strokeRect(x, top, o.width, o.height);
          g.fillStyle(p.accent);
          g.fillRect(x, top, o.width, 3);
        }
      }
    const finish = this.options.level.finishX - camera;
    if (finish < 1000) {
      g.fillStyle(p.accent, 0.08);
      g.fillRect(finish, 0, 100, ground);
      g.lineStyle(3, p.accent);
      g.lineBetween(finish, 110, finish, ground);
    }
    for (let i = this.trail.length - 1; i > 0; i--) {
      const t = this.trail[i]!;
      g.fillStyle(p.accent, (1 - i / 12) * 0.12);
      g.fillRect(t.x - camera + 6, ground - t.y - 22, 16, 16);
    }
    if (s.status !== 'dead') {
      g.save();
      g.translateCanvas(s.x - camera + 14, ground - s.y - 14);
      if (!s.grounded && !this.options.reducedMotion) g.rotateCanvas(-s.tick * 0.1);
      g.fillStyle(p.accent);
      g.fillRoundedRect(-14, -14, 28, 28, 3);
      g.fillStyle(p.sky);
      g.fillRect(-8, -6, 4, 6);
      g.fillRect(4, -6, 4, 6);
      g.fillRect(-5, 5, 10, 3);
      g.restore();
    } else {
      g.lineStyle(2, p.accent, 0.7);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.lineBetween(
          184 + Math.cos(a) * 17,
          ground - s.y - 14 + Math.sin(a) * 17,
          184 + Math.cos(a) * 29,
          ground - s.y - 14 + Math.sin(a) * 29,
        );
      }
    }
  }
  destroy(): void {
    this.flushProgress();
    this.element.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointerup', this.release);
    window.removeEventListener('pointercancel', this.release);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
    this.synth.dispose();
    this.game.destroy(true);
  }
}

import { prefs } from '../prefs';
import type { SoundPackId } from '../themes/types';
import { PACKS, type SoundEvent } from './packs';
import type { Voice } from './synth';

// Same sound again within this window is dropped (a burst of tool calls must not machine-gun).
const MIN_GAP_MS: Partial<Record<SoundEvent, number>> = { tool: 90, key: 25 };
const DEFAULT_GAP_MS = 150;
const MASTER = 0.9;

/** Generated sounds only (no files). Silent until the first user gesture unlocks audio. */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: Voice | null = null;
  private pack: SoundPackId = 'synth';
  private last = new Map<string, number>();

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
      if (this.ctx?.state === 'running') {
        removeEventListener('pointerdown', unlock, true);
        removeEventListener('keydown', unlock, true);
      }
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
    // Hidden tab: let the audio thread sleep (battery).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    prefs.on((_p, changed) => {
      if (changed.includes('volume') || changed.includes('muted')) this.applyVolume();
    });
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  setPack(id: SoundPackId): void {
    this.pack = id;
  }

  play(ev: SoundEvent, variant?: string): void {
    if (prefs.get().muted || !this.voice || this.ctx?.state !== 'running') return;
    const key = ev === 'tool' ? ev : `${ev}:${variant ?? ''}`;
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < (MIN_GAP_MS[ev] ?? DEFAULT_GAP_MS)) return;
    this.last.set(key, now);
    try {
      PACKS[this.pack][ev](this.voice, variant);
    } catch {
      // A bad node graph must never break the UI.
    }
  }

  private ensure(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.connect(comp);
    // Shared echo: delay with damped feedback.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    damp.connect(master);
    this.ctx = ctx;
    this.master = master;
    this.voice = { ctx, out: master, delay };
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    const p = prefs.get();
    this.master.gain.setTargetAtTime(p.muted ? 0 : p.volume * MASTER, this.ctx.currentTime, 0.03);
  }
}

export const audio = new AudioEngine();

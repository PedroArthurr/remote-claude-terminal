import type { ToolCategory } from '@ccc/shared';
import type { SoundPackId } from '../themes/types';
import { noise, semis, tone, type Voice } from './synth';

export type SoundEvent = 'key' | 'prompt' | 'tool' | 'permission' | 'done' | 'error' | 'ack' | 'theme';

export type Pack = Record<SoundEvent, (v: Voice, variant?: string) => void>;

// Each tool family gets its own pitch, so a busy session "sounds" like what it is doing.
const TOOL_STEP: Record<ToolCategory, number> = {
  edit: 0,
  read: 3,
  search: 5,
  shell: 7,
  web: 10,
  agent: 12,
  mcp: 8,
  other: -2,
};
const step = (variant?: string) => TOOL_STEP[variant as ToolCategory] ?? 0;

/** 8-bit: square and triangle waves, snappy arpeggios. */
const chip: Pack = {
  key: (v) => tone(v, { type: 'square', f: 1250, dur: 0.012, gain: 0.025 }),
  prompt: (v) => {
    tone(v, { type: 'square', f: 659, dur: 0.05, gain: 0.07 });
    tone(v, { type: 'square', f: 988, at: 0.055, dur: 0.07, gain: 0.07 });
  },
  tool: (v, c) => {
    const f = semis(880, step(c));
    tone(v, { type: 'square', f, dur: 0.035, gain: 0.035 });
    tone(v, { type: 'triangle', f: f / 2, dur: 0.05, gain: 0.05 });
  },
  permission: (v) => {
    for (const at of [0, 0.3]) {
      tone(v, { type: 'square', f: 988, at, dur: 0.07, gain: 0.08 });
      tone(v, { type: 'square', f: 1319, at: at + 0.09, dur: 0.12, gain: 0.08 });
    }
  },
  done: (v) => {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(v, { type: 'square', f, at: i * 0.07, dur: 0.09, gain: 0.06 }));
    tone(v, { type: 'triangle', f: 523, at: 0.21, hold: 0.1, dur: 0.45, gain: 0.12 });
    tone(v, { type: 'square', f: 2093, at: 0.28, hold: 0.05, dur: 0.35, gain: 0.035 });
  },
  error: (v) => {
    tone(v, { type: 'square', f: 330, f2: 55, dur: 0.38, gain: 0.08 });
    noise(v, { dur: 0.14, gain: 0.07, filter: { type: 'lowpass', f: 1400 } });
  },
  ack: (v) => {
    tone(v, { type: 'triangle', f: 1047, dur: 0.05, gain: 0.08 });
    tone(v, { type: 'triangle', f: 1568, at: 0.05, dur: 0.07, gain: 0.08 });
  },
  theme: (v) => {
    tone(v, { type: 'square', f: 988, dur: 0.07, gain: 0.06 });
    tone(v, { type: 'square', f: 1319, at: 0.075, hold: 0.05, dur: 0.35, gain: 0.06 });
  },
};

/** Futuristic: sine pings, filtered saws, sweeps, echo. */
const synth: Pack = {
  key: (v) => tone(v, { f: 2400, dur: 0.02, gain: 0.02 }),
  prompt: (v) => {
    tone(v, { f: 220, f2: 880, attack: 0.02, dur: 0.26, gain: 0.07, send: 0.3 });
    noise(v, { attack: 0.05, dur: 0.22, gain: 0.035, filter: { type: 'bandpass', f: 500, f2: 4000, q: 2 } });
  },
  tool: (v, c) => {
    const f = semis(1320, step(c));
    tone(v, { f, dur: 0.12, gain: 0.035, send: 0.35 });
    tone(v, { f: f * 2.01, dur: 0.06, gain: 0.012 });
  },
  permission: (v) => {
    for (const at of [0, 0.18, 0.36]) {
      for (const [f, d] of [
        [440, -8],
        [554, 7],
      ] as const) {
        tone(v, { type: 'sawtooth', f, detune: d, at, dur: 0.13, gain: 0.04, filter: { type: 'lowpass', f: 1900, q: 6 } });
      }
    }
    tone(v, { f: 1760, at: 0.36, dur: 0.4, gain: 0.03, send: 0.5 });
  },
  done: (v) => {
    [880, 1109, 1319, 1760].forEach((f, i) => tone(v, { f, at: i * 0.06, dur: 0.55, gain: 0.045, send: 0.45 }));
    tone(v, {
      type: 'sawtooth',
      f: 220,
      attack: 0.08,
      hold: 0.1,
      dur: 0.7,
      gain: 0.03,
      filter: { type: 'lowpass', f: 500, f2: 3000, q: 4 },
      send: 0.3,
    });
  },
  error: (v) => {
    tone(v, { type: 'sawtooth', f: 233, f2: 52, dur: 0.5, gain: 0.05, filter: { type: 'lowpass', f: 1600, q: 8 } });
    tone(v, { type: 'sawtooth', f: 220, f2: 49, detune: 20, dur: 0.5, gain: 0.05, filter: { type: 'lowpass', f: 1600, q: 8 } });
    noise(v, { dur: 0.09, gain: 0.05, filter: { type: 'highpass', f: 2500 } });
  },
  ack: (v) => {
    tone(v, { f: 1760, dur: 0.06, gain: 0.035 });
    tone(v, { f: 2640, at: 0.045, dur: 0.1, gain: 0.03, send: 0.4 });
  },
  theme: (v) => {
    tone(v, {
      type: 'sawtooth',
      f: 110,
      f2: 880,
      attack: 0.05,
      dur: 0.6,
      gain: 0.04,
      filter: { type: 'lowpass', f: 300, f2: 5000, q: 6 },
      send: 0.4,
    });
  },
};

/** Ambient / analog: relay clicks, soft thumps, bells, warm pads, hum. */
const ambient: Pack = {
  key: (v) => noise(v, { dur: 0.006, gain: 0.05, filter: { type: 'bandpass', f: 3200, q: 3 } }),
  prompt: (v) => {
    noise(v, { dur: 0.012, gain: 0.1, filter: { type: 'bandpass', f: 2200, q: 2 } });
    tone(v, { f: 130, f2: 60, dur: 0.2, gain: 0.12 });
  },
  tool: (v, c) => {
    noise(v, { dur: 0.008, gain: 0.035, filter: { type: 'highpass', f: 4000 } });
    tone(v, { type: 'triangle', f: semis(440, step(c)), dur: 0.09, gain: 0.018, filter: { type: 'lowpass', f: 1500 } });
  },
  permission: (v) => {
    for (const [at, f] of [
      [0, 880],
      [0.45, 659],
    ] as const) {
      tone(v, { f, at, dur: 1.1, gain: 0.05, send: 0.3 });
      tone(v, { f: f * 2.76, at, dur: 0.45, gain: 0.015 });
    }
  },
  done: (v) => {
    for (const f of [262, 330, 392, 494]) {
      tone(v, { type: 'triangle', f, attack: 0.12, hold: 0.2, dur: 1.3, gain: 0.03, filter: { type: 'lowpass', f: 1400 }, send: 0.4 });
    }
    tone(v, { f: 1047, at: 0.12, dur: 0.9, gain: 0.02, send: 0.5 });
  },
  error: (v) => {
    tone(v, { f: 50, hold: 0.25, dur: 0.35, gain: 0.12 });
    tone(v, { type: 'square', f: 100, hold: 0.25, dur: 0.3, gain: 0.02, filter: { type: 'lowpass', f: 300 } });
    noise(v, { dur: 0.32, gain: 0.05, filter: { type: 'bandpass', f: 1200, q: 0.8 } });
  },
  ack: (v) => {
    noise(v, { dur: 0.01, gain: 0.08, filter: { type: 'bandpass', f: 2200, q: 2 } });
    tone(v, { f: 660, dur: 0.12, gain: 0.035 });
  },
  theme: (v) => {
    // CRT power-on: thump, degauss buzz, flyback whine.
    tone(v, { f: 70, f2: 40, dur: 0.4, gain: 0.14 });
    noise(v, { attack: 0.02, dur: 0.4, gain: 0.06, filter: { type: 'lowpass', f: 900, f2: 200 } });
    tone(v, { f: 300, f2: 1400, attack: 0.1, dur: 0.5, gain: 0.012 });
  },
};

export const PACKS: Record<SoundPackId, Pack> = { chip, synth, ambient };

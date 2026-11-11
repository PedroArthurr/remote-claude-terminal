// Tiny WebAudio voice helpers. Every voice is fire-and-forget: nodes stop themselves and get GC'd.

export interface Voice {
  ctx: AudioContext;
  /** Dry output. */
  out: AudioNode;
  /** Shared echo send (themes that use space). */
  delay: AudioNode;
}

interface Filter {
  type: BiquadFilterType;
  f: number;
  /** Sweep target over the note. */
  f2?: number;
  q?: number;
}

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  /** Pitch glide target. */
  f2?: number;
  /** Start offset (s). */
  at?: number;
  /** Decay length after attack + hold (s). */
  dur: number;
  gain: number;
  attack?: number;
  hold?: number;
  detune?: number;
  filter?: Filter;
  /** Amount sent to the echo (0..1). */
  send?: number;
}

const FLOOR = 0.0001;

export const semis = (base: number, n: number) => base * 2 ** (n / 12);

function filtered(v: Voice, src: AudioNode, f: Filter | undefined, t0: number, len: number): AudioNode {
  if (!f) return src;
  const bq = v.ctx.createBiquadFilter();
  bq.type = f.type;
  bq.frequency.setValueAtTime(f.f, t0);
  if (f.f2) bq.frequency.exponentialRampToValueAtTime(f.f2, t0 + len);
  if (f.q !== undefined) bq.Q.value = f.q;
  src.connect(bq);
  return bq;
}

function envelope(v: Voice, src: AudioNode, o: { gain: number; attack?: number; hold?: number; dur: number; send?: number }, t0: number): number {
  const attack = o.attack ?? 0.004;
  const hold = o.hold ?? 0;
  const end = t0 + attack + hold + o.dur;
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t0);
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + attack);
  if (hold) g.gain.setValueAtTime(o.gain, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(FLOOR, end);
  src.connect(g);
  g.connect(v.out);
  if (o.send) {
    const s = v.ctx.createGain();
    s.gain.value = o.send;
    g.connect(s);
    s.connect(v.delay);
  }
  return end;
}

export function tone(v: Voice, o: ToneOpts): void {
  const t0 = v.ctx.currentTime + 0.005 + (o.at ?? 0);
  const len = (o.attack ?? 0.004) + (o.hold ?? 0) + o.dur;
  const osc = v.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + len);
  if (o.detune) osc.detune.value = o.detune;
  const end = envelope(v, filtered(v, osc, o.filter, t0, len), o, t0);
  osc.start(t0);
  osc.stop(end + 0.02);
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

export interface NoiseOpts {
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  filter?: Filter;
  send?: number;
}

export function noise(v: Voice, o: NoiseOpts): void {
  const t0 = v.ctx.currentTime + 0.005 + (o.at ?? 0);
  const len = (o.attack ?? 0.002) + o.dur;
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx);
  src.loop = true;
  const end = envelope(v, filtered(v, src, o.filter, t0, len), { ...o, attack: o.attack ?? 0.002 }, t0);
  src.start(t0, Math.random() * 0.5);
  src.stop(end + 0.02);
}

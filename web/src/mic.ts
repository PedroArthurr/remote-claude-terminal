import { prefs } from './prefs';

// Web Speech API (Chrome: recognition runs on Google's servers, same as keyboard voice typing).
// Not in TS's DOM lib, so a minimal shape.
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  (window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

// Silence this many times in a row = user is done.
const MAX_IDLE_ROUNDS = 2;

export type MicState = 'off' | 'listening' | 'hearing';

export interface DictationHandlers {
  /** Committed text so far plus the live (interim) guess for this utterance. */
  text(final: string, interim: string): void;
  state(s: MicState): void;
  error(msg: string): void;
}

/**
 * Tap-to-talk dictation. One utterance per recognition run, restarted while on: Android's
 * `continuous` mode repeats earlier results, single runs do not.
 */
export class Dictation {
  static readonly supported = !!Ctor;
  private rec: Recognition | null = null;
  private on = false;
  private final = '';
  private idleRounds = 0;
  private heard = false;

  constructor(private readonly h: DictationHandlers) {}

  get active(): boolean {
    return this.on;
  }

  toggle(): void {
    if (this.on) this.stop();
    else this.start();
  }

  start(): void {
    if (!Ctor || this.on) return;
    this.on = true;
    this.final = '';
    this.idleRounds = 0;
    this.run();
    this.h.state('listening');
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    // Detach first: a late result must not overwrite what the user does next (edit, send).
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.onresult = rec.onend = rec.onerror = null;
      rec.abort();
    }
    this.h.state('off');
  }

  private run(): void {
    const rec = new Ctor!();
    rec.lang = prefs.get().micLang;
    rec.continuous = false;
    rec.interimResults = true;
    this.heard = false;
    let interim = '';
    rec.onspeechstart = () => {
      this.heard = true;
      if (this.on) this.h.state('hearing');
    };
    rec.onspeechend = () => {
      if (this.on) this.h.state('listening');
    };
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const t = r[0].transcript;
        if (r.isFinal) this.final = join(this.final, t);
        else interim = join(interim, t);
      }
      this.h.text(this.final, interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.on = false;
      this.h.error(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone blocked — allow it in site settings'
          : e.error === 'network'
            ? 'Speech service unreachable'
            : `Mic: ${e.error}`,
      );
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      // A guess that never became final still counts.
      if (interim) {
        this.final = join(this.final, interim);
        this.h.text(this.final, '');
      }
      this.idleRounds = this.heard ? 0 : this.idleRounds + 1;
      if (this.on && this.idleRounds < MAX_IDLE_ROUNDS) {
        this.run();
        return;
      }
      this.rec = null;
      this.on = false;
      this.h.state('off');
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.on = false;
      this.h.state('off');
    }
  }
}

function join(a: string, b: string): string {
  b = b.trim();
  if (!b) return a;
  return a ? `${a} ${b}` : b;
}

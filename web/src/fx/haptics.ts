import { prefs } from '../prefs';

// Vibration patterns (ms on/off). Short ticks for UI, longer shapes for events worth a glance.
const PATTERNS = {
  key: 8,
  tap: 12,
  toggle: [6, 40, 10],
  send: [14, 30, 22],
  nav: 10,
  prompt: 16,
  permission: [90, 60, 90, 60, 90],
  done: [30, 50, 120],
  error: [220],
  denied: [60, 40, 60],
  subagent: [10, 30, 10],
  compact: [40, 30, 20, 30, 10],
  interrupt: [120, 40, 30],
  offline: [160, 80, 160],
  online: [20, 40, 20, 40, 60],
  blocked: [40, 30, 40],
} as const satisfies Record<string, number | readonly number[]>;

export type HapticName = keyof typeof PATTERNS;

/** Vibrate (Android) if enabled. Needs a past user gesture; silently ignored otherwise. */
export function haptic(name: HapticName): void {
  if (!prefs.get().haptics || document.hidden) return;
  try {
    navigator.vibrate?.(PATTERNS[name] as number | number[]);
  } catch {
    // Blocked without user activation; harmless.
  }
}

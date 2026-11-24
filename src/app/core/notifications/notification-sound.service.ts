import { Injectable, inject } from '@angular/core';
import { Subject, throttleTime } from 'rxjs';
import { PreferencesStore } from '@core/preferences/preferences.store';

/** A burst of several pushes within this window plays one chime, not one per notification. */
const THROTTLE_MS = 1_500;

/**
 * A short two-tone chime, generated on the fly (Web Audio — no audio file). One `AudioContext` is created lazily
 * and reused for the service's lifetime; each chime's oscillator/gain nodes are disconnected once it ends so the
 * audio graph never accumulates over a long session.
 */
@Injectable({ providedIn: 'root' })
export class NotificationSoundService {
  private readonly preferences = inject(PreferencesStore);
  private context: AudioContext | null = null;
  private readonly trigger = new Subject<void>();

  constructor() {
    this.trigger.pipe(throttleTime(THROTTLE_MS)).subscribe(() => this.play());
  }

  /** Call once per applied push; throttled internally, so callers never need to debounce bursts themselves. */
  notify(): void {
    if (!this.preferences.prefs().notifySound) return;
    if (typeof document !== 'undefined' && document.hidden) return; // the badge still updates silently while backgrounded
    this.trigger.next();
  }

  private play(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    for (const [frequency, start] of [
      [880, 0],
      [1_320, 0.09],
    ] as const) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(ctx.destination);

      const at = now + start;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);

      oscillator.start(at);
      oscillator.stop(at + 0.18);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }
}

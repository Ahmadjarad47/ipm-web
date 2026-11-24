import { Injectable, inject } from '@angular/core';
import { Subject, throttleTime } from 'rxjs';
import { PreferencesStore } from '@core/preferences/preferences.store';

/** A burst of several pushes within this window plays one chime, not one per notification. */
const THROTTLE_MS = 1_500;
const SOUND_SRC = '/sounds/notification.mp3';

/**
 * Plays the notification sound. One `HTMLAudioElement` is created lazily and reused for the service's
 * lifetime (never one per chime), so a long session never accumulates audio resources; each play just
 * rewinds it and calls `play()` again.
 */
@Injectable({ providedIn: 'root' })
export class NotificationSoundService {
  private readonly preferences = inject(PreferencesStore);
  private audio: HTMLAudioElement | null = null;
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
    const audio = this.ensureAudio();
    if (!audio) return;

    audio.currentTime = 0;
    // Browsers can refuse playback before any user gesture on the page; that is a normal, silent no-op here
    // (the badge count already reflects the push regardless of whether the chime played).
    void audio.play().catch(() => undefined);
  }

  private ensureAudio(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    this.audio ??= new Audio(SOUND_SRC);
    return this.audio;
  }
}

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesStore } from '@core/preferences/preferences.store';
import { NotificationSoundService } from './notification-sound.service';

/** A minimal stand-in for `HTMLAudioElement`: just enough to assert play/rewind behaviour. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  playCount = 0;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCount++;
    return Promise.resolve();
  }
}

function setup(): NotificationSoundService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  return TestBed.inject(NotificationSoundService);
}

describe('NotificationSoundService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.instances = [];
    (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
    localStorage.clear();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays one chime, from the one reused audio element, for a burst of several notifications', () => {
    const sound = setup();
    sound.notify();
    sound.notify();
    sound.notify();
    vi.advanceTimersByTime(0);

    expect(FakeAudio.instances).toHaveLength(1); // one element created, reused — not one per chime
    expect(FakeAudio.instances[0].src).toContain('/sounds/notification.mp3');
    expect(FakeAudio.instances[0].playCount).toBe(1);
  });

  it('rewinds and plays again after the throttle window has passed', () => {
    const sound = setup();
    sound.notify();
    vi.advanceTimersByTime(0);

    vi.advanceTimersByTime(2_000);
    sound.notify();
    vi.advanceTimersByTime(0);

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCount).toBe(2);
  });

  it('does not play while the tab is hidden', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const sound = setup();
    sound.notify();
    vi.advanceTimersByTime(2_000);

    expect(FakeAudio.instances).toHaveLength(0);
  });

  it('does not play when muted in preferences', () => {
    const sound = setup();
    TestBed.inject(PreferencesStore).setNotifySound(false);
    sound.notify();
    vi.advanceTimersByTime(2_000);

    expect(FakeAudio.instances).toHaveLength(0);
  });
});

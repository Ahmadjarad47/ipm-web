import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesStore } from '@core/preferences/preferences.store';
import { NotificationSoundService } from './notification-sound.service';

/** A minimal stand-in for Web Audio: just enough to assert a chime was (or wasn't) built. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly state = 'running';
  currentTime = 0;
  oscillatorsCreated = 0;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    this.oscillatorsCreated++;
    return {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
  }

  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  resume() {
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
    FakeAudioContext.instances = [];
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    localStorage.clear();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays one chime for a burst of several notifications within the throttle window', () => {
    const sound = setup();
    sound.notify();
    sound.notify();
    sound.notify();
    vi.advanceTimersByTime(0);

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].oscillatorsCreated).toBeGreaterThan(0);
  });

  it('plays again after the throttle window has passed', () => {
    const sound = setup();
    sound.notify();
    vi.advanceTimersByTime(0);
    const firstCount = FakeAudioContext.instances[0].oscillatorsCreated;

    vi.advanceTimersByTime(2_000);
    sound.notify();
    vi.advanceTimersByTime(0);

    expect(FakeAudioContext.instances[0].oscillatorsCreated).toBeGreaterThan(firstCount);
  });

  it('does not play while the tab is hidden', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const sound = setup();
    sound.notify();
    vi.advanceTimersByTime(2_000);

    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('does not play when muted in preferences', () => {
    const sound = setup();
    TestBed.inject(PreferencesStore).setNotifySound(false);
    sound.notify();
    vi.advanceTimersByTime(2_000);

    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});

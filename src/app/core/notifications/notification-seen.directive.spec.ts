import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notification } from '@domain/activity/activity.models';
import { NotificationReadBatcherService } from './notification-read-batcher.service';
import { NotificationSeenDirective } from './notification-seen.directive';

/** The real IntersectionObserver needs a layout engine; this stand-in lets tests drive it by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;

  constructor(readonly callback: (entries: readonly { isIntersecting: boolean }[]) => void) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn(() => (this.disconnected = true));
  unobserve = vi.fn();

  trigger(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }]);
  }
}

const notification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  userId: '',
  title: 't',
  body: 'b',
  link: '/x',
  read: false,
  ...overrides,
});

@Component({
  standalone: true,
  imports: [NotificationSeenDirective],
  template: `<li [appNotificationSeen]="item"></li>`,
})
class HostComponent {
  item: Notification = notification();
}

function setup(): { fixture: ComponentFixture<HostComponent>; markSeen: ReturnType<typeof vi.fn> } {
  TestBed.resetTestingModule();
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver;
  const markSeen = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: NotificationReadBatcherService, useValue: { markSeen } },
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return { fixture, markSeen };
}

describe('NotificationSeenDirective', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeIntersectionObserver.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('marks the notification seen after the dwell time, only while still intersecting', () => {
    const { markSeen } = setup();
    const observer = FakeIntersectionObserver.instances[0];

    observer.trigger(true);
    vi.advanceTimersByTime(1_000);
    expect(markSeen).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(markSeen).toHaveBeenCalledWith('n1');
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it('cancels the dwell timer if the item leaves view before it fires', () => {
    const { markSeen } = setup();
    const observer = FakeIntersectionObserver.instances[0];

    observer.trigger(true);
    vi.advanceTimersByTime(1_000);
    observer.trigger(false);
    vi.advanceTimersByTime(1_000);

    expect(markSeen).not.toHaveBeenCalled();
  });

  it('never marks an already-read notification', () => {
    TestBed.resetTestingModule();
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver;
    const markSeen = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: NotificationReadBatcherService, useValue: { markSeen } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.item = notification({ read: true });
    fixture.detectChanges();

    FakeIntersectionObserver.instances[0].trigger(true);
    vi.advanceTimersByTime(2_000);

    expect(markSeen).not.toHaveBeenCalled();
  });

  it('disconnects its observer and clears the pending timer on destroy', () => {
    const { fixture } = setup();
    const observer = FakeIntersectionObserver.instances[0];
    observer.trigger(true);

    fixture.destroy();

    expect(observer.disconnected).toBe(true);
    // the dwell timer must not fire after destroy (it would try to use a destroyed directive's state)
    vi.advanceTimersByTime(2_000);
  });
});

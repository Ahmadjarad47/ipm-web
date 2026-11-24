import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationReadBatcherService } from './notification-read-batcher.service';

function setup(): { batcher: NotificationReadBatcherService; http: HttpTestingController } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  return { batcher: TestBed.inject(NotificationReadBatcherService), http: TestBed.inject(HttpTestingController) };
}

describe('NotificationReadBatcherService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends one request for several ids seen within the buffer window, deduplicated', () => {
    const { batcher, http } = setup();
    const flushed: (readonly string[])[] = [];
    batcher.flushed.subscribe((ids) => flushed.push(ids));

    batcher.markSeen('a');
    batcher.markSeen('b');
    batcher.markSeen('a'); // duplicate within the same window
    vi.advanceTimersByTime(400);

    const req = http.expectOne((r) => r.url.endsWith('/notifications/read-batch'));
    expect(req.request.body).toEqual({ ids: ['a', 'b'] });
    req.flush(null);

    expect(flushed).toEqual([['a', 'b']]);
    http.verify();
  });

  it('sends nothing when nothing was seen in a window', () => {
    const { http } = setup();
    vi.advanceTimersByTime(400);
    http.expectNone(() => true);
  });

  it('starts a fresh batch for ids seen after the previous window flushed', () => {
    const { batcher, http } = setup();
    batcher.markSeen('a');
    vi.advanceTimersByTime(400);
    http.expectOne((r) => r.url.endsWith('/notifications/read-batch')).flush(null);

    batcher.markSeen('c');
    vi.advanceTimersByTime(400);
    const req = http.expectOne((r) => r.url.endsWith('/notifications/read-batch'));
    expect(req.request.body).toEqual({ ids: ['c'] });
    req.flush(null);
    http.verify();
  });
});

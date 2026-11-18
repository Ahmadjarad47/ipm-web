import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './offline-banner';

describe('OfflineBanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows an alert offline, a restored flash online, then hides', () => {
    const fixture = TestBed.createComponent(OfflineBanner);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.state()).toBe('online');
    expect(el.querySelector('[role="alert"]')).toBeNull();

    window.dispatchEvent(new Event('offline'));
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('أنت غير متصل');

    window.dispatchEvent(new Event('online'));
    fixture.detectChanges();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('تم استعادة الاتصال');

    vi.advanceTimersByTime(3100);
    fixture.detectChanges();
    expect(fixture.componentInstance.state()).toBe('online');
    expect(el.querySelector('.bar')).toBeNull();
  });
});

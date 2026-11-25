import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { TelegramLinkStatus } from '@domain/telegram/telegram.models';
import { TelegramLinkCard } from './telegram-link-card';

describe('TelegramLinkCard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).establish({
      token: 't',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: 'u', name: 'U', email: 'u@x', title: '' },
      systemPermissions: [],
      projectPermissions: {},
      denied: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Lets the resource publish its value, renders, and answers the settings request the date pipe makes. */
  async function settle(fixture: ComponentFixture<TelegramLinkCard>): Promise<void> {
    for (let i = 0; i < 2; i++) {
      TestBed.tick();
      fixture.detectChanges();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    http.match((r) => r.url.endsWith('/settings')).forEach((r) => r.flush({}));
  }

  async function render(status: TelegramLinkStatus): Promise<{ fixture: ComponentFixture<TelegramLinkCard>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(TelegramLinkCard);
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/telegram/link')).flush(status);
    await settle(fixture);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const base: TelegramLinkStatus = { enabled: true, botUsername: 'raad_bot', linked: false, telegramUsername: null, linkedAt: null };

  it('says so when the server has Telegram turned off', async () => {
    const { el } = await render({ ...base, enabled: false });
    expect(el.textContent).toContain('إشعارات تلغرام غير مفعّلة حالياً');
    expect(el.querySelector('button')).toBeNull();
  });

  it('offers to link when not linked', async () => {
    const { el } = await render(base);
    expect(el.querySelector('button.btn--primary')?.textContent).toContain('اربط تلغرام');
  });

  it('shows the usernames and unlinks with DELETE', async () => {
    const { fixture, el } = await render({ ...base, linked: true, telegramUsername: 'ahmad', linkedAt: '2026-10-01T10:00:00Z' });
    expect(el.textContent).toContain('@raad_bot');
    expect(el.textContent).toContain('@ahmad');

    (el.querySelector('button.btn--danger') as HTMLButtonElement).click();
    http.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/telegram/link')).flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/telegram/link')).flush({ ...base });
    fixture.destroy();
  });

  it('opens the deep link, then polls until linked', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { fixture, el } = await render(base);
    vi.useFakeTimers();

    (el.querySelector('button.btn--primary') as HTMLButtonElement).click();
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/telegram/link')).flush({ deepLink: 'https://t.me/raad_bot?start=x', expiresAt: '2026-01-01T00:00:00Z' });
    expect(open).toHaveBeenCalledWith('https://t.me/raad_bot?start=x', '_blank', 'noopener');

    vi.advanceTimersByTime(3000);
    TestBed.tick();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/telegram/link')).flush({ ...base, linked: true, telegramUsername: 'a', linkedAt: '2026-10-01T10:00:00Z' });
    vi.useRealTimers();
    await settle(fixture);
    fixture.detectChanges();
    expect(el.querySelector('button.btn--danger')).not.toBeNull();

    fixture.destroy();
    http.verify();
  });
});

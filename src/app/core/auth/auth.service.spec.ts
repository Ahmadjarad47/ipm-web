import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSession } from './auth.models';
import { AuthService } from './auth.service';

function session(partial: Partial<AuthSession>): AuthSession {
  return {
    token: 't',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: 'u', name: 'U', email: 'u@x', title: '' },
    systemPermissions: [],
    projectPermissions: {},
    denied: [],
    ...partial,
  };
}

describe('AuthService.can (SRS §2.2)', () => {
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);
  });

  it('denies by default when signed out', () => {
    expect(auth.can('projects.view')).toBe(false);
  });

  it('grants system permissions everywhere and project permissions only in that project', () => {
    auth.establish(session({ systemPermissions: ['dashboard.view'], projectPermissions: { p1: ['tasks.edit'] } }));

    expect(auth.can('dashboard.view', 'p2')).toBe(true);
    expect(auth.can('tasks.edit', 'p1')).toBe(true);
    expect(auth.can('tasks.edit', 'p2')).toBe(false);
    expect(auth.can('tasks.edit')).toBe(false);
    expect(auth.canSomewhere('tasks.edit')).toBe(true);
  });

  it('explicit deny wins over any grant', () => {
    auth.establish(session({ systemPermissions: ['audit.export'], projectPermissions: { p1: ['audit.export'] }, denied: ['audit.export'] }));

    expect(auth.can('audit.export')).toBe(false);
    expect(auth.can('audit.export', 'p1')).toBe(false);
    expect(auth.canSomewhere('audit.export')).toBe(false);
  });

  it('is signed out again after the session is cleared', () => {
    auth.establish(session({ systemPermissions: ['projects.view'] }));
    expect(auth.can('projects.view')).toBe(true);

    auth.establish(null);

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.can('projects.view')).toBe(false);
  });
});

describe('AuthService session (refresh cookie)', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  const tokens = { accessToken: 'new-token', expiresAt: new Date(Date.now() + 900_000).toISOString(), mustChangePassword: false };
  const me = { user: { id: 'u', name: 'U', email: 'u@x', title: '' }, systemPermissions: ['projects.view'], projectPermissions: {}, denied: [] };

  it('brings the session back at start-up from the refresh cookie', async () => {
    const started = auth.initialize();
    http.expectOne((r) => r.url.endsWith('/auth/refresh')).flush(tokens);
    const meCall = http.expectOne((r) => r.url.endsWith('/auth/me'));
    expect(meCall.request.headers.get('Authorization')).toBe('Bearer new-token');
    meCall.flush(me);
    await started;

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.token()).toBe('new-token');
    expect(auth.can('projects.view')).toBe(true);
  });

  it('stays signed out when there is no valid refresh cookie', async () => {
    const started = auth.initialize();
    http.expectOne((r) => r.url.endsWith('/auth/refresh')).flush({ detail: 'x' }, { status: 401, statusText: 'Unauthorized' });
    await started;

    expect(auth.isAuthenticated()).toBe(false);
  });

  it('shares one refresh between callers that ask at the same time', () => {
    auth.refresh().subscribe();
    auth.refresh().subscribe();

    expect(http.match((r) => r.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });
});

describe('AuthService re-reads the grants when the tab comes back', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    auth.establish(session({ systemPermissions: ['dashboard.view'] }));
  });

  afterEach(() => vi.useRealTimers());

  const show = () => document.dispatchEvent(new Event('visibilitychange'));

  it('reads /auth/me quietly after the tab was away long enough, so a revoked permission disappears', () => {
    vi.setSystemTime(Date.now() + 31_000);
    show();

    const call = http.expectOne((r) => r.url.endsWith('/auth/me'));
    expect(call.request.headers.get('X-Silent-Error')).toBe('1');
    call.flush({ user: { id: 'u', name: 'U', email: 'u@x', title: '' }, systemPermissions: [], projectPermissions: {}, denied: [] });
    expect(auth.can('dashboard.view')).toBe(false);
  });

  it('does not ask again within 30 seconds', () => {
    show();

    http.expectNone((r) => r.url.endsWith('/auth/me'));
  });

  it('does nothing when signed out', () => {
    auth.establish(null);
    vi.setSystemTime(Date.now() + 31_000);
    show();

    http.expectNone((r) => r.url.endsWith('/auth/me'));
  });
});

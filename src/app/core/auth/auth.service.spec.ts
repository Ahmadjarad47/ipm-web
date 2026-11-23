import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
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

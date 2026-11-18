import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);
  });

  const signIn = (s: AuthSession) => sessionStorage.setItem('ipm.session', JSON.stringify(s));

  it('denies by default when signed out', () => {
    expect(auth.can('projects.view')).toBe(false);
  });

  it('grants system permissions everywhere and project permissions only in that project', () => {
    signIn(session({ systemPermissions: ['dashboard.view'], projectPermissions: { p1: ['tasks.edit'] } }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);

    expect(auth.can('dashboard.view', 'p2')).toBe(true);
    expect(auth.can('tasks.edit', 'p1')).toBe(true);
    expect(auth.can('tasks.edit', 'p2')).toBe(false);
    expect(auth.can('tasks.edit')).toBe(false);
    expect(auth.canSomewhere('tasks.edit')).toBe(true);
  });

  it('explicit deny wins over any grant', () => {
    signIn(session({ systemPermissions: ['audit.export'], projectPermissions: { p1: ['audit.export'] }, denied: ['audit.export'] }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);

    expect(auth.can('audit.export')).toBe(false);
    expect(auth.can('audit.export', 'p1')).toBe(false);
    expect(auth.canSomewhere('audit.export')).toBe(false);
  });

  it('treats an expired session as signed out', () => {
    signIn(session({ systemPermissions: ['projects.view'], expiresAt: new Date(Date.now() - 1000).toISOString() }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);

    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.can('projects.view')).toBe(false);
  });
});

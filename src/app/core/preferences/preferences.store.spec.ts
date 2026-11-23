import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { PreferencesStore } from './preferences.store';

function setup(userId: string | null): PreferencesStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  if (userId) {
    TestBed.inject(AuthService).establish({
      token: 't',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: userId, name: 'U', email: 'u@x', title: '' },
      systemPermissions: [],
      projectPermissions: {},
      denied: [],
    });
  }
  return TestBed.inject(PreferencesStore);
}

describe('PreferencesStore', () => {
  beforeEach(() => localStorage.clear());

  it('starts with defaults', () => {
    const s = setup('u1');
    expect(s.prefs().landingPage).toBe('/dashboard');
    expect(s.prefs().theme).toBe('auto');
  });

  it('persists per user under ipm.prefs.<userId>', () => {
    const s = setup('u1');
    s.update({ landingPage: '/projects', theme: 'dark' });
    s.setNotify('mention', false);
    const stored = JSON.parse(localStorage.getItem('ipm.prefs.u1') as string);
    expect(stored.landingPage).toBe('/projects');
    expect(stored.notify.mention).toBe(false);
    expect(localStorage.getItem('ipm.prefs.u2')).toBeNull();
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('ipm.prefs.u1', JSON.stringify({ landingPage: '/evil', theme: 'neon' }));
    const s = setup('u1');
    expect(s.prefs().landingPage).toBe('/dashboard');
    expect(s.prefs().theme).toBe('auto');
  });
});

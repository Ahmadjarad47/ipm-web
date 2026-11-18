import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferencesStore } from './preferences.store';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  });

  it('sets and clears data-theme on <html>', () => {
    const theme = TestBed.inject(ThemeService);
    theme.apply('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    theme.apply('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('follows the preference store', () => {
    TestBed.inject(ThemeService);
    const prefs = TestBed.inject(PreferencesStore);
    prefs.update({ theme: 'light' });
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

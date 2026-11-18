import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable } from '@angular/core';
import { PreferencesStore, ThemePreference } from './preferences.store';

/**
 * Applies the chosen theme as `data-theme` on <html>. `auto` removes the attribute so the
 * `prefers-color-scheme` rules in `_tokens.scss` decide. Instantiate once from `App`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesStore);

  constructor() {
    effect(() => this.apply(this.prefs.prefs().theme));
  }

  apply(theme: ThemePreference): void {
    const root = this.doc.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }
}

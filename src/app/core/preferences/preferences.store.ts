import { computed, inject, Injectable, linkedSignal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';

export type ThemePreference = 'light' | 'dark' | 'auto';
export type DateFormatPreference = 'relative' | 'absolute';
export type DensityPreference = 'compact' | 'comfortable';
export type NotifyEvent = 'assignment' | 'mention' | 'approvalRequest' | 'decision' | 'comment';

export interface Preferences {
  readonly landingPage: string;
  readonly tableDensity: DensityPreference;
  readonly dateFormat: DateFormatPreference;
  /** Client-side only: server-side notification preferences are not implemented yet. */
  readonly notify: Readonly<Record<NotifyEvent, boolean>>;
  /** Plays a short chime when a real-time notification arrives (muted while the tab is hidden regardless). */
  readonly notifySound: boolean;
  readonly theme: ThemePreference;
}

export const LANDING_PAGES: readonly { readonly link: string; readonly label: string }[] = [
  { link: '/dashboard', label: 'لوحة القيادة' },
  { link: '/projects', label: 'المشاريع' },
  { link: '/work-items', label: 'عناصر العمل' },
  { link: '/approvals', label: 'مركز الموافقات' },
];

export const DEFAULT_PREFERENCES: Preferences = {
  landingPage: '/dashboard',
  tableDensity: 'comfortable',
  dateFormat: 'relative',
  notify: { assignment: true, mention: true, approvalRequest: true, decision: true, comment: true },
  notifySound: true,
  theme: 'auto',
};

const THEME_KEY = 'ipm.theme';

function readStored(key: string): Partial<Preferences> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
  } catch {
    return {};
  }
}

/** Merges stored data over the defaults, dropping anything of the wrong shape. */
export function normalizePreferences(stored: Partial<Preferences>, fallbackTheme?: ThemePreference): Preferences {
  const d = DEFAULT_PREFERENCES;
  const themes: readonly string[] = ['light', 'dark', 'auto'];
  return {
    landingPage: LANDING_PAGES.some((p) => p.link === stored.landingPage) ? (stored.landingPage as string) : d.landingPage,
    tableDensity: stored.tableDensity === 'compact' || stored.tableDensity === 'comfortable' ? stored.tableDensity : d.tableDensity,
    dateFormat: stored.dateFormat === 'absolute' || stored.dateFormat === 'relative' ? stored.dateFormat : d.dateFormat,
    notify: { ...d.notify, ...(stored.notify && typeof stored.notify === 'object' ? stored.notify : {}) },
    notifySound: typeof stored.notifySound === 'boolean' ? stored.notifySound : d.notifySound,
    theme: themes.includes(stored.theme ?? '') ? (stored.theme as ThemePreference) : (fallbackTheme ?? d.theme),
  };
}

function lastTheme(): ThemePreference | undefined {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' || t === 'auto' ? t : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Per-user UI preferences in localStorage (`ipm.prefs.<userId>`). Client-side only: nothing here is
 * enforced by the server, so notification toggles only affect what this browser shows.
 * Signed-out screens (login) reuse the last chosen theme.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesStore {
  private readonly auth = inject(AuthService);
  private readonly key = computed(() => `ipm.prefs.${this.auth.user()?.id ?? 'anon'}`);

  private readonly state = linkedSignal<string, Preferences>({
    source: this.key,
    computation: (key) => normalizePreferences(readStored(key), lastTheme()),
  });
  readonly prefs = this.state.asReadonly();

  update(patch: Partial<Preferences>): void {
    const next = normalizePreferences({ ...this.state(), ...patch });
    this.state.set(next);
    try {
      localStorage.setItem(this.key(), JSON.stringify(next));
      localStorage.setItem(THEME_KEY, next.theme);
    } catch {
      /* storage unavailable — preferences last for this tab only */
    }
  }

  setNotify(event: NotifyEvent, value: boolean): void {
    this.update({ notify: { ...this.state().notify, [event]: value } });
  }

  setNotifySound(value: boolean): void {
    this.update({ notifySound: value });
  }

  reset(): void {
    this.update(DEFAULT_PREFERENCES);
  }
}

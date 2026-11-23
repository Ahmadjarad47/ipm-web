import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { map, Observable, tap } from 'rxjs';
import { ifMatch } from '@core/api/query-params';
import { API_BASE_URL } from '@core/api/api.config';
import { AuthService } from '@core/auth/auth.service';
import { DEFAULT_SETTINGS, SettingsUpdate, SystemSettings } from './settings.models';

/** Reads and updates the single organisation settings record; cached per session. */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly url = `${inject(API_BASE_URL)}/settings`;

  private readonly resource = rxResource({
    params: () => this.auth.user()?.id,
    stream: () => this.http.get<SystemSettings>(this.url).pipe(map((saved) => ({ ...saved, id: 'settings', createdAt: '', updatedAt: '' }) as SystemSettings)),
  });

  readonly loading = this.resource.isLoading;
  readonly current = computed(() => this.resource.value() ?? null);
  /** Effective values; defaults until the server answers. */
  readonly value = computed(() => this.current() ?? { ...DEFAULT_SETTINGS, id: '', version: 0, createdAt: '', updatedAt: '' });

  update(changes: SettingsUpdate): Observable<SystemSettings> {
    const { version, ...body } = changes;
    return this.http.patch<SystemSettings>(this.url, body, { headers: ifMatch(version) }).pipe(
      map((saved) => ({ ...saved, id: 'settings', createdAt: '', updatedAt: '' }) as SystemSettings),
      tap((s) => this.resource.set(s)),
    );
  }

  reload(): void {
    this.resource.reload();
  }
}

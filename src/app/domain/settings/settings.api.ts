import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { Observable, tap } from 'rxjs';
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
    params: () => this.auth.session() ?? undefined,
    stream: () => this.http.get<SystemSettings>(this.url),
  });

  readonly loading = this.resource.isLoading;
  readonly current = computed(() => this.resource.value() ?? null);
  /** Effective values; defaults until the server answers. */
  readonly value = computed(() => this.current() ?? { ...DEFAULT_SETTINGS, id: '', version: 0, createdAt: '', updatedAt: '' });

  update(changes: SettingsUpdate): Observable<SystemSettings> {
    return this.http.patch<SystemSettings>(this.url, changes).pipe(tap((s) => this.resource.set(s)));
  }

  reload(): void {
    this.resource.reload();
  }
}

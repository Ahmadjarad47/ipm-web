import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { AuthService } from '@core/auth/auth.service';
import { TelegramDeepLink, TelegramLinkStatus } from './telegram.models';

/** The signed-in user's Telegram link: status (polled quietly), one-time deep link, unlink. */
@Injectable({ providedIn: 'root' })
export class TelegramLinkStore {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly url = `${inject(API_BASE_URL)}/telegram/link`;

  private readonly resource = rxResource({
    params: () => this.auth.user()?.id,
    stream: () => this.http.get<TelegramLinkStatus>(this.url, { headers: { 'X-Silent-Error': '1' } }),
  });

  readonly loading = this.resource.isLoading;
  /** Last known status; null until the first answer (or if it failed). */
  readonly status = computed(() => this.resource.value() ?? null);

  createLink(): Observable<TelegramDeepLink> {
    return this.http.post<TelegramDeepLink>(this.url, null);
  }

  unlink(): Observable<void> {
    return this.http.delete<void>(this.url);
  }

  reload(): void {
    this.resource.reload();
  }
}

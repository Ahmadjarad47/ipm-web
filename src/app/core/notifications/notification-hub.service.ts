import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { AuthService } from '@core/auth/auth.service';
import { ServerNotification } from '@domain/activity/activity.api';

const EVENT = 'notificationReceived';

/**
 * Owns the one SignalR connection to the notifications hub. Connects while signed in, disconnects on logout
 * (also stopped on the service's own teardown, defensively — it is root-provided so that normally only happens
 * at app shutdown/HMR). The access-token factory re-reads `AuthService.token()` on every (re)connect attempt, so
 * a background token renewal never needs to tear the connection down.
 *
 * `received$` registers its `connection.on(...)` handler lazily, per subscriber, and removes it on unsubscribe
 * (standard RxJS teardown) — so nothing is registered while nobody is listening, and nothing stacks up across
 * repeated subscribe/unsubscribe cycles. SignalR's automatic reconnect only replaces the transport, never the
 * registered handlers, so a handler survives a reconnect without being re-added.
 */
@Injectable({ providedIn: 'root' })
export class NotificationHubService {
  private readonly auth = inject(AuthService);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly connection: HubConnection;

  /** True once the connection is actually established (not merely "wanted"); gates the sound/poll fallback. */
  readonly connected = signal(false);

  /** Multicast: every subscriber shares the single underlying hub registration (see the class doc). */
  readonly received$: Observable<ServerNotification>;
  /** Fires once per `(re)connected` — a cue to refetch, since SignalR never replays what was missed while down. */
  readonly reconnected$: Observable<void>;

  constructor() {
    this.connection = new HubConnectionBuilder()
      .withUrl(`${this.baseUrl}/hubs/notifications`, { accessTokenFactory: () => this.auth.token() ?? '' })
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.received$ = new Observable<ServerNotification>((subscriber) => {
      const handler = (n: ServerNotification): void => subscriber.next(n);
      this.connection.on(EVENT, handler);
      return () => this.connection.off(EVENT, handler);
    });

    this.reconnected$ = new Observable<void>((subscriber) => {
      const handler = (): void => subscriber.next();
      this.connection.onreconnected(handler);
      // HubConnection has no "off" for lifecycle callbacks; harmless to keep for the service's (app-)lifetime.
    });

    this.connection.onreconnected(() => this.connected.set(true));
    this.connection.onreconnecting(() => this.connected.set(false));
    this.connection.onclose(() => this.connected.set(false));

    effect(() => {
      if (this.auth.isAuthenticated()) void this.connect();
      else void this.disconnect();
    });

    inject(DestroyRef).onDestroy(() => void this.disconnect());
  }

  private async connect(): Promise<void> {
    if (this.connection.state !== HubConnectionState.Disconnected) return;
    try {
      await this.connection.start();
      this.connected.set(true);
    } catch {
      // withAutomaticReconnect only covers a drop after a successful start; a failed first attempt is retried
      // by NotificationStore's reduced-frequency poll fallback instead of hand-rolling a second retry loop here.
      this.connected.set(false);
    }
  }

  private async disconnect(): Promise<void> {
    this.connected.set(false);
    if (this.connection.state !== HubConnectionState.Disconnected) {
      await this.connection.stop();
    }
  }
}

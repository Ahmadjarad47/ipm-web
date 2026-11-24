import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, interval, merge, switchMap, filter } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { NotificationsApi, toNotification } from '@domain/activity/activity.api';
import { Notification, NotificationPage } from '@domain/activity/activity.models';
import { NotificationHubService } from './notification-hub.service';
import { NotificationReadBatcherService } from './notification-read-batcher.service';
import { NotificationSoundService } from './notification-sound.service';

const PAGE_SIZE = 30;
/**
 * Real-time pushes (see `NotificationHubService`) are the primary path; this is only a safety net for whatever a
 * push could miss (a connection that never came up, a gap it does not know about) and only runs while the hub
 * itself reports it is not connected — so a healthy connection means this never fires at all.
 */
const FALLBACK_POLL_MS = 180_000;

/**
 * In-app notifications (FR-UI-06). Real-time via SignalR (`NotificationHubService`): a push both updates the
 * list live and is the cue a sound plays. `refresh()` on reconnect and an interval while disconnected are the
 * only fallbacks — SignalR does not replay what was missed during a drop, so they exist to catch that, not to
 * carry the normal case.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly api = inject(NotificationsApi);
  private readonly auth = inject(AuthService);
  private readonly hub = inject(NotificationHubService);
  private readonly sound = inject(NotificationSoundService);
  private readonly batcher = inject(NotificationReadBatcherService);

  private readonly _items = signal<readonly Notification[]>([]);
  readonly items = this._items.asReadonly();
  private readonly _total = signal(0);
  private readonly _unread = signal(0);
  private readonly _loadingMore = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  /** True while the first page is being fetched by `refresh()` / `reload()`. */
  readonly loading = this._loading.asReadonly();
  /** True when the last explicit first-page fetch failed. */
  readonly error = this._error.asReadonly();
  /** Server-side unread count, so it stays right for notifications that are not loaded yet. */
  readonly unread = this._unread.asReadonly();
  readonly total = this._total.asReadonly();
  readonly hasMore = computed(() => this._items().length < this._total());
  readonly loadingMore = this._loadingMore.asReadonly();

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      if (this.auth.isAuthenticated()) this.refresh();
      else this.reset();
    });

    this.hub.received$.pipe(takeUntilDestroyed(destroyRef)).subscribe((n) => this.applyPush(toNotification(n)));
    this.hub.reconnected$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.refresh());
    this.batcher.flushed.pipe(takeUntilDestroyed(destroyRef)).subscribe((ids) => this.applyLocalRead(ids));

    merge(interval(FALLBACK_POLL_MS), fromEvent(window, 'online'))
      .pipe(
        filter(() => this.auth.isAuthenticated() && !this.hub.connected()),
        switchMap(() => this.api.page(1, PAGE_SIZE)),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((page) => this.applyFirstPage(page));
  }

  /** Reloads the first page (newest 30); pages already loaded further down are kept. */
  refresh(): void {
    this._loading.set(true);
    this.api.page(1, PAGE_SIZE).subscribe({
      next: (page) => {
        this.applyFirstPage(page);
        this._error.set(false);
        this._loading.set(false);
      },
      error: () => {
        this._error.set(true);
        this._loading.set(false);
      },
    });
  }

  /** Retry after a failed load. */
  reload(): void {
    this.refresh();
  }

  /** Appends the next page of older notifications. */
  loadMore(): void {
    if (!this.hasMore() || this._loadingMore()) return;
    this._loadingMore.set(true);
    const next = Math.floor(this._items().length / PAGE_SIZE) + 1;
    this.api.page(next, PAGE_SIZE).subscribe({
      next: (page) => {
        const known = new Set(this._items().map((n) => n.id));
        this._items.update((list) => [...list, ...page.items.filter((n) => !known.has(n.id))]);
        this._total.set(page.total);
        this._unread.set(page.unread);
        this._loadingMore.set(false);
      },
      error: () => this._loadingMore.set(false),
    });
  }

  /** Optimistic; on failure the server state is re-fetched so the badge never lies. */
  markRead(n: Notification): void {
    if (n.read) return;
    this._items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    this._unread.update((u) => Math.max(0, u - 1));
    this.api.markRead(n.id).subscribe({ error: () => this.refresh() });
  }

  markAllRead(): void {
    this._items.update((list) => list.map((x) => ({ ...x, read: true })));
    this._unread.set(0);
    this.api.markAllRead().subscribe({ error: () => this.refresh() });
  }

  /** A notification arrived live: prepend it (deduped) and count it, unless it is already known (reconnect races). */
  private applyPush(n: Notification): void {
    if (this._items().some((x) => x.id === n.id)) return;
    this._items.update((list) => [n, ...list]);
    this._total.update((t) => t + 1);
    if (!n.read) this._unread.update((u) => u + 1);
    this.sound.notify();
  }

  /**
   * The "seen in view" batcher already sent the API call; this only mirrors `markRead`'s optimistic local update
   * for each id in the batch, without a second network round trip.
   */
  private applyLocalRead(ids: readonly string[]): void {
    const set = new Set(ids);
    let newlyRead = 0;
    this._items.update((list) =>
      list.map((x) => {
        if (!set.has(x.id) || x.read) return x;
        newlyRead++;
        return { ...x, read: true };
      }),
    );
    if (newlyRead) this._unread.update((u) => Math.max(0, u - newlyRead));
  }

  private applyFirstPage(page: NotificationPage): void {
    const firstIds = new Set(page.items.map((n) => n.id));
    this._items.update((list) => [...page.items, ...list.slice(PAGE_SIZE).filter((n) => !firstIds.has(n.id))]);
    this._total.set(page.total);
    this._unread.set(page.unread);
  }

  private reset(): void {
    this._loading.set(false);
    this._error.set(false);
    this._items.set([]);
    this._total.set(0);
    this._unread.set(0);
  }
}

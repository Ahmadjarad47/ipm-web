import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, interval, merge, switchMap, filter } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { NotificationsApi } from '@domain/activity/activity.api';
import { Notification, NotificationPage } from '@domain/activity/activity.models';

const POLL_MS = 30_000;
const PAGE_SIZE = 30;

/**
 * In-app notifications (FR-UI-06). Polls while signed in and refetches when the browser comes back online.
 * Swap the poll for a SignalR stream later without touching consumers.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly api = inject(NotificationsApi);
  private readonly auth = inject(AuthService);

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
    merge(interval(POLL_MS), fromEvent(window, 'online'))
      .pipe(
        filter(() => this.auth.isAuthenticated()),
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
    this.api.update(n.id, { read: true, version: n.version }).subscribe({ error: () => this.refresh() });
  }

  markAllRead(): void {
    this._items.update((list) => list.map((x) => ({ ...x, read: true })));
    this._unread.set(0);
    this.api.markAllRead().subscribe({ error: () => this.refresh() });
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

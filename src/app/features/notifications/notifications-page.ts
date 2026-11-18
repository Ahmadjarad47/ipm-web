import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NotificationStore } from '@core/notifications/notification.store';
import { Notification } from '@domain/activity/activity.models';
import { SettingsStore } from '@domain/settings/settings.api';
import { RelativeTimePipe } from '@shared/pipes/pipes';
import { Badge } from '@shared/ui/badge/badge';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { groupByDay, isMention, KIND_LABELS, KindFilter, matchesKind } from './notification-groups';

type NotificationTab = 'all' | 'unread';

/** Notification centre (UX system #2): tabs, kind chips, day groups, bulk read, paging. Backed by the shared NotificationStore. */
@Component({
  selector: 'app-notifications-page',
  imports: [RouterLink, PageHeader, Tabs, EmptyState, Badge, Icon, RelativeTimePipe, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="الإشعارات" subtitle="كل إشعاراتك في مكان واحد.">
      <a class="btn btn--ghost" routerLink="/profile" fragment="preferences">تفضيلات الإشعارات</a>
    </app-page-header>

    <div class="card">
      <div class="top">
        <app-tabs [tabs]="tabs()" [(active)]="tab" />
        <span class="spacer"></span>
        <button type="button" class="btn btn--outline btn--sm" [disabled]="!selectedUnread().length" (click)="markSelected()">تعليم المحدد كمقروء</button>
        <button type="button" class="btn btn--outline btn--sm" [disabled]="!store.unread()" (click)="store.markAllRead()">تعليم الكل كمقروء</button>
      </div>

      <div class="chips" role="group" aria-label="تصفية حسب النوع">
        @for (k of kinds; track k.key) {
          <button type="button" class="kchip" [attr.aria-pressed]="kind() === k.key" (click)="kind.set(k.key)">
            {{ k.label }}
            <span class="n">{{ countOf(k.key) }}</span>
          </button>
        }
      </div>

      <div class="panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
        @for (g of groups(); track g.date) {
          <section [attr.aria-labelledby]="'day-' + g.date">
            <h2 class="day" [id]="'day-' + g.date">{{ g.label }}</h2>
            <ul class="list">
              @for (n of g.items; track n.id) {
                <li class="item" [class.unread]="!n.read">
                  <input type="checkbox" class="sel" [checked]="selected().has(n.id)" (change)="toggle(n.id)" [attr.aria-label]="'تحديد: ' + n.title" />
                  <button type="button" class="main" (click)="open(n)">
                    <span class="dot" [class.dot--on]="!n.read" aria-hidden="true"></span>
                    <span class="txt">
                      <strong>{{ n.title }}</strong>
                      @if (n.body) {
                        <span class="muted body">{{ n.body }}</span>
                      }
                      <small class="muted">{{ n.createdAt | relativeTime }}</small>
                    </span>
                    @if (mention(n)) {
                      <app-badge tone="info">منشن</app-badge>
                    }
                    @if (!n.read) {
                      <span class="sr-only">غير مقروء</span>
                    }
                  </button>
                </li>
              }
            </ul>
          </section>
        } @empty {
          @if (store.error() && !store.items().length) {
            <app-error-state title="تعذّر تحميل الإشعارات" (retry)="store.reload()" />
          } @else if (store.loading() && !store.items().length) {
            <app-skeleton variant="table" [count]="5" />
          } @else if (!store.items().length) {
            <app-empty-state icon="bell" title="لا توجد إشعارات" text="ستظهر هنا التنبيهات والإشارات وطلبات الموافقة." />
          } @else if (tab() === 'unread' && kind() === 'all') {
            <app-empty-state icon="checkCircle" title="لا توجد إشعارات غير مقروءة" text="أنت على اطلاع بكل شيء." />
          } @else {
            <app-empty-state icon="filter" title="لا توجد إشعارات مطابقة" text="غيّر النوع أو التبويب لعرض إشعارات أخرى." />
          }
        }
      </div>

      <footer class="foot">
        <span class="muted" role="status">عُرض {{ store.items().length }} من {{ store.total() }} إشعارًا</span>
        @if (store.hasMore()) {
          <button type="button" class="btn btn--outline btn--sm" [disabled]="store.loadingMore()" (click)="store.loadMore()">
            <app-icon name="chevronDown" [size]="14" /> {{ store.loadingMore() ? 'جارٍ التحميل…' : 'تحميل المزيد' }}
          </button>
        }
      </footer>
    </div>
  `,
  styles: `
    .top { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; padding: var(--s-3) var(--s-4) 0; }
    .chips { display: flex; flex-wrap: wrap; gap: var(--s-2); padding: var(--s-3) var(--s-4); }
    .kchip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding-inline: var(--s-3); border: 1px solid var(--c-border-strong); border-radius: var(--r-pill); background: var(--c-surface); color: var(--c-text-2); font-size: var(--fs-sm); cursor: pointer; }
    .kchip[aria-pressed='true'] { background: var(--c-primary); border-color: var(--c-primary); color: #fff; }
    .kchip:focus-visible { outline: 2px solid var(--c-emerald-600); outline-offset: 2px; }
    .n { font-size: var(--fs-xs); font-variant-numeric: tabular-nums; opacity: 0.85; }
    .day { margin: 0; padding: var(--s-2) var(--s-4); background: var(--c-surface-2); font-size: var(--fs-sm); color: var(--c-muted); }
    .list { list-style: none; margin: 0; padding: 0; }
    .item { display: flex; align-items: center; gap: var(--s-2); padding-inline-start: var(--s-4); border-bottom: 1px solid var(--c-border); }
    .item.unread { background: var(--c-emerald-50); }
    .sel { width: 18px; height: 18px; flex: none; }
    .main { flex: 1; display: flex; align-items: center; gap: var(--s-3); min-width: 0; padding: var(--s-3) var(--s-4); border: 0; background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer; }
    .main:hover { background: var(--c-surface-2); }
    .main:focus-visible { outline: 2px solid var(--c-emerald-600); outline-offset: -2px; }
    .txt { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .body { font-size: var(--fs-sm); overflow-wrap: anywhere; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: transparent; }
    .dot--on { background: var(--c-info); }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-3) var(--s-4); }
  `,
})
export class NotificationsPage {
  protected readonly store = inject(NotificationStore);
  private readonly router = inject(Router);
  private readonly settings = inject(SettingsStore);

  protected readonly tab = signal<NotificationTab>('all');
  protected readonly kind = signal<KindFilter>('all');
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly kinds = (Object.keys(KIND_LABELS) as KindFilter[]).map((key) => ({ key, label: KIND_LABELS[key] }));

  protected readonly tabs = computed<readonly TabItem<NotificationTab>[]>(() => [
    { key: 'all', label: 'الكل', count: this.store.total() },
    { key: 'unread', label: 'غير المقروءة', count: this.store.unread() },
  ]);

  private readonly visible = computed(() => {
    const unreadOnly = this.tab() === 'unread';
    const kind = this.kind();
    return this.store.items().filter((n) => (!unreadOnly || !n.read) && matchesKind(n, kind));
  });

  protected readonly groups = computed(() => groupByDay(this.visible(), this.settings.value().timeZone));

  protected readonly selectedUnread = computed(() => this.store.items().filter((n) => this.selected().has(n.id) && !n.read));

  protected countOf(kind: KindFilter): number {
    const unreadOnly = this.tab() === 'unread';
    return this.store.items().filter((n) => (!unreadOnly || !n.read) && matchesKind(n, kind)).length;
  }

  protected mention(n: Notification): boolean {
    return isMention(n);
  }

  protected toggle(id: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected markSelected(): void {
    for (const n of this.selectedUnread()) this.store.markRead(n);
    this.selected.set(new Set());
  }

  protected open(n: Notification): void {
    this.store.markRead(n);
    if (n.link) void this.router.navigateByUrl(n.link);
  }
}


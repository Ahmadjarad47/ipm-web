import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

export type ConnectionState = 'online' | 'offline' | 'restored';

/**
 * Strip above the topbar driven by the browser `online` / `offline` events.
 * Offline: persistent alert. Back online: a short «تم استعادة الاتصال» flash.
 */
@Component({
  selector: 'app-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:offline)': 'goOffline()',
    '(window:online)': 'goOnline()',
    '[class.visible]': 'state() !== "online"',
  },
  template: `
    @switch (state()) {
      @case ('offline') {
        <div class="bar off" role="alert">أنت غير متصل — ستُعاد المحاولة تلقائيًا</div>
      }
      @case ('restored') {
        <div class="bar on" role="status">تم استعادة الاتصال</div>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .bar { padding: var(--s-2) var(--s-4); text-align: center; font-size: var(--fs-sm); font-weight: 600; }
    .off { background: var(--c-warning-bg); color: var(--c-text); border-bottom: 2px solid var(--c-warning); }
    .on { background: var(--c-success-bg); color: var(--c-text); border-bottom: 2px solid var(--c-success); }
  `,
})
export class OfflineBanner {
  readonly state = signal<ConnectionState>(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  goOffline(): void {
    this.clearTimer();
    this.state.set('offline');
  }

  goOnline(): void {
    this.clearTimer();
    this.state.set('restored');
    this.timer = setTimeout(() => this.state.set('online'), 3000);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

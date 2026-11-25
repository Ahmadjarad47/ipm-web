import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { ToastService } from '@core/notifications/toast.service';
import { TelegramLinkStore } from '@domain/telegram/telegram.api';
import { AppDatePipe } from '@shared/pipes/pipes';

const POLL_MS = 3000;
const POLL_MAX_MS = 120_000;

@Component({
  selector: 'app-telegram-link-card',
  imports: [AppDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-body" aria-labelledby="tg-h">
      <h2 id="tg-h" class="section-title">إشعارات تلغرام</h2>
      @if (status(); as s) {
        @if (!s.enabled) {
          <p class="muted hint">إشعارات تلغرام غير مفعّلة حالياً</p>
        } @else if (s.linked) {
          <dl class="kv">
            <dt>البوت</dt><dd class="ltr" dir="ltr">@{{ s.botUsername }}</dd>
            <dt>حساب تلغرام</dt><dd class="ltr" dir="ltr">{{ s.telegramUsername ? '@' + s.telegramUsername : '—' }}</dd>
            <dt>تاريخ الربط</dt><dd>{{ s.linkedAt | appDate: true }}</dd>
          </dl>
          <button type="button" class="btn btn--danger btn--sm" [disabled]="busy()" (click)="unlink()">إلغاء الربط</button>
        } @else {
          <p class="muted hint">اربط حسابك بتلغرام لتصلك رسالة فورية عند إسناد مهمة جديدة إليك.</p>
          <button type="button" class="btn btn--primary" [disabled]="busy()" (click)="link()">اربط تلغرام</button>
          @if (deepLink(); as href) {
            <p class="muted hint">
              اضغط Start في تلغرام لإكمال الربط.
              <a [href]="href" target="_blank" rel="noopener">افتح تلغرام يدوياً</a>
            </p>
          }
        }
      } @else if (store.loading()) {
        <p class="muted hint">جارٍ التحميل…</p>
      } @else {
        <p class="muted hint">تعذّر قراءة حالة الربط.</p>
      }
    </section>
  `,
  styles: `
    .hint { font-size: var(--fs-sm); margin-block: var(--s-2) var(--s-3); }
    .kv { margin: 0 0 var(--s-3); }
    .kv dd { overflow-wrap: anywhere; }
    .btn { min-block-size: 44px; }
    a { color: var(--c-primary); min-block-size: 44px; display: inline-flex; align-items: center; }
  `,
})
export class TelegramLinkCard {
  protected readonly store = inject(TelegramLinkStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly status = this.store.status;
  protected readonly busy = signal(false);
  protected readonly deepLink = signal<string | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private waitingSince = 0;

  constructor() {
    // The user pressed Start in Telegram: the status flips to linked by itself.
    effect(() => {
      if (this.status()?.linked && this.timer !== null) {
        this.stopPolling();
        this.deepLink.set(null);
        this.toast.success('تم ربط تلغرام');
      }
    });

    const recheck = () => {
      if (document.visibilityState !== 'hidden') this.store.reload();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    });
  }

  protected link(): void {
    this.busy.set(true);
    this.store.createLink().subscribe({
      next: ({ deepLink }) => {
        this.busy.set(false);
        this.deepLink.set(deepLink);
        window.open(deepLink, '_blank', 'noopener');
        this.startPolling();
      },
      error: () => this.busy.set(false),
    });
  }

  protected unlink(): void {
    this.busy.set(true);
    this.store.unlink().subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success('تم إلغاء ربط تلغرام');
        this.store.reload();
      },
      error: () => this.busy.set(false),
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.waitingSince = Date.now();
    this.timer = setInterval(() => {
      if (Date.now() - this.waitingSince >= POLL_MAX_MS) this.stopPolling();
      else this.store.reload();
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}

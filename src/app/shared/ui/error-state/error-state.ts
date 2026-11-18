import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../icon/icon';

/**
 * Inline failure panel with retry:
 *   <app-error-state title="تعذّر التحميل" text="…" [correlationId]="id" (retry)="store.reload()" />
 * Extra content (links) can be projected; `correlationId` helps support trace the request.
 */
@Component({
  selector: 'app-error-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="err" role="alert">
      <span class="ico"><app-icon name="alert" [size]="26" /></span>
      <strong>{{ title() }}</strong>
      @if (text()) {
        <p class="muted">{{ text() }}</p>
      }
      @if (correlationId()) {
        <p class="cid muted">رمز التتبع: <span class="ltr">{{ correlationId() }}</span></p>
      }
      <div class="acts">
        @if (retryable()) {
          <button type="button" class="btn btn--primary" (click)="retry.emit()"><app-icon name="refresh" [size]="16" /> {{ retryLabel() }}</button>
        }
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .err { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); padding: var(--s-8) var(--s-4); text-align: center; }
    .ico { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--c-danger-bg); color: var(--c-danger); margin-bottom: var(--s-2); }
    p { max-width: 420px; font-size: var(--fs-sm); }
    .acts { display: flex; gap: var(--s-2); flex-wrap: wrap; justify-content: center; margin-top: var(--s-2); }
  `,
})
export class ErrorState {
  readonly title = input('تعذّر تحميل البيانات');
  readonly text = input('حدث خطأ أثناء الاتصال بالخادم. حاول مرة أخرى.');
  readonly correlationId = input<string | null>(null);
  readonly retryable = input(true);
  readonly retryLabel = input('إعادة المحاولة');
  readonly retry = output<void>();
}

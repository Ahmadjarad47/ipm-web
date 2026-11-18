import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ToastService } from '@core/notifications/toast.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { Icon } from '@shared/ui/icon/icon';

export interface GitSecretData {
  readonly repoName: string;
  readonly secret: string;
}

/** One-time reveal of a rotated webhook secret (§7.2): it is never returned again. */
@Component({
  selector: 'app-git-secret-dialog',
  imports: [DialogShell, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="السر الجديد لـ Webhook" [subtitle]="data.repoName">
      <p class="warn" role="alert"><app-icon name="alert" [size]="16" /> لن يُعرض مرة أخرى. انسخه الآن وحدّثه في إعدادات Webhook لدى مزوّد Git؛ إلى أن تفعل ذلك ستُرفض التسليمات الواردة.</p>
      <div class="row">
        <input class="input ltr" readonly [value]="data.secret" aria-label="السر الجديد" (focus)="$any($event.target).select()" />
        <button type="button" class="btn btn--primary" (click)="copy()"><app-icon name="link" [size]="14" /> {{ copied() ? 'نُسخ' : 'نسخ' }}</button>
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">أغلقت بعد النسخ</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .warn { display: flex; gap: var(--s-2); align-items: flex-start; margin: 0 0 var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--c-warning-bg); color: var(--c-warning); font-weight: 600; }
    .row { display: flex; gap: var(--s-2); align-items: center; }
    .row .input { flex: 1; min-width: 0; }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    @media (max-width: 480px) {
      .row { flex-wrap: wrap; }
      .row .btn { flex: 1 1 100%; }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .row .btn, .row .input { min-block-size: 44px; }
    }
  `,
})
export class GitSecretDialog {
  protected readonly data = inject(DIALOG_DATA) as GitSecretData;
  protected readonly ref = inject(DialogRef<void>);
  private readonly toast = inject(ToastService);
  protected readonly copied = signal(false);

  protected copy(): void {
    void navigator.clipboard.writeText(this.data.secret).then(() => {
      this.copied.set(true);
      this.toast.success('نُسخ السر');
    });
  }
}

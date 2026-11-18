import { ChangeDetectionStrategy, Component, inject, Injectable } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { map, Observable } from 'rxjs';
import { DialogShell } from './dialog-shell';
import { DIALOG_DATA, DialogRef, DialogService } from './dialog.service';

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmText?: string;
  readonly danger?: boolean;
  /** Ask for a mandatory reason (e.g. reject/return). The result is the text. */
  readonly requireReason?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [DialogShell, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="data.title">
      <p>{{ data.message }}</p>
      @if (data.requireReason) {
        <div class="field reason">
          <label for="confirm-reason">{{ data.requireReason }} <span class="req">*</span></label>
          <textarea id="confirm-reason" class="textarea" [(ngModel)]="reason" required></textarea>
        </div>
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn" [class.btn--danger]="data.danger" [class.btn--primary]="!data.danger"
          [disabled]="!!data.requireReason && !reason.trim()" (click)="ref.close(data.requireReason ? reason.trim() : true)">
          {{ data.confirmText ?? 'تأكيد' }}
        </button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `.reason { margin-top: var(--s-4); }`,
})
export class ConfirmDialog {
  protected readonly data = inject(DIALOG_DATA) as ConfirmOptions;
  protected readonly ref = inject(DialogRef<string | true>);
  protected reason = '';
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(DialogService);

  /** Emits `true` when confirmed, `false` otherwise. */
  confirm(options: ConfirmOptions): Observable<boolean> {
    return this.dialog
      .open<ConfirmDialog, ConfirmOptions, true>(ConfirmDialog, { data: options, width: 'min(460px, calc(100vw - 32px))' })
      .afterClosed.pipe(map((r) => r === true));
  }

  /** Emits the entered reason, or `undefined` when cancelled. */
  reason(options: ConfirmOptions & { requireReason: string }): Observable<string | undefined> {
    return this.dialog
      .open<ConfirmDialog, ConfirmOptions, string>(ConfirmDialog, { data: options, width: 'min(460px, calc(100vw - 32px))' })
      .afterClosed;
  }
}

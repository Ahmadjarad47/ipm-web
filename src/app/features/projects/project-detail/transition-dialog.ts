import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';

export interface TransitionDialogData {
  readonly projectName: string;
  readonly toStatusName: string;
  readonly requiresApproval: boolean;
}

let nextId = 0;

/** Collects the optional comment for a project status transition; closes with the comment (or undefined when cancelled). */
@Component({
  selector: 'app-transition-dialog',
  imports: [FormsModule, DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="'نقل المشروع إلى «' + data.toStatusName + '»'" [subtitle]="data.projectName">
      @if (data.requiresApproval) {
        <p class="muted">هذا الانتقال يتطلب موافقة معتمدة مسبقًا.</p>
      }
      <div class="field">
        <label [attr.for]="uid">تعليق (اختياري)</label>
        <textarea [id]="uid" class="textarea" [ngModel]="comment()" (ngModelChange)="comment.set($event)"></textarea>
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn btn--primary" (click)="ref.close(comment().trim())">تأكيد الانتقال</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class TransitionDialog {
  protected readonly data = inject(DIALOG_DATA) as TransitionDialogData;
  protected readonly ref = inject(DialogRef<string>);
  protected readonly uid = `pt-comment-${++nextId}`;
  protected readonly comment = signal('');
}

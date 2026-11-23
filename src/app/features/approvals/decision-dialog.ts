import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Decision } from '@domain/approvals/approval.models';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';

export interface DecisionDialogData {
  readonly decision: Exclude<Decision, 'approve'>;
  readonly requestTitle: string;
}

let nextId = 0;

/** Reject / Return: the comment is mandatory and validated live. Closes with the trimmed comment. */
@Component({
  selector: 'app-decision-dialog',
  imports: [FormsModule, DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="title" [subtitle]="data.requestTitle">
      <p>{{ intro }}</p>
      <div class="field">
        <label [attr.for]="uid + '-dd-comment'">التعليق <span class="req">*</span></label>
        <textarea [id]="uid + '-dd-comment'" class="textarea" rows="4" [attr.aria-describedby]="uid + '-dd-hint'" [attr.aria-invalid]="touched() && !valid()"
          [ngModel]="comment()" (ngModelChange)="comment.set($event); touched.set(true)"></textarea>
        <span [id]="uid + '-dd-hint'" class="hint" [class.err]="touched() && !valid()" [attr.role]="touched() && !valid() ? 'alert' : null">
          {{ valid() ? 'جاهز — سيظهر التعليق لمقدّم الطلب.' : 'التعليق إلزامي عند الرفض أو الإرجاع.' }}
        </span>
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn" [class.btn--danger]="data.decision === 'reject'" [class.btn--primary]="data.decision === 'return'"
          [disabled]="!valid()" (click)="ref.close(comment().trim())">{{ confirmText }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `:host { display: block; max-inline-size: calc(100vw - 32px); } .err { color: var(--c-danger); }`,
})
export class DecisionDialog {
  protected readonly uid = `decision${++nextId}`;
  protected readonly data = inject(DIALOG_DATA) as DecisionDialogData;
  protected readonly ref = inject(DialogRef<string>);
  protected readonly comment = signal('');
  protected readonly touched = signal(false);
  protected readonly valid = computed(() => !!this.comment().trim());

  protected readonly title = this.data.decision === 'reject' ? 'رفض الطلب' : 'إرجاع الطلب للتعديل';
  protected readonly confirmText = this.data.decision === 'reject' ? 'تأكيد الرفض' : 'تأكيد الإرجاع';
  protected readonly intro =
    this.data.decision === 'reject'
      ? 'الرفض نهائي لهذا الإصدار؛ اذكر السبب ليفهمه مقدّم الطلب.'
      : 'سيُعاد الطلب إلى مقدّمه للتعديل ثم إعادة التقديم؛ اذكر المطلوب تعديله.';
}

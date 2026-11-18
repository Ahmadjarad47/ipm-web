import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { ltr } from './work-item-utils';

export interface TransitionDialogData {
  readonly ref: string;
  readonly fromName: string;
  readonly toName: string;
}

let nextId = 0;

/** Optional comment prompt before a status transition (FR-WF-05). Closes with the comment text. */
@Component({
  selector: 'app-transition-dialog',
  imports: [FormsModule, DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="تغيير الحالة" [subtitle]="ltr(data.ref) + ': ' + data.fromName + ' ← ' + data.toName">
      <div class="field">
        <label [attr.for]="uid + '-tr-comment'">تعليق (اختياري)</label>
        <textarea [id]="uid + '-tr-comment'" class="textarea" rows="3" [(ngModel)]="comment"></textarea>
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn btn--primary" (click)="ref.close(comment.trim())">تأكيد</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `:host { display: block; max-inline-size: calc(100vw - 32px); }`,
})
export class TransitionDialog {
  protected readonly uid = `transition${++nextId}`;
  protected readonly data = inject(DIALOG_DATA) as TransitionDialogData;
  protected readonly ref = inject(DialogRef<string>);
  protected comment = '';
  protected readonly ltr = ltr;
}

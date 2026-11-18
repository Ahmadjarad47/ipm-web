import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { ltr } from './work-item-utils';

export interface CloseReopenData {
  readonly mode: 'close' | 'reopen';
  readonly ref: string;
  /** Candidate target statuses; the choice is shown when there are several (or the server asked for one). */
  readonly choices: readonly { readonly id: string; readonly name: string }[];
  /** True when the server answered 400 "ambiguous target": the choice becomes mandatory. */
  readonly mustChoose: boolean;
  /** Text to prefill when the dialog reopens after the server asked for a target. */
  readonly initialComment?: string;
}

export interface CloseReopenResult {
  readonly comment: string;
  readonly toStatusId?: string;
}

let nextId = 0;

/** Close (optional comment) or reopen (mandatory reason) a work item; closes with the entered values. */
@Component({
  selector: 'app-close-reopen-dialog',
  imports: [ReactiveFormsModule, DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="data.mode === 'close' ? 'إغلاق العنصر' : 'إعادة فتح العنصر'" [subtitle]="ltr(data.ref)">
      <form [id]="uid + '-cr-form'" class="stack" [formGroup]="form" (ngSubmit)="submit()">
        @if (showChoice()) {
          <div class="field">
            <label [attr.for]="uid + '-cr-status'">الحالة المطلوبة <span class="req">*</span></label>
            <select [id]="uid + '-cr-status'" class="select" formControlName="toStatusId" [attr.aria-invalid]="choiceInvalid()">
              <option value="">— اختر —</option>
              @for (c of data.choices; track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select>
            @if (choiceInvalid()) {
              <span class="error" role="alert">اختر الحالة المطلوبة.</span>
            }
          </div>
        }
        <div class="field">
          <label [attr.for]="uid + '-cr-comment'">
            {{ data.mode === 'close' ? 'تعليق (اختياري)' : 'سبب إعادة الفتح' }}
            @if (data.mode === 'reopen') {
              <span class="req">*</span>
            }
          </label>
          <textarea [id]="uid + '-cr-comment'" class="textarea" rows="3" formControlName="comment" [attr.aria-invalid]="reasonInvalid()"></textarea>
          @if (reasonInvalid()) {
            <span class="error" role="alert">سبب إعادة الفتح مطلوب.</span>
          }
        </div>
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" [attr.form]="uid + '-cr-form'" class="btn btn--primary">{{ data.mode === 'close' ? 'إغلاق' : 'إعادة فتح' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `:host { display: block; max-inline-size: calc(100vw - 32px); }`,
})
export class CloseReopenDialog {
  protected readonly uid = `close${++nextId}`;
  protected readonly data = inject(DIALOG_DATA) as CloseReopenData;
  protected readonly ref = inject(DialogRef<CloseReopenResult>);
  protected readonly ltr = ltr;

  protected readonly form = new FormGroup({
    toStatusId: new FormControl('', { nonNullable: true }),
    comment: new FormControl(this.data.initialComment ?? '', { nonNullable: true, validators: this.data.mode === 'reopen' ? [Validators.required, Validators.pattern(/\S/)] : [] }),
  });
  private readonly submitted = signal(false);

  protected readonly showChoice = computed(() => this.data.mustChoose || this.data.choices.length > 1);
  protected readonly choiceInvalid = (): boolean => this.submitted() && this.showChoice() && !this.form.controls.toStatusId.value;
  protected readonly reasonInvalid = (): boolean => this.submitted() && this.form.controls.comment.invalid;

  protected submit(): void {
    this.submitted.set(true);
    const { toStatusId, comment } = this.form.getRawValue();
    if (this.form.controls.comment.invalid || (this.showChoice() && !toStatusId)) return;
    this.ref.close({ comment: comment.trim(), ...(toStatusId ? { toStatusId } : {}) } satisfies CloseReopenResult);
  }
}

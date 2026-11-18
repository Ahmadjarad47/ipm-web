import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { BulkSummary, bulkHeadline } from './approval-logic';

export interface BulkResultData {
  readonly summary: BulkSummary;
  /** id -> request title, for readable rows. */
  readonly titles: Readonly<Record<string, string>>;
}

/** Per-item outcome of a bulk approval: rejected items explain why. */
@Component({
  selector: 'app-bulk-result-dialog',
  imports: [DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="نتيجة الموافقة الجماعية" [subtitle]="headline">
      <div aria-live="polite">
      @if (data.summary.okIds.length) {
        <h3 class="sec">تمت الموافقة ({{ data.summary.okIds.length }})</h3>
        <ul class="list">
          @for (id of data.summary.okIds; track id) {
            <li class="ok">{{ data.titles[id] ?? id }}</li>
          }
        </ul>
      }
      @if (data.summary.failed.length) {
        <h3 class="sec">تعذّرت ({{ data.summary.failed.length }})</h3>
        <ul class="list">
          @for (f of data.summary.failed; track f.id) {
            <li class="bad">
              <strong>{{ data.titles[f.id] ?? f.id }}</strong>
              <span class="why">{{ f.message }}</span>
            </li>
          }
        </ul>
      }
      <p class="muted note">الرفض والإرجاع غير متاحين جماعيًا لأن التعليق إلزامي لكل طلب؛ افتح الطلب لاتخاذ هذا القرار.</p>
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--primary" (click)="ref.close()">إغلاق</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .sec { margin: var(--s-3) 0 var(--s-2); font-size: var(--fs-md); }
    .list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
    .list li { padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); display: flex; flex-direction: column; gap: 2px; }
    .ok { background: var(--c-success-bg); color: var(--c-success); }
    .bad { background: var(--c-danger-bg); color: var(--c-danger); }
    .why { font-size: var(--fs-sm); }
    .note { margin-block-start: var(--s-4); }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    .list li { overflow-wrap: anywhere; }
  `,
})
export class BulkResultDialog {
  protected readonly data = inject(DIALOG_DATA) as BulkResultData;
  protected readonly ref = inject(DialogRef<void>);
  protected readonly headline = bulkHeadline(this.data.summary);
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ToastService } from '@core/notifications/toast.service';
import { AUDIT_ACTION_LABELS, AuditEvent, FieldChange } from '@domain/activity/activity.models';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { AuditFormatter, idKindOf } from '@shared/util/audit-format';
import { DiffRow, diffValues, prettyValue, truncateMiddle } from './audit-diff';
import { SOURCE_LABELS, SUBJECT_TYPE_LABELS } from './audit-labels';

interface ChangeView {
  readonly label: string;
  readonly rows: readonly DiffRow[];
}

/** Read-only event details: side-by-side diff of every change and tamper-evidence metadata. No edit or delete (FR-AUD-04). */
@Component({
  selector: 'app-audit-event-dialog',
  imports: [DialogShell, AppDatePipe, UserNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="تفاصيل الحدث" [subtitle]="actionLabel">
      <dl class="kv">
        <dt>الوقت</dt><dd>{{ event.at | appDate: true }}</dd>
        <dt>المنفّذ</dt><dd>{{ event.actorId | userName }}</dd>
        <dt>الموضوع</dt><dd>{{ event.subjectLabel }} ({{ subjectType }})</dd>
        <dt>المصدر</dt><dd>{{ source }}</dd>
        <dt>معرّف الارتباط</dt>
        <dd class="copyable">
          <span class="ltr muted code">{{ event.correlationId }}</span>
          <button type="button" class="btn btn--ghost btn--sm" (click)="copy(event.correlationId, 'معرّف الارتباط')">نسخ</button>
        </dd>
        <dt>البصمة (Hash)</dt>
        <dd class="copyable">
          <span class="ltr muted code" [title]="event.hash">{{ short(event.hash) }}</span>
          <button type="button" class="btn btn--ghost btn--sm" (click)="copy(event.hash, 'البصمة')">نسخ</button>
        </dd>
        <dt>بصمة الحدث السابق</dt>
        <dd class="copyable">
          @if (event.prevHash) {
            <span class="ltr muted code" [title]="event.prevHash">{{ short(event.prevHash) }}</span>
            <button type="button" class="btn btn--ghost btn--sm" (click)="copy(event.prevHash, 'بصمة الحدث السابق')">نسخ</button>
          } @else {
            <span class="muted">— (أول حدث في السلسلة)</span>
          }
        </dd>
      </dl>

      <h3 class="section-title">التغييرات</h3>
      @for (c of changes(); track $index) {
        <section class="change" [attr.aria-label]="c.label">
          <h4 class="field">{{ c.label }}</h4>
          <div class="diff" role="table" [attr.aria-label]="'مقارنة ' + c.label">
            <div class="diff-head" role="row"><span role="columnheader">قبل</span><span role="columnheader">بعد</span></div>
            @for (r of c.rows; track $index) {
              <div class="diff-row" role="row">
                <pre role="cell" class="cell" [class.cell--del]="r.kind === 'removed' || r.kind === 'changed'" [class.cell--empty]="r.left === null">{{ r.left ?? '' }}</pre>
                <pre role="cell" class="cell" [class.cell--add]="r.kind === 'added' || r.kind === 'changed'" [class.cell--empty]="r.right === null">{{ r.right ?? '' }}</pre>
              </div>
            } @empty {
              <p class="muted pad">لا قيمة قبل أو بعد.</p>
            }
          </div>
        </section>
      } @empty {
        <p class="muted">لا توجد تغييرات حقول مسجّلة.</p>
      }

      <h3 class="section-title">البيانات الخام</h3>
      <pre class="raw ltr">{{ raw }}</pre>

      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إغلاق</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .section-title { margin: var(--s-4) 0 var(--s-2); }
    .copyable { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
    .code { font-size: var(--fs-xs); overflow-wrap: anywhere; }
    .field { margin: var(--s-3) 0 var(--s-1); font-size: var(--fs-sm); }
    .diff { border: 1px solid var(--c-border); border-radius: var(--r-sm); overflow: hidden; }
    .diff-head, .diff-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .diff-head { background: var(--c-surface-2); font-size: var(--fs-xs); font-weight: 600; color: var(--c-muted); }
    .diff-head span { padding: var(--s-1) var(--s-2); }
    .cell { margin: 0; padding: var(--s-1) var(--s-2); font: inherit; font-size: var(--fs-sm); white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.6em; border-top: 1px solid var(--c-border); }
    .cell:first-child { border-inline-end: 1px solid var(--c-border); }
    .cell--del { background: var(--c-danger-bg); color: var(--c-danger); }
    .cell--add { background: var(--c-success-bg); color: var(--c-success); }
    .cell--empty { background: var(--c-surface-2); }
    .pad { padding: var(--s-2); margin: 0; }
    .raw { max-height: 200px; overflow: auto; margin: 0; padding: var(--s-3); border-radius: 8px; background: var(--c-surface-2); font-size: var(--fs-xs); white-space: pre-wrap; }
  `,
})
export class AuditEventDialog {
  protected readonly event = inject(DIALOG_DATA) as AuditEvent;
  protected readonly ref = inject(DialogRef);
  private readonly toast = inject(ToastService);
  private readonly format = inject(AuditFormatter);

  protected readonly actionLabel = AUDIT_ACTION_LABELS[this.event.action] ?? this.event.action;
  protected readonly subjectType = SUBJECT_TYPE_LABELS[this.event.subjectType];
  protected readonly source = SOURCE_LABELS[this.event.source] ?? this.event.source;
  protected readonly raw = JSON.stringify(this.event, null, 2);

  protected readonly changes = computed<readonly ChangeView[]>(() =>
    this.event.changes.map((c) => ({ label: this.format.field(c.field), rows: diffValues(this.side(c, 'from'), this.side(c, 'to')) })),
  );

  /** Ids become names; JSON stays raw so the diff can pretty-print it. */
  private side(c: FieldChange, side: 'from' | 'to'): string | null {
    const raw = c[side];
    if (raw === null || prettyValue(raw) !== raw || !idKindOf(c.field)) return raw;
    return this.format.value(c, side);
  }

  protected short(hash: string): string {
    return truncateMiddle(hash);
  }

  protected copy(text: string, what: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.toast.success(`تم نسخ ${what}`),
      () => this.toast.error('تعذّر النسخ'),
    );
  }
}

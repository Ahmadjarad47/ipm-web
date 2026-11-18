import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { AuditApi } from '@domain/activity/activity.api';
import { AUDIT_ACTION_LABELS, AuditEvent } from '@domain/activity/activity.models';
import { PagedResult } from '@core/models/entity.model';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { DIALOG_DATA } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';

export interface TypeHistoryData {
  readonly typeId: string;
  readonly typeName: string;
}

/** Read-only change history of one work item type (FR-TYP-10): who changed what, and when. */
@Component({
  selector: 'app-type-history-dialog',
  imports: [DialogShell, AppDatePipe, UserNamePipe, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .ev { padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface-2); }
    .ev header { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); align-items: baseline; margin-bottom: var(--s-2); }
    .when { color: var(--c-muted); font-size: var(--fs-xs); }
    table { inline-size: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    th, td { padding: var(--s-1) var(--s-2); text-align: start; border-block-end: 1px solid var(--c-border); vertical-align: top; }
    th { font-size: var(--fs-xs); color: var(--c-muted); font-weight: 600; }
    td.v { overflow-wrap: anywhere; }
    .none { color: var(--c-muted); }
  `,
  template: `
    <app-dialog-shell [title]="'سجل التعديلات: ' + data.typeName" subtitle="للقراءة فقط. تُعرض آخر 50 حدثًا من الأحدث إلى الأقدم.">
      @if (history.isLoading()) {
        <app-skeleton variant="lines" [count]="5" />
      } @else if (history.error()) {
        <app-error-state title="تعذّر تحميل السجل" text="قد يتطلب عرض السجل صلاحية «عرض سجل التدقيق»." (retry)="history.reload()" />
      } @else if (!events().length) {
        <app-empty-state icon="history" title="لا توجد تعديلات مسجلة" text="لم يُسجَّل أي تعديل على هذا النوع بعد." />
      } @else {
        <div class="stack">
          @for (e of events(); track e.id) {
            <article class="ev">
              <header>
                <strong>{{ e.actorId | userName }}</strong>
                <span>{{ label(e) }}</span>
                <time class="when" [attr.datetime]="e.at">{{ e.at | appDate: true }}</time>
              </header>
              @if (e.changes.length) {
                <div class="scroll-x"><table>
                  <caption class="sr-only">التغييرات في هذا الحدث</caption>
                  <thead><tr><th scope="col">الحقل</th><th scope="col">من</th><th scope="col">إلى</th></tr></thead>
                  <tbody>
                    @for (c of e.changes; track c.field) {
                      <tr>
                        <th scope="row">{{ c.field }}</th>
                        <td class="v">{{ c.from ?? '—' }}</td>
                        <td class="v">{{ c.to ?? '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table></div>
              } @else {
                <span class="none">لا توجد تفاصيل حقول لهذا الحدث.</span>
              }
            </article>
          }
        </div>
      }
    </app-dialog-shell>
  `,
})
export class TypeHistoryDialog {
  protected readonly data = inject(DIALOG_DATA) as TypeHistoryData;
  private readonly api = inject(AuditApi);

  protected readonly history = rxResource<PagedResult<AuditEvent>, string>({
    params: () => this.data.typeId,
    stream: ({ params }) => this.api.list({ page: 1, pageSize: 50, filters: { subjectId: params } }),
  });

  protected events(): readonly AuditEvent[] {
    return this.history.hasValue() ? this.history.value().items : [];
  }

  protected label(event: AuditEvent): string {
    return AUDIT_ACTION_LABELS[event.action] ?? event.action;
  }
}

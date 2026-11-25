import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ToastService } from '@core/notifications/toast.service';
import { StatusesApi, StatusLookup } from '@domain/workflow/workflow.api';
import { Status, STATUS_CATEGORY_LABELS, StatusScope } from '@domain/workflow/workflow.models';
import { HELP } from '@shared/help/help-texts';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { Badge } from '@shared/ui/badge/badge';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { Icon } from '@shared/ui/icon/icon';
import { ActiveToggle } from '../shared/active-toggle';
import { AdminNotice } from '../shared/admin-notice';
import { errorEntries, isConflict } from '../shared/api-errors';
import { ImpactPrompt } from '../shared/impact-dialog';
import { SCOPE_LABELS, StatusFormData, StatusFormDialog } from './status-form-dialog';

interface StatusGroup {
  readonly scope: StatusScope;
  readonly title: string;
  readonly rows: readonly Status[];
}

@Component({
  selector: 'app-statuses-tab',
  imports: [Badge, Icon, ActiveToggle, AdminNotice, HelpTip, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/admin-table.scss',
  template: `
    <div class="stack">
      <app-admin-notice>الحالات لا تُحذف نهائيًا؛ عطّل الحالة التي لم تعد مستخدمة. تغيير الاسم أو اللون لا يؤثر على التقارير لأنها تعتمد على فئة الحالة.</app-admin-notice>
      @if (lookup.error()) {
        <app-error-state title="تعذّر تحميل الحالات" (retry)="lookup.reload()" />
      } @else if (lookup.loading() && !lookup.items().length) {
        <app-skeleton variant="table" [count]="5" />
      }
      @for (g of groups(); track g.scope) {
        <section class="card" [attr.aria-labelledby]="'grp-' + g.scope">
          <div class="card-body row">
            <h2 class="section-title" [id]="'grp-' + g.scope">{{ g.title }}</h2>
            <span class="spacer"></span>
            <button type="button" class="btn btn--outline btn--sm" (click)="open(null, g.scope)"><app-icon name="plus" [size]="14" /> حالة جديدة</button>
          </div>
          <div class="scroll">
            <table class="atable">
              <caption class="sr-only">{{ g.title }}</caption>
              <thead>
                <tr>
                  <th scope="col">الحالة</th>
                  <th scope="col">المفتاح</th>
                  <th scope="col">فئة الحالة <app-help-tip [text]="categoryHelp" /></th>
                  <th scope="col" class="num">الترتيب</th>
                  <th scope="col" class="num">نشطة</th>
                  <th scope="col"><span class="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody>
                @for (s of g.rows; track s.id) {
                  <tr>
                    <td><div class="cell-name" [style.--sw]="s.color"><span class="dot"></span>{{ s.name }}</div></td>
                    <td><span class="ltr">{{ s.key }}</span></td>
                    <td><app-badge tone="neutral">{{ categoryLabels[s.category] }}</app-badge></td>
                    <td class="num">{{ s.order }}</td>
                    <td class="num"><app-active-toggle [checked]="s.active" [label]="'تفعيل ' + s.name" (toggled)="setActive(s, $event)" /></td>
                    <td class="actions">
                      <button type="button" class="btn btn--ghost btn--sm" (click)="open(s, s.scope)" [attr.aria-label]="'تعديل ' + s.name"><app-icon name="edit" [size]="15" /> تعديل</button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="muted">لا توجد حالات في هذه المجموعة. <button type="button" class="btn btn--outline btn--sm" (click)="open(null, g.scope)"><app-icon name="plus" [size]="14" /> حالة جديدة</button></td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
  `,
})
export class StatusesTab {
  protected readonly lookup = inject(StatusLookup);
  private readonly impact = inject(ImpactPrompt);
  protected readonly categoryHelp = HELP.statusCategory;
  private readonly api = inject(StatusesApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly categoryLabels = STATUS_CATEGORY_LABELS;

  protected readonly groups = computed<readonly StatusGroup[]>(() =>
    (['project', 'work-item'] as const).map((scope) => ({
      scope,
      title: SCOPE_LABELS[scope],
      rows: this.lookup
        .items()
        .filter((s) => s.scope === scope)
        .sort((a, b) => a.order - b.order),
    })),
  );

  protected open(status: Status | null, scope: StatusScope): void {
    this.dialog.open<StatusFormDialog, StatusFormData, Status>(StatusFormDialog, {
      data: { status, scope },
      width: 'min(620px, calc(100vw - 32px))',
    });
  }

  protected setActive(status: Status, active: boolean): void {
    if (active) {
      this.persist(status, true);
      return;
    }
    // FR-WF-06: preview who is affected before a status is switched off.
    this.impact
      .confirm({
        title: 'تعطيل الحالة',
        intro: `سيتم تعطيل «${status.name}»؛ لن تظهر عند إضافتها إلى مسارات جديدة، وتبقى الأعمال الموجودة فيها كما هي.`,
        kind: 'status',
        load: this.api.impact(status.id),
        guidance: 'الحالة الابتدائية لمسار عمل لا يمكن تعطيلها؛ غيّر الحالة الابتدائية للمسار أولًا.',
        confirmText: 'تعطيل الحالة',
      })
      .subscribe((ok) => (ok ? this.persist(status, false) : this.lookup.reload()));
  }

  private persist(status: Status, active: boolean): void {
    this.api.update(status.id, { active, version: status.version }).subscribe({
      next: () => {
        this.toast.success(active ? 'تم تفعيل الحالة' : 'تم تعطيل الحالة');
        this.lookup.reload();
      },
      error: (e: unknown) => {
        if (isConflict(e)) {
          this.impact.conflicts({
            title: 'تعذّر تعطيل الحالة',
            intro: 'الحالة هي الحالة الابتدائية للمسارات التالية.',
            entries: errorEntries(e),
            guidance: 'افتح تبويب «سير العمل» وغيّر الحالة الابتدائية لهذه المسارات، ثم أعد المحاولة.',
          });
        }
        this.lookup.reload();
      },
    });
  }
}

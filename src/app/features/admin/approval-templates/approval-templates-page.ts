import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { ApprovalTemplatesApi } from '@domain/approvals/approval.api';
import { APPROVAL_EVENT_LABELS, ApprovalTemplate } from '@domain/approvals/approval.models';
import { Badge } from '@shared/ui/badge/badge';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { ActiveToggle } from '../shared/active-toggle';
import { AdminNotice } from '../shared/admin-notice';
import { TemplateFormData, TemplateFormDialog } from './template-form-dialog';

@Component({
  selector: 'app-approval-templates-page',
  imports: [PageHeader, Icon, Badge, EmptyState, ErrorState, Skeleton, ActiveToggle, AdminNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/admin-table.scss',
  template: `
    <app-page-header title="قوالب الموافقات" subtitle="حدّد مراحل الموافقة لكل حدث ومن يعتمدها.">
      <button type="button" class="btn btn--primary" [disabled]="!canManage()" (click)="open(null)">
        <app-icon name="plus" [size]="16" /> قالب جديد
      </button>
    </app-page-header>

    <div class="stack">
      <app-admin-notice>تغيير القالب يسري على الطلبات الجديدة فقط ولا يؤثر على الطلبات الجارية (§4.3).</app-admin-notice>
      <section class="card" aria-label="قوالب الموافقات">
        @if (templates.isLoading()) {
          <app-skeleton variant="table" [count]="4" />
        } @else if (templates.error()) {
          <app-error-state title="تعذّر تحميل القوالب" (retry)="templates.reload()" />
        } @else if (!templates.value().length) {
          <app-empty-state icon="checkCircle" title="لا توجد قوالب" text="أنشئ قالب موافقة لحدث معيّن." />
        } @else {
          <div class="scroll">
            <table class="atable">
              <caption class="sr-only">قوالب الموافقات</caption>
              <thead>
                <tr>
                  <th scope="col">القالب</th>
                  <th scope="col">الحدث</th>
                  <th scope="col" class="num">المراحل</th>
                  <th scope="col" class="num">نشط</th>
                  <th scope="col"><span class="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody>
                @for (t of templates.value(); track t.id) {
                  <tr>
                    <td><strong>{{ t.name }}</strong></td>
                    <td><app-badge tone="emerald">{{ eventLabels[t.event] }}</app-badge></td>
                    <td class="num">{{ t.stages.length }}</td>
                    <td class="num"><app-active-toggle [checked]="t.active" [disabled]="!canManage()" [label]="'تفعيل ' + t.name" (toggled)="setActive(t, $event)" /></td>
                    <td class="actions">
                      <button type="button" class="btn btn--ghost btn--sm" [disabled]="!canManage()" (click)="open(t)" [attr.aria-label]="'تعديل ' + t.name"><app-icon name="edit" [size]="15" /> تعديل</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
})
export class ApprovalTemplatesPage {
  private readonly api = inject(ApprovalTemplatesApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly eventLabels = APPROVAL_EVENT_LABELS;
  protected readonly canManage = computed(() => this.auth.can('approvals.configure'));

  protected readonly templates = rxResource<readonly ApprovalTemplate[], true>({
    params: () => true,
    stream: () => this.api.all(),
    defaultValue: [],
  });

  protected open(template: ApprovalTemplate | null): void {
    this.dialog
      .open<TemplateFormDialog, TemplateFormData, ApprovalTemplate>(TemplateFormDialog, {
        data: { template },
        width: 'min(820px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe(() => {
        this.templates.reload();
      });
  }

  protected setActive(template: ApprovalTemplate, active: boolean): void {
    this.api.update(template.id, { active, version: template.version }).subscribe({
      next: () => {
        this.toast.success(active ? 'تم تفعيل القالب' : 'تم تعطيل القالب');
        this.templates.reload();
      },
      error: () => this.templates.reload(),
    });
  }
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectTemplate, ProjectTemplateLookup, ProjectTemplatesApi } from '@domain/projects/project-template';
import { RoleLookup } from '@domain/users/user.api';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { TypeChip } from '@shared/domain-ui/domain-ui';
import { Badge } from '@shared/ui/badge/badge';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { ActiveToggle } from '../shared/active-toggle';
import { AdminNotice } from '../shared/admin-notice';
import { TemplateDialog, TemplateDialogData } from './template-dialog';

/** Project templates (FR-PRJ-10): presets used once at project creation. Deactivate, never delete. */
@Component({
  selector: 'app-project-templates-page',
  imports: [PageHeader, Icon, Badge, EmptyState, ErrorState, Skeleton, ActiveToggle, AdminNotice, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap: var(--s-4); }
    .card.off { opacity: 0.7; }
    .head { display: flex; align-items: flex-start; gap: var(--s-3); }
    .head h2 { font-size: var(--fs-lg); margin: 0; }
    .head > div { flex: 1; min-inline-size: 0; }
    dl { display: grid; grid-template-columns: 110px 1fr; gap: var(--s-2) var(--s-3); margin: 0; font-size: var(--fs-sm); }
    dt { color: var(--c-muted); }
    dd { margin: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  `,
  template: `
    <app-page-header title="قوالب المشاريع" subtitle="إعدادات مسبقة تُطبَّق مرة واحدة عند إنشاء مشروع جديد (FR-PRJ-10).">
      <button type="button" class="btn btn--primary" [disabled]="!canManage()" (click)="open(null)">
        <app-icon name="plus" [size]="16" /> قالب جديد
      </button>
    </app-page-header>

    <div class="stack">
      <app-admin-notice>تعديل القالب لا يغيّر المشاريع المنشأة منه سابقًا. لا يمكن حذف القوالب؛ عطّلها لإخفائها من إنشاء المشاريع.</app-admin-notice>
      @if (templates.isLoading() && !templates.hasValue()) {
        <app-skeleton variant="card" [count]="3" />
      } @else if (templates.error()) {
        <section class="card"><app-error-state title="تعذّر تحميل قوالب المشاريع" (retry)="templates.reload()" /></section>
      } @else if (!items().length) {
        <section class="card">
          <app-empty-state icon="folder" title="لا توجد قوالب" text="أنشئ قالبًا لتسريع إنشاء المشاريع." actionLabel="قالب جديد" (action)="open(null)" />
        </section>
      } @else {
        <div class="grid">
          @for (t of items(); track t.id) {
            <article class="card" [class.off]="!t.active" [attr.aria-label]="t.name">
              <div class="card-body stack">
                <div class="head">
                  <div>
                    <h2>{{ t.name }}</h2>
                    <p class="muted">{{ t.description || 'بدون وصف' }}</p>
                  </div>
                  <app-active-toggle [checked]="t.active" [disabled]="!canManage()" [label]="'تفعيل ' + t.name" (toggled)="setActive(t, $event)" />
                </div>
                <dl>
                  <dt>الأنواع المسموحة</dt>
                  <dd>@for (id of t.allowedTypeIds; track id) { <app-type-chip [typeId]="id" /> }</dd>
                  <dt>النوع الافتراضي</dt>
                  <dd><app-type-chip [typeId]="t.defaultTypeId" /></dd>
                  <dt>الحالة الابتدائية</dt>
                  <dd>{{ statuses.get(t.initialStatusId)?.name ?? '—' }}</dd>
                  <dt>الأعضاء المقترحون</dt>
                  <dd>
                    @if (t.suggestedMembers?.length) { <span>{{ t.suggestedMembers!.length }} عضوًا مقترحًا</span> } @else { <span class="muted">—</span> }
                  </dd>
                  <dt>الأدوار المقترحة</dt>
                  <dd>
                    @for (id of t.suggestedRoleIds; track id) { <app-badge tone="emerald">{{ roles.get(id)?.name ?? id }}</app-badge> } @empty { <span class="muted">—</span> }
                  </dd>
                  <dt>المدة</dt>
                  <dd>{{ t.durationDays }} يومًا</dd>
                </dl>
                <div class="row">
                  <span class="spacer"></span>
                  <button type="button" class="btn btn--ghost btn--sm" [disabled]="!canManage()" (click)="open(t)" [attr.aria-label]="'تعديل ' + t.name"><app-icon name="edit" [size]="15" /> تعديل</button>
                </div>
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class ProjectTemplatesPage {
  protected readonly lookup = inject(ProjectTemplateLookup);
  protected readonly statuses = inject(StatusLookup);
  protected readonly roles = inject(RoleLookup);
  private readonly api = inject(ProjectTemplatesApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly canManage = computed(() => this.auth.can('settings.manage'));

  protected readonly templates = rxResource<readonly ProjectTemplate[], true>({
    params: () => true,
    stream: () => this.api.all(),
  });
  protected readonly items = computed(() => (this.templates.hasValue() ? this.templates.value() : []));

  private refresh(): void {
    this.templates.reload();
    this.lookup.reload();
  }

  protected open(template: ProjectTemplate | null): void {
    this.dialog
      .open<TemplateDialog, TemplateDialogData, ProjectTemplate>(TemplateDialog, {
        data: { template },
        width: 'min(640px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe(() => this.refresh());
  }

  protected setActive(template: ProjectTemplate, active: boolean): void {
    this.api.update(template.id, { active, version: template.version }).subscribe({
      next: () => {
        this.toast.success(active ? 'تم تفعيل القالب' : 'تم تعطيل القالب');
        this.refresh();
      },
      error: () => this.refresh(),
    });
  }
}

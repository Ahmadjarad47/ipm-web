import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { WorkItemTypeLookup, WorkItemTypesApi } from '@domain/work-items/work-item.api';
import { WorkItemType } from '@domain/work-items/work-item.models';
import { WorkflowLookup } from '@domain/workflow/workflow.api';
import { TypeChip } from '@shared/domain-ui/domain-ui';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { ActiveToggle } from '../shared/active-toggle';
import { AdminNotice } from '../shared/admin-notice';
import { errorEntries, isConflict } from '../shared/api-errors';
import { ImpactPrompt } from '../shared/impact-dialog';
import { HasUnsavedChanges, warnBeforeUnload } from '../shared/unsaved-changes';
import { HierarchyTab } from './hierarchy-tab';
import { RelationTypesSection } from './relation-types-section';
import { TypeFormData, TypeFormDialog } from './type-form-dialog';

type TypesTab = 'types' | 'hierarchy' | 'relations';

@Component({
  selector: 'app-types-page',
  imports: [PageHeader, Icon, TypeChip, EmptyState, ErrorState, Skeleton, Tabs, ActiveToggle, AdminNotice, RelationTypesSection, HierarchyTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onUnload($event)' },
  styleUrl: '../shared/admin-table.scss',
  template: `
    <app-page-header title="أنواع العناصر" subtitle="عرّف أنواع عناصر العمل وحقولها الإضافية وسير عملها دون تعديل الكود.">
      <button type="button" class="btn btn--primary" [disabled]="!canManage()" (click)="open(null)">
        <app-icon name="plus" [size]="16" /> نوع جديد
      </button>
    </app-page-header>

    <app-tabs [tabs]="tabItems()" [(active)]="tab" />

    <div class="stack panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
      @switch (tab()) {
        @case ('types') {
          <app-admin-notice>الأنواع لا تُحذف بل تُعطَّل (FR-TYP-09)؛ المفتاح الداخلي ثابت، وتغيير الاسم لا يُعيد كتابة السجل التاريخي.</app-admin-notice>

          <section class="card" aria-label="قائمة أنواع العناصر">
            @if (types.isLoading() && !types.hasValue()) {
              <app-skeleton variant="table" [count]="5" />
            } @else if (types.error()) {
              <app-error-state title="تعذّر تحميل أنواع العناصر" (retry)="types.reload()" />
            } @else if (!sorted().length) {
              <app-empty-state icon="layers" title="لا توجد أنواع بعد" text="أنشئ أول نوع عنصر." actionLabel="نوع جديد" (action)="open(null)" />
            } @else {
              <div class="scroll">
                <table class="atable">
                  <caption class="sr-only">أنواع العناصر</caption>
                  <thead>
                    <tr>
                      <th scope="col">النوع</th>
                      <th scope="col">المفتاح</th>
                      <th scope="col">سير العمل</th>
                      <th scope="col" class="num">الحقول</th>
                      <th scope="col">الأبناء المسموحون</th>
                      <th scope="col" class="num">نشط</th>
                      <th scope="col"><span class="sr-only">إجراءات</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (t of sorted(); track t.id) {
                      <tr>
                        <td>
                          <div class="cell-name" [style.--sw]="t.color">
                            <span class="swatch"><app-icon [name]="t.icon" [size]="17" /></span>
                            <span>{{ t.name }}</span>
                          </div>
                        </td>
                        <td><span class="ltr">{{ t.key }}</span></td>
                        <td>{{ workflows.get(t.workflowId)?.name ?? '—' }}</td>
                        <td class="num">{{ t.fields.length }}</td>
                        <td>
                          <div class="chips">
                            @for (id of t.allowedChildTypeIds; track id) {
                              <app-type-chip [typeId]="id" />
                            } @empty {
                              <span class="muted">—</span>
                            }
                          </div>
                        </td>
                        <td class="num">
                          <app-active-toggle [checked]="t.active" [disabled]="!canManage()" [label]="'تفعيل ' + t.name" (toggled)="setActive(t, $event)" />
                        </td>
                        <td class="actions">
                          <button type="button" class="btn btn--ghost btn--sm" [disabled]="!canManage()" (click)="open(t)" [attr.aria-label]="'تعديل ' + t.name">
                            <app-icon name="edit" [size]="15" /> تعديل
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
        @case ('relations') {
          <app-relation-types-section />
        }
      }
      <!-- Kept alive (hidden) so an unsaved matrix survives a tab switch; the route guard covers leaving the page. -->
      <div [hidden]="tab() !== 'hierarchy'"><app-hierarchy-tab (createType)="open(null)" /></div>
    </div>
  `,
  styles: `.panel { padding-top: var(--s-5); }`,
})
export class TypesPage implements HasUnsavedChanges {
  private readonly api = inject(WorkItemTypesApi);
  private readonly lookup = inject(WorkItemTypeLookup);
  private readonly dialog = inject(DialogService);
  private readonly impact = inject(ImpactPrompt);
  private readonly toast = inject(ToastService);
  protected readonly workflows = inject(WorkflowLookup);

  private readonly auth = inject(AuthService);
  protected readonly canManage = computed(() => this.auth.can('workitem.types.manage'));

  protected readonly tab = signal<TypesTab>('types');
  protected readonly tabItems = computed<readonly TabItem<TypesTab>[]>(() => [
    { key: 'types', label: 'الأنواع', count: this.types.hasValue() ? this.types.value().length : null },
    { key: 'hierarchy', label: 'قواعد التسلسل الهرمي' },
    { key: 'relations', label: 'أنواع الروابط' },
  ]);

  private readonly hierarchy = viewChild(HierarchyTab);

  protected readonly types = rxResource<readonly WorkItemType[], true>({
    params: () => true,
    stream: () => this.api.all(),
  });

  protected readonly sorted = computed(() => (this.types.hasValue() ? [...this.types.value()].sort((a, b) => a.order - b.order) : []));

  hasUnsavedChanges(): boolean {
    return this.hierarchy()?.dirty() ?? false;
  }

  protected onUnload(event: BeforeUnloadEvent): void {
    warnBeforeUnload(event, this.hasUnsavedChanges());
  }

  protected open(type: WorkItemType | null): void {
    this.dialog
      .open<TypeFormDialog, TypeFormData, WorkItemType>(TypeFormDialog, { data: { type }, width: 'min(860px, calc(100vw - 32px))' })
      .afterClosed.subscribe(() => {
        this.types.reload();
      });
  }

  protected setActive(type: WorkItemType, active: boolean): void {
    if (active) {
      this.persist(type, true);
      return;
    }
    // FR-TYP-09: show who is affected before switching a type off.
    this.impact
      .confirm({
        title: 'تعطيل نوع العنصر',
        intro: `سيتم تعطيل «${type.name}»؛ لن يمكن إنشاء عناصر جديدة منه، وتبقى العناصر القائمة كما هي.`,
        kind: 'type',
        load: this.api.impact(type.id),
        guidance: 'النوع الافتراضي في مشروع لا يمكن تعطيله؛ غيّر الافتراضي في تلك المشاريع أولًا.',
        confirmText: 'تعطيل النوع',
      })
      .subscribe((ok) => (ok ? this.persist(type, false) : this.types.reload()));
  }

  private persist(type: WorkItemType, active: boolean): void {
    this.api.update(type.id, { active, version: type.version }).subscribe({
      next: () => {
        this.toast.success(active ? 'تم تفعيل النوع' : 'تم تعطيل النوع');
        this.types.reload();
        this.lookup.reload();
      },
      error: (e: unknown) => {
        if (isConflict(e)) {
          this.impact.conflicts({
            title: 'تعذّر تعطيل النوع',
            intro: 'النوع مستخدم كنوع افتراضي في المشاريع التالية (رمز المشروع: اسمه).',
            entries: errorEntries(e),
            guidance: 'غيّر النوع الافتراضي لهذه المشاريع من إعدادات كل مشروع، ثم أعد المحاولة.',
          });
        }
        this.types.reload();
      },
    });
  }
}

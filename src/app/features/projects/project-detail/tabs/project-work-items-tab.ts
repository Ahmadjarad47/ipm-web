import { ChangeDetectionStrategy, Component, computed, inject, input, signal, TemplateRef, viewChild } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { Router } from '@angular/router';
import { CanDirective } from '@core/auth/can.directive';
import { emptyPage, PagedResult } from '@core/models/entity.model';
import { ProjectSummary } from '@domain/projects/project.models';
import { WorkItemsApi } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { PriorityBadge, StatusBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { AppDatePipe, UserNamesPipe } from '@shared/pipes/pipes';
import { AvatarStack } from '@shared/ui/avatar/avatar';
import { DataTable } from '@shared/ui/data-table/data-table';
import { CellContext, ColumnDef } from '@shared/ui/data-table/data-table.models';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';

interface TreeNode {
  readonly item: WorkItem;
  readonly depth: number;
}

const TREE_LIMIT = 100;
const PAGE_SIZE = 10;

@Component({
  selector: 'app-project-work-items-tab',
  imports: [CanDirective, DataTable, Icon, EmptyState, ErrorState, TypeChip, StatusBadge, PriorityBadge, AvatarStack, AppDatePipe, UserNamesPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row bar">
      <button type="button" class="btn btn--outline btn--sm" [attr.aria-pressed]="tree()" (click)="toggleTree()">
        <app-icon name="tree" [size]="16" /> {{ tree() ? 'عرض جدول' : 'شجرة' }}
      </button>
      <span class="spacer"></span>
      @if (!project().archived) {
        <button *appCan="'tasks.create'; project: project().id" type="button" class="btn btn--primary btn--sm" (click)="create()">
          <app-icon name="plus" [size]="16" /> إنشاء عمل
        </button>
      }
    </div>

    @if (list.error()) {
      <app-error-state title="تعذّر تحميل الأعمال" (retry)="list.reload()" />
    } @else if (tree()) {
      @if (nodes().length) {
        <ul class="tree" role="tree" aria-label="شجرة الأعمال">
          @for (n of nodes(); track n.item.id) {
            <li role="treeitem" [style.padding-inline-start.px]="n.depth * 24" (click)="open(n.item)" (keydown.enter)="open(n.item)" tabindex="0">
              <app-type-chip [typeId]="n.item.typeId" [iconOnly]="true" />
              <span class="ltr ref">{{ n.item.ref }}</span>
              <span class="title">{{ n.item.title }}</span>
              <span class="spacer"></span>
              <app-status-badge [statusId]="n.item.statusId" />
            </li>
          }
        </ul>
        @if (list.value().total > nodes().length) {
          <p class="muted note">تُعرض أول {{ nodes().length }} من أصل {{ list.value().total }} من الأعمال.</p>
        }
      } @else if (!list.isLoading()) {
        <app-empty-state icon="list" title="لا توجد أعمال" />
      }
    } @else {
      <app-data-table
        caption="أعمال المشروع"
        emptyTitle="لا توجد أعمال"
        emptyText="لم تُضف أعمال إلى هذا المشروع بعد."
        [rows]="list.value().items"
        [columns]="columns()"
        [loading]="list.isLoading()"
        [total]="list.value().total"
        [page]="page()"
        [pageSize]="10"
        (pageChange)="page.set($event)"
        (rowClick)="open($event)"
      />
    }

    <ng-template #refTpl let-w><span class="ltr ref">{{ w.ref }}</span></ng-template>
    <ng-template #typeTpl let-w><app-type-chip [typeId]="w.typeId" /></ng-template>
    <ng-template #statusTpl let-w><app-status-badge [statusId]="w.statusId" /></ng-template>
    <ng-template #priorityTpl let-w><app-priority-badge [priority]="w.priority" /></ng-template>
    <ng-template #assigneesTpl let-w><app-avatar-stack [names]="w.assigneeIds | userNames" /></ng-template>
    <ng-template #dueTpl let-w>{{ w.dueDate | appDate }}</ng-template>
  `,
  styles: `
    .bar { margin-bottom: var(--s-3); }
    .ref { font-weight: 600; color: var(--c-emerald-700); }
    .tree { list-style: none; margin: 0; padding: 0; border: 1px solid var(--c-border); border-radius: var(--r-md); }
    .tree li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--c-border); cursor: pointer; }
    .tree li:last-child { border-bottom: 0; }
    .tree li:hover, .tree li:focus-visible { background: var(--c-emerald-50); }
    .note { margin-top: var(--s-3); font-size: var(--fs-sm); }
    .bar { flex-wrap: wrap; }
    .tree li { flex-wrap: wrap; }
    .title { min-inline-size: 0; overflow-wrap: anywhere; }
    .ref { overflow-wrap: anywhere; }
    @media (max-width: 768px) { .tree li .spacer { display: none; } }
    @media (pointer: coarse), (max-width: 768px) { .tree li { min-block-size: 44px; } }
  `,
})
export class ProjectWorkItemsTab {
  readonly project = input.required<ProjectSummary>();

  private readonly api = inject(WorkItemsApi);
  private readonly router = inject(Router);

  protected readonly page = signal(1);
  protected readonly tree = signal(false);

  protected readonly list = rxResource<PagedResult<WorkItem>, { projectId: string; page: number; tree: boolean }>({
    params: () => ({ projectId: this.project().id, page: this.page(), tree: this.tree() }),
    stream: ({ params }) =>
      this.api.list({
        page: params.tree ? 1 : params.page,
        pageSize: params.tree ? TREE_LIMIT : PAGE_SIZE,
        filters: { projectId: params.projectId },
      }),
    defaultValue: emptyPage<WorkItem>(),
  });

  /** Hierarchy built from `parentId`; items whose parent is not in the loaded set become roots. */
  protected readonly nodes = computed<readonly TreeNode[]>(() => {
    if (!this.tree()) return [];
    const items = this.list.value().items;
    const ids = new Set(items.map((i) => i.id));
    const children = new Map<string | null, WorkItem[]>();
    for (const item of items) {
      const key = item.parentId && ids.has(item.parentId) ? item.parentId : null;
      children.set(key, [...(children.get(key) ?? []), item]);
    }
    const out: TreeNode[] = [];
    const walk = (parent: string | null, depth: number): void => {
      for (const item of children.get(parent) ?? []) {
        out.push({ item, depth });
        walk(item.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  private readonly refTpl = viewChild.required<TemplateRef<CellContext<WorkItem>>>('refTpl');
  private readonly typeTpl = viewChild.required<TemplateRef<CellContext<WorkItem>>>('typeTpl');
  private readonly statusTpl = viewChild.required<TemplateRef<CellContext<WorkItem>>>('statusTpl');
  private readonly priorityTpl = viewChild.required<TemplateRef<CellContext<WorkItem>>>('priorityTpl');
  private readonly assigneesTpl = viewChild.required<TemplateRef<CellContext<WorkItem>>>('assigneesTpl');
  private readonly dueTpl = viewChild.required<TemplateRef<CellContext<WorkItem>>>('dueTpl');

  protected readonly columns = computed<readonly ColumnDef<WorkItem>[]>(() => [
    { key: 'ref', header: 'المرجع', width: '110px', template: this.refTpl() },
    { key: 'typeId', header: 'النوع', template: this.typeTpl() },
    { key: 'title', header: 'العنوان' },
    { key: 'statusId', header: 'الحالة', template: this.statusTpl() },
    { key: 'priority', header: 'الأولوية', hideOnMobile: true, template: this.priorityTpl() },
    { key: 'assigneeIds', header: 'المكلّفون', hideOnMobile: true, template: this.assigneesTpl() },
    { key: 'dueDate', header: 'الاستحقاق', hideOnMobile: true, template: this.dueTpl() },
  ]);

  protected toggleTree(): void {
    this.tree.update((v) => !v);
  }

  protected open(item: WorkItem): void {
    void this.router.navigate(['/work-items', item.id]);
  }

  protected create(): void {
    void this.router.navigate(['/work-items'], { queryParams: { projectId: this.project().id, create: 'true' } });
  }
}

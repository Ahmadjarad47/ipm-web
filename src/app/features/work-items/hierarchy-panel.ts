import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { StatusBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { asApiError } from './work-item-utils';

let nextId = 0;

/** Parent link, children list and "change parent" (FR-REL-01/02/09). Cycles are rejected by the server (AT-17). */
@Component({
  selector: 'app-hierarchy-panel',
  imports: [RouterLink, StatusBadge, TypeChip, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
        <div class="row">
          <span class="muted">الأب:</span>
          @if (parent.value(); as p) {
            <app-type-chip [typeId]="p.typeId" [iconOnly]="true" />
            <a [routerLink]="['/work-items', p.id]"><span class="ltr">{{ p.ref }}</span> {{ p.title }}</a>
          } @else {
            <span class="muted">— لا يوجد —</span>
          }
        </div>

        @if (canEdit()) {
          <div class="row">
            <label [attr.for]="uid + '-hp-parent'" class="muted">تغيير الأب</label>
            <select [id]="uid + '-hp-parent'" class="select" (change)="selected.set(pick($event))">
              <option value="" [selected]="!item().parentId">— بدون أب —</option>
              @for (c of candidates(); track c.id) {
                <option [value]="c.id" [selected]="c.id === item().parentId">{{ c.ref }} — {{ c.title }}</option>
              }
            </select>
            <button type="button" class="btn btn--outline" [disabled]="busy() || !changed()" (click)="save()">حفظ</button>
          </div>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        }

        <h4 class="muted">العناصر الفرعية ({{ children.value()?.total ?? 0 }})</h4>
        @if (children.error()) {
          <app-error-state title="تعذّر تحميل العناصر الفرعية" (retry)="children.reload()" />
        }
        @for (c of children.value()?.items ?? []; track c.id) {
          <div class="row">
            <app-type-chip [typeId]="c.typeId" [iconOnly]="true" />
            <a [routerLink]="['/work-items', c.id]"><span class="ltr">{{ c.ref }}</span> {{ c.title }}</a>
            <span class="spacer"></span>
            <app-status-badge [statusId]="c.statusId" />
          </div>
        } @empty {
          @if (!children.error()) {
            <span class="muted">لا توجد عناصر فرعية.</span>
          }
        }
    </div>
  `,
  styles: `
    .row { flex-wrap: wrap; }
    a { overflow-wrap: anywhere; min-inline-size: 0; }
    .row .select { min-inline-size: 0; max-inline-size: 100%; flex: 1 1 200px; }
    @media (max-width: 768px) { .row .spacer { display: none; } }
    @media (pointer: coarse), (max-width: 768px) { a { display: inline-flex; align-items: center; min-block-size: 44px; } }
  `,
})
export class HierarchyPanel {
  protected readonly uid = `hierarchy${++nextId}`;
  private readonly api = inject(WorkItemsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly types = inject(WorkItemTypeLookup);

  readonly item = input.required<WorkItem>();
  readonly changedParent = output<void>();

  protected readonly selected = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly canEdit = computed(() => this.auth.can('tasks.edit', this.item().projectId));

  protected readonly parent = rxResource({
    params: () => ({ parentId: this.item().parentId ?? undefined }),
    stream: ({ params }) => (params.parentId ? this.api.getById(params.parentId) : of(null)),
  });

  protected readonly children = rxResource({
    params: () => ({ id: this.item().id, version: this.item().version }),
    stream: ({ params }) => this.api.list({ page: 1, pageSize: 100, filters: { parentId: params.id } }),
  });

  private readonly siblings = rxResource({
    params: () => ({ projectId: this.item().projectId }),
    stream: ({ params }) => this.api.list({ page: 1, pageSize: 100, filters: { projectId: params.projectId } }),
  });

  /** Same project, not self, and the candidate's type allows this item's type as a child. */
  protected readonly candidates = computed(() =>
    (this.siblings.value()?.items ?? []).filter(
      (w) => w.id !== this.item().id && !w.archived && this.types.get(w.typeId)?.allowedChildTypeIds.includes(this.item().typeId),
    ),
  );

  protected readonly changed = computed(() => {
    const value = this.selected();
    return value !== null && value !== (this.item().parentId ?? '');
  });

  protected pick(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected save(): void {
    const parentId = this.selected() || null;
    this.busy.set(true);
    this.error.set('');
    this.api.setParent(this.item().id, parentId, this.item().version).subscribe({
      next: () => {
        this.busy.set(false);
        this.selected.set(null);
        this.toast.success('تم تحديث العنصر الأب');
        this.changedParent.emit();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(asApiError(e)?.message ?? 'تعذّر تغيير الأب');
      },
    });
  }
}

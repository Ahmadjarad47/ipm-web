import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { ApprovalSubject } from '@domain/approvals/approval.models';
import { emptyPage, PagedResult } from '@core/models/entity.model';
import { UserLookup } from '@domain/users/user.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { PRIORITY_LABELS, Priority, WorkItem } from '@domain/work-items/work-item.models';
import { Icon } from '../ui/icon/icon';

export type ProposedValues = Readonly<Record<string, string | number | null>>;

const LABELS: Readonly<Record<string, string>> = {
  name: 'الاسم',
  title: 'العنوان',
  description: 'الوصف',
  startDate: 'تاريخ البداية',
  endDate: 'تاريخ النهاية',
  dueDate: 'تاريخ الاستحقاق',
  ownerId: 'المالك',
  parentId: 'العمل الأب',
  priority: 'الأولوية',
  typeId: 'النوع',
  assigneeIds: 'المكلَّفون',
};

type Kind = 'text' | 'longtext' | 'date' | 'priority' | 'user' | 'type' | 'users' | 'parent';

const KINDS: Readonly<Record<string, Kind>> = {
  name: 'text',
  title: 'text',
  description: 'longtext',
  startDate: 'date',
  endDate: 'date',
  dueDate: 'date',
  priority: 'priority',
  ownerId: 'user',
  typeId: 'type',
  assigneeIds: 'users',
  parentId: 'parent',
};

interface Row {
  readonly field: string;
  readonly value: string;
}

/** Collects `proposedChanges` for a `sensitive.change` request: a protected field plus its new value. */
@Component({
  selector: 'app-proposed-changes-editor',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--s-3); }
    .row { display: grid; grid-template-columns: 0.8fr 1.6fr auto; gap: var(--s-2); align-items: start; padding: var(--s-2); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface-2); }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
    .users { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); max-block-size: 120px; overflow: auto; }
    .err { color: var(--c-danger); font-size: var(--fs-xs); }
  `,
  template: `
    <strong id="pc-title">القيم المقترحة</strong>
    <p class="muted">اختر الحقل المحمي والقيمة الجديدة؛ لا تُطبَّق إلا بعد اكتمال الموافقة.</p>
    @for (r of rows(); track $index; let i = $index) {
      <div class="row">
        <select class="select" [attr.aria-label]="'الحقل ' + (i + 1)" [ngModel]="r.field" (ngModelChange)="patch(i, { field: $event, value: '' })">
          @for (f of availableFor(r.field); track f) {
            <option [value]="f">{{ label(f) }}</option>
          }
        </select>
        <div>
          @switch (kind(r.field)) {
            @case ('longtext') {
              <textarea class="textarea" rows="3" [attr.aria-label]="'القيمة الجديدة ' + (i + 1)" [ngModel]="r.value" (ngModelChange)="patch(i, { value: $event })"></textarea>
            }
            @case ('date') {
              <input type="date" class="input ltr" [attr.aria-label]="'القيمة الجديدة ' + (i + 1)" [ngModel]="r.value" (ngModelChange)="patch(i, { value: $event })" />
            }
            @case ('priority') {
              <select class="select" [attr.aria-label]="'القيمة الجديدة ' + (i + 1)" [ngModel]="r.value" (ngModelChange)="patch(i, { value: $event })">
                <option value="">— اختر —</option>
                @for (p of priorities; track p) {
                  <option [value]="p">{{ priorityLabels[p] }}</option>
                }
              </select>
            }
            @case ('user') {
              <select class="select" [attr.aria-label]="'القيمة الجديدة ' + (i + 1)" [ngModel]="r.value" (ngModelChange)="patch(i, { value: $event })">
                <option value="">— اختر —</option>
                @for (u of activeUsers(); track u.id) {
                  <option [value]="u.id">{{ u.name }}</option>
                }
              </select>
            }
            @case ('type') {
              <select class="select" [attr.aria-label]="'القيمة الجديدة ' + (i + 1)" [ngModel]="r.value" (ngModelChange)="patch(i, { value: $event })">
                <option value="">— اختر —</option>
                @for (t of types.items(); track t.id) {
                  <option [value]="t.id">{{ t.name }}</option>
                }
              </select>
            }
            @case ('users') {
              <div class="users" role="group" [attr.aria-label]="'المكلَّفون الجدد'">
                @for (u of activeUsers(); track u.id) {
                  <label class="checkbox">
                    <input type="checkbox" [checked]="csv(r.value).includes(u.id)" (change)="toggleUser(i, u.id, $any($event.target).checked)" />
                    {{ u.name }}
                  </label>
                }
              </div>
            }
            @case ('parent') {
              <select class="select" [attr.aria-label]="'القيمة الجديدة ' + (i + 1)" [ngModel]="r.value" (ngModelChange)="patch(i, { value: $event })">
                <option value="">— بلا أب —</option>
                @for (w of siblings(); track w.id) {
                  <option [value]="w.id">{{ w.ref }} — {{ w.title }}</option>
                }
              </select>
            }
            @default {
              <input class="input" [attr.aria-label]="'القيمة الجديدة ' + (i + 1)" [ngModel]="r.value" (ngModelChange)="patch(i, { value: $event })" />
            }
          }
          @if (errors()[r.field]; as e) {
            <span class="err" role="alert">{{ e }}</span>
          }
        </div>
        <button type="button" class="btn btn--ghost btn--sm btn--icon" [attr.aria-label]="'حذف الحقل ' + (i + 1)" [disabled]="rows().length === 1" (click)="remove(i)">
          <app-icon name="trash" [size]="15" />
        </button>
      </div>
    }
    @if (unused().length) {
      <div>
        <button type="button" class="btn btn--outline btn--sm" (click)="add()"><app-icon name="plus" [size]="14" /> حقل آخر</button>
      </div>
    }
  `,
})
export class ProposedChangesEditor {
  /** Protected fields of the chosen template. */
  readonly fields = input.required<readonly string[]>();
  readonly subjectType = input.required<ApprovalSubject>();
  readonly subjectId = input.required<string>();
  /** Server validation details (field -> message) shown inline. */
  readonly errors = input<Readonly<Record<string, string>>>({});
  /** Values to send; only filled rows are included. */
  readonly value = model<ProposedValues>({});

  private readonly users = inject(UserLookup);
  protected readonly types = inject(WorkItemTypeLookup);
  private readonly workItems = inject(WorkItemsApi);

  protected readonly priorities = Object.keys(PRIORITY_LABELS) as Priority[];
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly activeUsers = computed(() => this.users.items().filter((u) => u.active));
  protected readonly rows = signal<readonly Row[]>([]);

  private readonly subject = rxResource<WorkItem | null, { type: ApprovalSubject; id: string }>({
    params: () => ({ type: this.subjectType(), id: this.subjectId() }),
    stream: ({ params }) => (params.type === 'work-item' ? this.workItems.getById(params.id) : of(null)),
    defaultValue: null,
  });

  private readonly siblingPage = rxResource<PagedResult<WorkItem>, string | undefined>({
    params: () => this.subject.value()?.projectId,
    stream: ({ params }) => (params ? this.workItems.list({ page: 1, pageSize: 100, filters: { projectId: params } }) : of(emptyPage<WorkItem>(100))),
    defaultValue: emptyPage<WorkItem>(100),
  });

  protected readonly siblings = computed(() => this.siblingPage.value().items.filter((w) => w.id !== this.subjectId()));
  protected readonly unused = computed(() => this.fields().filter((f) => !this.rows().some((r) => r.field === f)));

  constructor() {
    // (Re)seed rows whenever the protected-field list changes (e.g. another template was picked).
    effect(() => {
      const fields = this.fields();
      untracked(() => {
        const kept = this.rows().filter((r) => fields.includes(r.field));
        this.write(kept.length ? kept : fields[0] ? [{ field: fields[0], value: '' }] : []);
      });
    });
  }

  protected label(f: string): string {
    return LABELS[f] ?? f;
  }

  protected kind(f: string): Kind {
    return KINDS[f] ?? 'text';
  }

  protected availableFor(current: string): readonly string[] {
    return this.fields().filter((f) => f === current || !this.rows().some((r) => r.field === f));
  }

  protected csv(value: string): readonly string[] {
    return value.split(',').filter(Boolean);
  }

  protected add(): void {
    const next = this.unused()[0];
    if (next) this.write([...this.rows(), { field: next, value: '' }]);
  }

  protected remove(i: number): void {
    this.write(this.rows().filter((_, idx) => idx !== i));
  }

  protected patch(i: number, patch: Partial<Row>): void {
    this.write(this.rows().map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  protected toggleUser(i: number, userId: string, checked: boolean): void {
    const current = this.csv(this.rows()[i].value);
    const next = checked ? [...current, userId] : current.filter((id) => id !== userId);
    this.patch(i, { value: [...new Set(next)].sort().join(',') });
  }

  private write(rows: readonly Row[]): void {
    this.rows.set(rows);
    const out: Record<string, string | number | null> = {};
    for (const r of rows) {
      if (r.value !== '') out[r.field] = r.value;
    }
    this.value.set(out);
  }

}

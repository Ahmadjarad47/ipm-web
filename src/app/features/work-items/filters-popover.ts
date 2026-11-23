import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { AuthService } from '@core/auth/auth.service';
import { FilterValue } from '@core/models/entity.model';
import { ProjectLookup } from '@domain/projects/project.api';
import { UserLookup } from '@domain/users/user.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { Icon } from '@shared/ui/icon/icon';
import { asList, FilterMap } from './work-item-filters';
import { ltr, PRIORITY_OPTIONS } from './work-item-utils';

export interface PickedItem {
  readonly id: string;
  readonly ref: string;
}

/** Search box + select of work items (by ref or title); emits the chosen item or `null` to clear. */
@Component({
  selector: 'app-item-filter-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label [attr.for]="fieldId() + '-s'">{{ label() }}</label>
      <input [id]="fieldId() + '-s'" class="input" type="search" placeholder="بحث بالمرجع أو العنوان" (input)="search.set(text($event))" />
      <select [id]="fieldId()" class="select" [attr.aria-label]="label() + ' — النتائج'" (change)="onPick($event)">
        <option value="" [selected]="!value()">— بدون —</option>
        @if (value() && !inResults()) {
          <option [value]="value()" selected>{{ valueLabel() }}</option>
        }
        @for (c of results.value()?.items ?? []; track c.id) {
          <option [value]="c.id" [selected]="c.id === value()">{{ ltr(c.ref) }} — {{ c.title }}</option>
        }
      </select>
    </div>
  `,
})
export class ItemFilterPicker {
  private readonly api = inject(WorkItemsApi);

  readonly fieldId = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input<string>('');
  readonly valueLabel = input<string>('');
  readonly picked = output<PickedItem | null>();

  protected readonly ltr = ltr;
  protected readonly search = signal('');
  protected readonly results = rxResource({
    params: () => ({ search: this.search() }),
    stream: ({ params }) => this.api.list({ page: 1, pageSize: 20, search: params.search }),
  });
  protected readonly inResults = computed(() => (this.results.value()?.items ?? []).some((i) => i.id === this.value()));

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected onPick(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const item = this.results.value()?.items.find((i) => i.id === id);
    this.picked.emit(item ? { id: item.id, ref: item.ref } : null);
  }
}

type Tri = 'any' | 'true' | 'false';
let nextId = 0;

/** «فلاتر» popover (FR-TSK-05, FR-REL-14). Every change is emitted at once; the page owns the state. */
@Component({
  selector: 'app-filters-popover',
  imports: [Icon, ItemFilterPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)', '(keydown.escape)': 'close(true)' },
  template: `
    <button type="button" class="btn btn--outline" aria-haspopup="dialog" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? uid + '-panel' : null" (click)="open.set(!open())">
      <app-icon name="filter" [size]="16" /> فلاتر
      @if (activeCount()) {
        <span class="count">{{ activeCount() }}</span>
        <span class="sr-only">فلاتر نشطة</span>
      }
    </button>
    @if (open()) {
      <div [id]="uid + '-panel'" class="panel card" role="dialog" aria-label="الفلاتر">
        <div class="grid">
          <div class="field">
            <label [attr.for]="uid + '-f-project'">المشروع</label>
            <select [id]="uid + '-f-project'" class="select" (change)="setText('projectId', $event)">
              <option value="">كل المشاريع</option>
              @for (p of activeProjects(); track p.id) {
                <option [value]="p.id" [selected]="p.id === text1('projectId')">{{ ltr(p.code) }} — {{ p.name }}</option>
              }
            </select>
          </div>

          <fieldset class="field group">
            <legend>النوع</legend>
            @for (t of activeTypes(); track t.id) {
              <label class="checkbox"><input type="checkbox" [checked]="has('typeId', t.id)" (change)="toggle('typeId', t.id)" /> {{ t.name }}</label>
            }
          </fieldset>

          <fieldset class="field group">
            <legend>الحالة</legend>
            @for (s of statuses(); track s.id) {
              <label class="checkbox"><input type="checkbox" [checked]="has('statusId', s.id)" (change)="toggle('statusId', s.id)" /> {{ s.name }}</label>
            }
          </fieldset>

          <fieldset class="field group">
            <legend>الأولوية</legend>
            @for (o of priorities; track o.value) {
              <label class="checkbox"><input type="checkbox" [checked]="has('priority', o.value)" (change)="toggle('priority', o.value)" /> {{ o.label }}</label>
            }
          </fieldset>

          <fieldset class="field group scroll">
            <legend>المكلّف</legend>
            <label class="checkbox"><input type="checkbox" [checked]="flag('unassigned')" (change)="setFlag('unassigned', $event)" /> غير مُكلَّف</label>
            <label class="checkbox"><input type="checkbox" [checked]="mine()" (change)="toggleMine($event)" /> عناصر عملي</label>
            @for (u of activeUsers(); track u.id) {
              <label class="checkbox"><input type="checkbox" [checked]="has('assigneeIds', u.id)" (change)="toggle('assigneeIds', u.id)" /> {{ u.name }}</label>
            }
          </fieldset>

          <fieldset class="field range">
            <legend>تاريخ الاستحقاق</legend>
            <label [attr.for]="uid + '-f-due-from'">من</label>
            <input [id]="uid + '-f-due-from'" class="input" type="date" [value]="text1('dueFrom')" (change)="setText('dueFrom', $event)" />
            <label [attr.for]="uid + '-f-due-to'">إلى</label>
            <input [id]="uid + '-f-due-to'" class="input" type="date" [value]="text1('dueTo')" (change)="setText('dueTo', $event)" />
          </fieldset>

          <fieldset class="field range">
            <legend>تاريخ الإنشاء</legend>
            <label [attr.for]="uid + '-f-cr-from'">من</label>
            <input [id]="uid + '-f-cr-from'" class="input" type="date" [value]="text1('createdFrom')" (change)="setText('createdFrom', $event)" />
            <label [attr.for]="uid + '-f-cr-to'">إلى</label>
            <input [id]="uid + '-f-cr-to'" class="input" type="date" [value]="text1('createdTo')" (change)="setText('createdTo', $event)" />
          </fieldset>

          <app-item-filter-picker [fieldId]="uid + '-f-parent'" label="الأب" [value]="text1('parentId')" [valueLabel]="labelOf('parentId')" (picked)="setItem('parentId', $event)" />
          <app-item-filter-picker [fieldId]="uid + '-f-blocked-by'" label="محجوب بواسطة" [value]="text1('blockedBy')" [valueLabel]="labelOf('blockedBy')" (picked)="setItem('blockedBy', $event)" />
          <app-item-filter-picker [fieldId]="uid + '-f-blocking'" label="يحجب" [value]="text1('blocking')" [valueLabel]="labelOf('blocking')" (picked)="setItem('blocking', $event)" />

          <div class="field">
            <label [attr.for]="uid + '-f-children'">له عناصر فرعية</label>
            <select [id]="uid + '-f-children'" class="select" (change)="setTri('hasChildren', $event)">
              <option value="any" [selected]="tri('hasChildren') === 'any'">الكل</option>
              <option value="true" [selected]="tri('hasChildren') === 'true'">نعم</option>
              <option value="false" [selected]="tri('hasChildren') === 'false'">لا</option>
            </select>
          </div>
          <div class="field">
            <label [attr.for]="uid + '-f-deps'">له اعتماديات</label>
            <select [id]="uid + '-f-deps'" class="select" (change)="setTri('hasDependency', $event)">
              <option value="any" [selected]="tri('hasDependency') === 'any'">الكل</option>
              <option value="true" [selected]="tri('hasDependency') === 'true'">نعم</option>
              <option value="false" [selected]="tri('hasDependency') === 'false'">لا</option>
            </select>
          </div>

          <div class="field group">
            <label class="checkbox"><input type="checkbox" [checked]="flag('unblocked')" (change)="setFlag('unblocked', $event)" /> غير محجوب</label>
            <label class="checkbox"><input type="checkbox" [checked]="flag('overdue')" (change)="setFlag('overdue', $event)" /> متأخرة فقط</label>
          </div>
        </div>
        <div class="foot">
          <button type="button" class="btn btn--ghost" [disabled]="!activeCount()" (click)="clearAll.emit()">مسح الكل</button>
          <button type="button" class="btn btn--primary" (click)="close(true)">تم</button>
        </div>
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .count { min-inline-size: 20px; block-size: 20px; padding-inline: 6px; border-radius: var(--r-pill); background: var(--c-primary); color: var(--c-on-primary, #fff); font-size: 11px; display: inline-grid; place-items: center; }
    .panel { position: absolute; inset-inline-start: 0; inset-block-start: calc(100% + 4px); z-index: 25; inline-size: min(720px, calc(100vw - 32px)); max-block-size: 70vh; overflow: auto; padding: var(--s-4); box-shadow: var(--shadow-md, 0 4px 16px rgb(0 0 0 / 0.12)); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-4); align-items: start; }
    fieldset { border: 0; margin: 0; padding: 0; min-inline-size: 0; }
    legend { font-weight: 600; margin-block-end: var(--s-1); padding: 0; }
    .group { display: flex; flex-direction: column; gap: var(--s-1); }
    .scroll { max-block-size: 180px; overflow: auto; }
    .range { display: grid; grid-template-columns: auto 1fr; gap: var(--s-1) var(--s-2); align-items: center; }
    .range legend { grid-column: 1 / -1; }
    .foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-2); margin-block-start: var(--s-4); padding-block-start: var(--s-3); border-block-start: 1px solid var(--c-border); }
    .grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
    .panel { max-inline-size: calc(100vw - 16px); }
    @media (max-width: 768px) {
      .panel { position: fixed; inset-inline: 8px; inset-block-start: 64px; inline-size: auto; max-block-size: calc(100dvh - 80px); padding: var(--s-3); }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .checkbox { min-block-size: 44px; display: flex; align-items: center; gap: var(--s-2); }
      .foot .btn { min-block-size: 44px; }
    }
  `,
})
export class FiltersPopover {
  private readonly auth = inject(AuthService);
  private readonly projects = inject(ProjectLookup);
  private readonly typeLookup = inject(WorkItemTypeLookup);
  private readonly statusLookup = inject(StatusLookup);
  private readonly users = inject(UserLookup);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly filters = input.required<FilterMap>();
  /** Display text of picked items (id -> ref), resolved by the page. */
  readonly itemLabels = input<Readonly<Record<string, string>>>({});
  readonly filtersChange = output<FilterMap>();
  readonly itemPicked = output<PickedItem>();
  readonly clearAll = output<void>();

  protected readonly ltr = ltr;
  protected readonly uid = `wi-f${++nextId}`;
  protected readonly priorities = PRIORITY_OPTIONS;
  protected readonly open = signal(false);

  protected readonly activeProjects = computed(() => this.projects.items().filter((p) => !p.archived));
  protected readonly activeTypes = computed(() => this.typeLookup.items().filter((t) => t.active));
  protected readonly statuses = computed(() => this.statusLookup.items().filter((s) => s.scope === 'work-item' && s.active).sort((a, b) => a.order - b.order));
  protected readonly activeUsers = computed(() => this.users.items().filter((u) => u.active));
  protected readonly activeCount = computed(() =>
    Object.values(this.filters()).filter((v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)).length,
  );
  protected readonly mine = computed(() => {
    const me = this.auth.user()?.id;
    const list = asList(this.filters()['assigneeIds']);
    return !!me && list.length === 1 && list[0] === me;
  });

  protected has(key: string, value: string): boolean {
    return asList(this.filters()[key]).includes(value);
  }

  protected flag(key: string): boolean {
    return this.filters()[key] === true;
  }

  protected text1(key: string): string {
    return asList(this.filters()[key])[0] ?? '';
  }

  protected labelOf(key: string): string {
    const id = this.text1(key);
    return this.itemLabels()[id] ?? id;
  }

  protected tri(key: string): Tri {
    const v = this.filters()[key];
    return v === true ? 'true' : v === false ? 'false' : 'any';
  }

  protected toggle(key: string, value: string): void {
    const list = asList(this.filters()[key]);
    this.set(key, list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  protected toggleMine(event: Event): void {
    const me = this.auth.user()?.id;
    this.set('assigneeIds', (event.target as HTMLInputElement).checked && me ? [me] : undefined);
  }

  protected setFlag(key: string, event: Event): void {
    this.set(key, (event.target as HTMLInputElement).checked ? true : undefined);
  }

  protected setTri(key: string, event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    this.set(key, v === 'true' ? true : v === 'false' ? false : undefined);
  }

  protected setText(key: string, event: Event): void {
    this.set(key, (event.target as HTMLInputElement | HTMLSelectElement).value || undefined);
  }

  protected setItem(key: string, item: PickedItem | null): void {
    if (item) this.itemPicked.emit(item);
    this.set(key, item?.id);
  }

  protected close(restoreFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>('button')?.focus();
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  private set(key: string, value: FilterValue | undefined): void {
    const next: Record<string, FilterValue> = { ...this.filters() };
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete next[key];
    else next[key] = value;
    this.filtersChange.emit(next);
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, model } from '@angular/core';
import { ProjectLookup } from '@domain/projects/project.api';
import { UserLookup } from '@domain/users/user.api';
import { STATUS_CATEGORIES, STATUS_CATEGORY_LABELS, StatusCategory } from '@domain/workflow/workflow.models';
import { DEFAULT_FILTERS, PERIOD_LABELS, ReportFilters, ReportPeriod } from './report-filters.model';

/** Shared filters bar for both report tabs (FR-UI-07). */
@Component({
  selector: 'app-report-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card card-body bar no-print" aria-label="مرشحات التقرير" (submit)="$event.preventDefault()">
      <div class="field">
        <label for="rf-project">المشروع</label>
        <select id="rf-project" class="select" (change)="patch({ projectId: val($event) })">
          <option value="" [selected]="!filters().projectId">كل المشاريع</option>
          @for (p of projectOptions(); track p.id) {
            <option [value]="p.id" [selected]="p.id === filters().projectId">{{ p.name }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="rf-period">الفترة</label>
        <select id="rf-period" class="select" (change)="patch({ period: asPeriod(val($event)) })">
          @for (p of periods; track p.key) {
            <option [value]="p.key" [selected]="p.key === filters().period">{{ p.label }}</option>
          }
        </select>
      </div>
      @if (filters().period === 'custom') {
        <div class="field">
          <label for="rf-from">من</label>
          <input id="rf-from" type="date" class="input" dir="ltr" [value]="filters().from" [max]="filters().to || null" (change)="patch({ from: val($event) })" />
        </div>
        <div class="field">
          <label for="rf-to">إلى</label>
          <input id="rf-to" type="date" class="input" dir="ltr" [value]="filters().to" [min]="filters().from || null" (change)="patch({ to: val($event) })" />
        </div>
      }
      <div class="field">
        <label for="rf-cat">فئة الحالة</label>
        <select id="rf-cat" class="select" (change)="patch({ category: asCategory(val($event)) })">
          <option value="" [selected]="!filters().category">كل الفئات</option>
          @for (c of categories; track c.key) {
            <option [value]="c.key" [selected]="c.key === filters().category">{{ c.label }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="rf-user">المكلّف</label>
        <select id="rf-user" class="select" (change)="patch({ assigneeId: val($event) })">
          <option value="" [selected]="!filters().assigneeId">الجميع</option>
          @for (u of users.items(); track u.id) {
            <option [value]="u.id" [selected]="u.id === filters().assigneeId">{{ u.name }}</option>
          }
        </select>
      </div>
      <button type="button" class="btn btn--ghost btn--sm" (click)="reset()">إعادة ضبط</button>
    </form>
  `,
  styles: `
    .bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--s-4); margin-bottom: var(--s-4); }
    .field { min-width: 150px; }
    @media print { .no-print { display: none; } }
  `,
})
export class ReportFiltersBar {
  protected readonly projects = inject(ProjectLookup);
  protected readonly users = inject(UserLookup);

  readonly filters = model.required<ReportFilters>();

  protected readonly projectOptions = computed(() => this.projects.items().filter((p) => !p.archived));
  protected readonly periods = (Object.keys(PERIOD_LABELS) as ReportPeriod[]).map((key) => ({ key, label: PERIOD_LABELS[key] }));
  protected readonly categories = STATUS_CATEGORIES.map((key) => ({ key, label: STATUS_CATEGORY_LABELS[key] }));

  protected val(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected asPeriod(v: string): ReportPeriod {
    return this.periods.find((p) => p.key === v)?.key ?? 'all';
  }

  protected asCategory(v: string): StatusCategory | '' {
    return STATUS_CATEGORIES.find((c) => c === v) ?? '';
  }

  protected patch(change: Partial<ReportFilters>): void {
    this.filters.update((f) => ({ ...f, ...change }));
  }

  protected reset(): void {
    this.filters.set(DEFAULT_FILTERS);
  }
}

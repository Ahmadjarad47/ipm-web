import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Icon } from '../icon/icon';
import { PAGE_SIZE_OPTIONS } from '../data-table/data-table.models';

@Component({
  selector: 'app-paginator',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="pager" aria-label="ترقيم الصفحات">
      <span class="muted">{{ from() }}–{{ to() }} من {{ total() }}</span>
      <label class="size muted">
        عدد الصفوف
        <select class="select" [value]="pageSize()" (change)="onSize($event)" aria-label="عدد الصفوف في الصفحة">
          @for (o of sizes(); track o) {
            <option [value]="o" [selected]="o === pageSize()">{{ o }}</option>
          }
        </select>
      </label>
      <div class="pages">
        <!-- In RTL "previous" points right. -->
        <button class="btn btn--ghost btn--icon btn--sm" type="button" [disabled]="page() <= 1" (click)="go(page() - 1)" aria-label="الصفحة السابقة">
          <app-icon name="chevronRight" [size]="16" />
        </button>
        @for (p of pages(); track $index) {
          @if (p === 0) {
            <span class="gap">…</span>
          } @else {
            <button type="button" class="btn btn--sm" [class.btn--primary]="p === page()" [class.btn--ghost]="p !== page()"
              [attr.aria-current]="p === page() ? 'page' : null" (click)="go(p)">{{ p }}</button>
          }
        }
        <button class="btn btn--ghost btn--icon btn--sm" type="button" [disabled]="page() >= last()" (click)="go(page() + 1)" aria-label="الصفحة التالية">
          <app-icon name="chevronLeft" [size]="16" />
        </button>
      </div>
    </nav>
  `,
  styles: `
    .pager { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-3) var(--s-4); border-top: 1px solid var(--c-border); font-size: var(--fs-sm); flex-wrap: wrap; }
    .pages { display: flex; align-items: center; gap: 4px; }
    .btn--sm { min-width: 30px; padding: 0 8px; }
    .size { display: inline-flex; align-items: center; gap: var(--s-2); }
    .size .select { width: auto; min-height: 32px; padding-block: 2px; }
    .gap { padding: 0 4px; color: var(--c-muted); }
  `,
})
export class Paginator {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly pageSizeOptions = input<readonly number[]>(PAGE_SIZE_OPTIONS);
  protected readonly sizes = computed(() => [...new Set([...this.pageSizeOptions(), this.pageSize()])].sort((a, b) => a - b));

  protected readonly last = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly from = computed(() => (this.total() ? (this.page() - 1) * this.pageSize() + 1 : 0));
  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.pageSize()));

  /** Page numbers with 0 as an ellipsis marker: 1 … 4 5 6 … 12 */
  protected readonly pages = computed(() => {
    const last = this.last();
    const cur = this.page();
    const out: number[] = [];
    for (let p = 1; p <= last; p++) {
      if (p === 1 || p === last || Math.abs(p - cur) <= 1) out.push(p);
      else if (out[out.length - 1] !== 0) out.push(0);
    }
    return out;
  });

  protected onSize(event: Event): void {
    this.pageSizeChange.emit(Number((event.target as HTMLSelectElement).value));
  }

  protected go(page: number): void {
    if (page >= 1 && page <= this.last() && page !== this.page()) this.pageChange.emit(page);
  }
}

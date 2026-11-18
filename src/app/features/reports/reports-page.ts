import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { KpiReport } from './kpi-report';
import { filtersFromQuery, filtersToQuery } from './report-filters.model';
import { ReportFiltersBar } from './report-filters';
import { TimelineChart } from './timeline-chart';

type ReportTab = 'timeline' | 'kpi';

/** FR-UI-04 timeline + FR-UI-08 KPI report behind one shared filter bar; filters live in the query string. */
@Component({
  selector: 'app-reports-page',
  imports: [PageHeader, Tabs, ReportFiltersBar, TimelineChart, KpiReport],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="no-print">
      <app-page-header title="التقارير والخط الزمني" subtitle="تابع جدول المشاريع والعناصر ومؤشرات الأداء." />
    </div>
    <app-report-filters [(filters)]="filters" />
    <div class="no-print"><app-tabs [tabs]="tabs" [(active)]="tab" /></div>
    <div class="panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
      @if (tab() === 'timeline') {
        <app-timeline-chart [filters]="filters()" />
      } @else {
        <app-kpi-report [filters]="filters()" />
      }
    </div>
  `,
  styles: `
    .panel { margin-top: var(--s-4); }
    @media print { .no-print { display: none; } }
  `,
})
export class ReportsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly tabs: readonly TabItem<ReportTab>[] = [
    { key: 'timeline', label: 'الخط الزمني' },
    { key: 'kpi', label: 'تقرير المؤشرات' },
  ];

  private readonly query = this.route.snapshot.queryParamMap;
  protected readonly filters = signal(filtersFromQuery((k) => this.query.get(k)));
  protected readonly tab = signal<ReportTab>(this.query.get('tab') === 'kpi' ? 'kpi' : 'timeline');

  constructor() {
    effect(() => {
      const queryParams = { ...filtersToQuery(this.filters()), tab: this.tab() === 'kpi' ? 'kpi' : null };
      void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
    });
  }
}

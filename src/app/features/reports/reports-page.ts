import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { KpiReport } from './kpi-report';
import { filtersFromQuery, filtersToQuery } from './report-filters.model';
import { ReportFiltersBar } from './report-filters';
import { TimelineChart } from './timeline-chart';
import { WorkReportExport } from './work-report-export';

type ReportTab = 'timeline' | 'kpi' | 'export';

/** FR-UI-04 timeline + FR-UI-08 KPI report behind one shared filter bar (filters live in the query string), and the downloadable work report. */
@Component({
  selector: 'app-reports-page',
  imports: [PageHeader, Tabs, ReportFiltersBar, TimelineChart, KpiReport, WorkReportExport],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="no-print">
      <app-page-header title="التقارير والخط الزمني" subtitle="تابع جدول المشاريع والعناصر ومؤشرات الأداء، ونزّل تقارير العمل." />
    </div>
    @if (tab() !== 'export') {
      <app-report-filters [(filters)]="filters" />
    }
    <div class="no-print"><app-tabs [tabs]="tabs()" [(active)]="tab" /></div>
    <div class="panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
      @if (tab() === 'timeline') {
        <app-timeline-chart [filters]="filters()" />
      } @else if (tab() === 'kpi') {
        <app-kpi-report [filters]="filters()" />
      } @else {
        <app-work-report-export />
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
  private readonly auth = inject(AuthService);

  protected readonly tabs = computed<readonly TabItem<ReportTab>[]>(() => [
    { key: 'timeline', label: 'الخط الزمني' },
    { key: 'kpi', label: 'تقرير المؤشرات' },
    ...(this.auth.can('reports.export') ? [{ key: 'export' as const, label: 'تنزيل تقرير العمل' }] : []),
  ]);

  private readonly query = this.route.snapshot.queryParamMap;
  protected readonly filters = signal(filtersFromQuery((k) => this.query.get(k)));
  protected readonly tab = signal<ReportTab>(this.initialTab());

  constructor() {
    effect(() => {
      const tab = this.tab();
      const queryParams = { ...filtersToQuery(this.filters()), tab: tab === 'timeline' ? null : tab };
      void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
    });
  }

  private initialTab(): ReportTab {
    const wanted = this.query.get('tab');
    return wanted === 'kpi' || (wanted === 'export' && this.auth.can('reports.export')) ? wanted : 'timeline';
  }
}

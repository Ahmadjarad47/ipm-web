import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { Router } from '@angular/router';
import { forkJoin, map } from 'rxjs';
import { RelationsApi, WorkItemsApi } from '@domain/work-items/work-item.api';
import { WorkItem, WorkItemRelation } from '@domain/work-items/work-item.models';
import { DependencyGraph } from '@shared/domain-ui/dependency-graph';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';

const PAGE_SIZE = 100;

interface GraphData {
  readonly items: readonly WorkItem[];
  readonly total: number;
  readonly relations: readonly WorkItemRelation[];
}

@Component({
  selector: 'app-project-graph-tab',
  imports: [DependencyGraph, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resource.error()) {
      <app-error-state title="تعذّر تحميل المخطط" (retry)="resource.reload()" />
    } @else if (resource.value(); as data) {
      @if (data.total > pageSize) {
        <p class="muted note">يعرض أول {{ pageSize }} عمل</p>
      }
      <app-dependency-graph [items]="data.items" [relations]="data.relations" (open)="router.navigate(['/work-items', $event.id])" />
    } @else {
      <app-skeleton variant="chart" />
    }
  `,
  styles: `
    :host { display: block; min-width: 0; max-width: 100%; }
    .note { margin: 0 0 var(--s-3); font-size: var(--fs-sm); }
    app-dependency-graph { display: block; max-width: 100%; overflow-x: auto; }
  `,
})
export class ProjectGraphTab {
  readonly projectId = input.required<string>();

  protected readonly router = inject(Router);
  private readonly itemsApi = inject(WorkItemsApi);
  private readonly relationsApi = inject(RelationsApi);
  protected readonly pageSize = PAGE_SIZE;

  protected readonly resource = rxResource<GraphData, string>({
    params: () => this.projectId(),
    stream: ({ params }) =>
      forkJoin({
        relations: this.relationsApi.forProject(params),
        page: this.itemsApi.list({ page: 1, pageSize: PAGE_SIZE, filters: { projectId: params } }),
      }).pipe(map(({ page, relations }) => ({ items: page.items, total: page.total, relations }))),
  });
}

import { inject, Injectable } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DEFAULT_PAGE_SIZE, ListQuery } from '@core/models/entity.model';
import { EntityListStore } from '@core/state/entity-list.store';
import { ProjectsApi } from '@domain/projects/project.api';
import { ProjectSummary } from '@domain/projects/project.models';
import { loadTablePrefs } from '@shared/ui/data-table/data-table.models';
import { paramsToQuery, ProjectFilterKey } from './project-list-query';

export const PROJECTS_TABLE_ID = 'projects';

/** Project list state. The first query is read from the URL (`paramsToQuery`), so links and reloads restore filters. */
@Injectable()
export class ProjectListStore extends EntityListStore<ProjectSummary> {
  protected readonly api = inject(ProjectsApi);
  private readonly route = inject(ActivatedRoute);

  protected override initialQuery(): ListQuery<ProjectSummary> {
    const size = loadTablePrefs(PROJECTS_TABLE_ID).pageSize ?? DEFAULT_PAGE_SIZE;
    return paramsToQuery(this.route.snapshot.queryParamMap, size);
  }

  /** Typed wrapper: the server-side filters `memberId`, `startTo`, `endFrom` are not entity fields. */
  setProjectFilter(key: ProjectFilterKey, value: string | boolean | undefined): void {
    this.setFilter(key as keyof ProjectSummary & string, value);
  }

  /** Clears search and every filter, keeping the default "active projects only". */
  clearFilters(): void {
    this.setSearch('');
    for (const key of ['statusId', 'ownerId', 'memberId', 'startTo', 'endFrom'] as const) this.setProjectFilter(key, undefined);
    this.setProjectFilter('archived', false);
  }
}

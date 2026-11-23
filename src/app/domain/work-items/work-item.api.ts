import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { BaseApiService, SequenceStep } from '@core/api/base-api.service';
import { toHttpParams } from '@core/api/query-params';
import { ListQuery, UpdateDto } from '@core/models/entity.model';
import { LookupStore } from '@core/state/lookup.store';
import { CloseRequest, ReopenRequest, TransitionRequest } from '@domain/workflow/workflow.models';
import {
  BoardItem,
  HierarchyPair,
  ImpactInfo,
  Priority,
  RelationType,
  TypeChangeConflict,
  WorkItem,
  WorkItemCreate,
  WorkItemRelation,
  WorkItemType,
} from './work-item.models';

@Injectable({ providedIn: 'root' })
export class WorkItemsApi extends BaseApiService<WorkItem, WorkItemCreate, UpdateDto<WorkItem>> {
  protected readonly resource = 'work-items';

  /** The screens filter by `assigneeIds`; the API names that filter `assigneeId` (a comma list matches any of them). */
  protected override toParams(query: ListQuery<WorkItem>): HttpParams {
    const { assigneeIds, ...rest } = (query.filters ?? {}) as Record<string, unknown>;
    const filters = assigneeIds === undefined ? rest : { ...rest, assigneeId: assigneeIds };
    return toHttpParams({ ...query, filters } as ListQuery<WorkItem>, this.searchParam);
  }

  protected override toUpdateBody(m: WorkItem): unknown {
    return {
      title: m.title,
      description: m.description,
      priority: m.priority,
      startDate: m.startDate,
      dueDate: m.dueDate,
      assigneeIds: m.assigneeIds,
      fields: m.fields,
    };
  }

  /** Server validates the transition, permissions and blocking rules (FR-WF-05). */
  transition(id: string, request: TransitionRequest): Observable<WorkItem> {
    return this.action(id, 'transition', request);
  }

  /** Moves the item to a "done" or "cancelled" status; the server picks the target when none is given. */
  close(id: string, request: CloseRequest): Observable<WorkItem> {
    return this.action(id, 'close', request);
  }

  reopen(id: string, request: ReopenRequest): Observable<WorkItem> {
    return this.action(id, 'reopen', request);
  }

  /** Board data: the items of one project, each with the workflow that applies to it (the project's override or its type's). */
  board(projectId: string): Observable<readonly BoardItem[]> {
    return this.http
      .get<{
        readonly workflows: readonly { readonly typeId: string; readonly workflowId: string }[];
        readonly items: readonly Omit<BoardItem, 'workflowId'>[];
      }>(`${this.url}/board`, { params: new HttpParams().set('projectId', projectId) })
      .pipe(
        map((board) => {
          const workflowOf = new Map(board.workflows.map((w) => [w.typeId, w.workflowId]));
          return board.items.map((item) => ({ ...item, workflowId: workflowOf.get(item.typeId) ?? '' }));
        }),
      );
  }

  setParent(id: string, parentId: string | null, version: number): Observable<WorkItem> {
    return this.sequence(id, version, [{ method: 'PUT', path: '/parent', body: { parentId } }]);
  }

  /** Dry run of a type change: what would stop it (required fields, children that no longer fit). */
  checkTypeChange(id: string, typeId: string): Observable<readonly TypeChangeConflict[]> {
    return this.http
      .post<{ readonly conflicts: readonly TypeChangeConflict[] }>(`${this.url}/${encodeURIComponent(id)}/type-change/check`, { typeId })
      .pipe(map((r) => r.conflicts));
  }

  changeType(id: string, typeId: string, version: number): Observable<WorkItem> {
    return this.action(id, 'type-change', { typeId, version });
  }

  bulk(request: BulkRequest): Observable<readonly BulkResult[]> {
    return this.http.post<readonly BulkResult[]>(`${this.url}/bulk`, request);
  }
}

export type BulkAction =
  | { readonly kind: 'assign'; readonly assigneeIds: readonly string[] }
  | { readonly kind: 'priority'; readonly priority: Priority }
  | { readonly kind: 'transition'; readonly toStatusId: string }
  | { readonly kind: 'dueDate'; readonly dueDate: string | null };

export interface BulkRequest {
  readonly ids: readonly string[];
  readonly action: BulkAction;
}

export interface BulkResult {
  readonly id: string;
  readonly ref: string;
  readonly ok: boolean;
  readonly message: string | null;
}

@Injectable({ providedIn: 'root' })
export class WorkItemTypesApi extends BaseApiService<WorkItemType> {
  protected readonly resource = 'work-item-types';

  impact(id: string): Observable<ImpactInfo> {
    return this.http.get<ImpactInfo>(`${this.url}/${encodeURIComponent(id)}/impact`);
  }

  /** The API keeps a type's own data, its fields and the child types it allows as three records; only what changed is sent. */
  override update(id: string, payload: UpdateDto<WorkItemType>): Observable<WorkItemType> {
    const { version } = payload;
    return this.getById(id).pipe(
      switchMap((current) => {
        const next = { ...current, ...payload };
        const steps: SequenceStep[] = [];
        const same = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);
        if (!same([current.name, current.description, current.color, current.icon, current.order, current.active, current.workflowId], [next.name, next.description, next.color, next.icon, next.order, next.active, next.workflowId])) {
          steps.push({
            method: 'PUT',
            path: '',
            body: { name: next.name, description: next.description, color: next.color, icon: next.icon, order: next.order, active: next.active, workflowId: next.workflowId },
          });
        }
        if (!same(current.fields, next.fields)) steps.push({ method: 'PUT', path: '/fields', body: { fields: next.fields } });
        if (!same([...current.allowedChildTypeIds].sort(), [...next.allowedChildTypeIds].sort())) {
          steps.push({ method: 'PUT', path: '/children', body: { childTypeIds: next.allowedChildTypeIds } });
        }
        return steps.length ? this.sequence(id, version ?? current.version, steps) : of(current);
      }),
    );
  }
}

/** Which types may hold which: the screen edits all pairs at once, the API stores them per parent type. */
@Injectable({ providedIn: 'root' })
export class HierarchyRulesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly types = inject(WorkItemTypesApi);

  get(): Observable<{ readonly pairs: readonly HierarchyPair[] }> {
    return this.http.get<{ readonly pairs: readonly HierarchyPair[] }>(`${this.baseUrl}/hierarchy-rules`);
  }

  save(pairs: readonly HierarchyPair[]): Observable<{ readonly pairs: readonly HierarchyPair[] }> {
    return this.types.all().pipe(
      switchMap((types) => {
        const changes = types
          .map((type) => ({ type, children: pairs.filter((p) => p.parentTypeId === type.id).map((p) => p.childTypeId) }))
          .filter(({ type, children }) => [...children].sort().join() !== [...type.allowedChildTypeIds].sort().join());
        return changes.length
          ? forkJoin(changes.map(({ type, children }) => this.types.update(type.id, { version: type.version, allowedChildTypeIds: children })))
          : of([]);
      }),
      switchMap(() => this.get()),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class RelationTypesApi extends BaseApiService<RelationType> {
  protected readonly resource = 'relation-types';
}

@Injectable({ providedIn: 'root' })
export class RelationsApi extends BaseApiService<WorkItemRelation> {
  protected readonly resource = 'relations';

  forWorkItem(workItemId: string): Observable<readonly WorkItemRelation[]> {
    return this.http.get<readonly WorkItemRelation[]>(`${this.root()}/work-items/${encodeURIComponent(workItemId)}/relations`);
  }

  forProject(projectId: string): Observable<readonly WorkItemRelation[]> {
    return this.http.get<readonly WorkItemRelation[]>(`${this.root()}/projects/${encodeURIComponent(projectId)}/relations`);
  }

  /** A link has no version of its own: it is created and removed, never edited. */
  override remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`);
  }

  private root(): string {
    return this.url.slice(0, this.url.lastIndexOf('/'));
  }
}

@Injectable({ providedIn: 'root' })
export class WorkItemTypeLookup extends LookupStore<WorkItemType> {
  protected readonly api = inject(WorkItemTypesApi);
}

@Injectable({ providedIn: 'root' })
export class RelationTypeLookup extends LookupStore<RelationType> {
  protected readonly api = inject(RelationTypesApi);
}

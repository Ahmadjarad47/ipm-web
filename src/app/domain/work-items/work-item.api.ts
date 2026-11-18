import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { BaseApiService } from '@core/api/base-api.service';
import { UpdateDto } from '@core/models/entity.model';
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

  /** Server validates the transition, permissions and blocking rules (FR-WF-05). */
  transition(id: string, request: TransitionRequest): Observable<WorkItem> {
    return this.action(id, 'transition', request);
  }

  /** Closes through the Done-category transition of the current status (TSK-08). */
  close(id: string, request: CloseRequest): Observable<WorkItem> {
    return this.action(id, 'close', request);
  }

  /** Reopens a closed/cancelled item; a comment is mandatory. */
  reopen(id: string, request: ReopenRequest): Observable<WorkItem> {
    return this.action(id, 'reopen', request);
  }

  /** Every non-archived item of the project in lean form, so the Kanban is complete (FR-TSK-05). */
  board(projectId: string): Observable<readonly BoardItem[]> {
    return this.http.get<readonly BoardItem[]>(`${this.url}/board`, { params: new HttpParams().set('projectId', projectId) });
  }

  setParent(id: string, parentId: string | null, version: number): Observable<WorkItem> {
    return this.action(id, 'parent', { parentId, version });
  }

  /** Dry run: returns conflicts without changing anything (FR-TYP-08). */
  checkTypeChange(id: string, typeId: string): Observable<readonly TypeChangeConflict[]> {
    return this.action(id, 'type-change/check', { typeId });
  }

  changeType(id: string, typeId: string, version: number): Observable<WorkItem> {
    return this.action(id, 'type-change', { typeId, version });
  }

  /**
   * Applies one action to many items. Each item is checked on its own (permissions, workflow),
   * so the result reports success or the rejection reason per item — never all-or-nothing silently.
   */
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

  /** Read-only preview before disabling or re-binding (FR-TYP-09). */
  impact(id: string): Observable<ImpactInfo> {
    return this.http.get<ImpactInfo>(`${this.url}/${encodeURIComponent(id)}/impact`);
  }
}

/** Parent -> child type rules as explicit pairs (FR-REL-01). */
@Injectable({ providedIn: 'root' })
export class HierarchyRulesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  get(): Observable<{ readonly pairs: readonly HierarchyPair[] }> {
    return this.http.get<{ readonly pairs: readonly HierarchyPair[] }>(`${this.baseUrl}/hierarchy-rules`);
  }

  /** Replaces the full list; needs `workitem.types.manage`. */
  save(pairs: readonly HierarchyPair[]): Observable<{ readonly pairs: readonly HierarchyPair[] }> {
    return this.http.put<{ readonly pairs: readonly HierarchyPair[] }>(`${this.baseUrl}/hierarchy-rules`, { pairs });
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
    return this.http.get<readonly WorkItemRelation[]>(`${this.url}/by-item/${encodeURIComponent(workItemId)}`);
  }

  /** All relations between items of one project (for the dependency graph, FR-REL-09). */
  forProject(projectId: string): Observable<readonly WorkItemRelation[]> {
    return this.http.get<readonly WorkItemRelation[]>(`${this.url}/by-project/${encodeURIComponent(projectId)}`);
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

import { inject, Injectable } from '@angular/core';
import { map, Observable, switchMap } from 'rxjs';
import { BaseApiService } from '@core/api/base-api.service';
import { asPage, ifMatch } from '@core/api/query-params';
import { ListQuery, PagedResult, UpdateDto } from '@core/models/entity.model';
import { LookupStore } from '@core/state/lookup.store';
import {
  MemberWarning,
  Project,
  ProjectCreate,
  ProjectMember,
  ProjectMembersResult,
  ProjectSummary,
  ProjectTransitionRequest,
  Repository,
  RepositoryConnect,
  RotatedSecret,
} from './project.models';

/** A project as the list and the single read return it: the Git repositories are a resource of their own. */
type ServerProject = Omit<ProjectSummary, 'repositories'> & { readonly repositories?: readonly Repository[] };

@Injectable({ providedIn: 'root' })
export class ProjectsApi extends BaseApiService<ProjectSummary, ProjectCreate, UpdateDto<Project>> {
  protected readonly resource = 'projects';

  private static readonly noRepositories: readonly Repository[] = [];

  override list(query: ListQuery<ProjectSummary>): Observable<PagedResult<ProjectSummary>> {
    return this.http
      .get<PagedResult<ServerProject> | readonly ServerProject[]>(this.url, { params: this.toParams(query) })
      .pipe(map((r) => asPage(r)), map((page) => ({ ...page, items: page.items.map((p) => ({ ...p, repositories: p.repositories ?? ProjectsApi.noRepositories })) })));
  }

  /** The project with its Git repositories (the API includes them for those who hold git.view). */
  override getById(id: string): Observable<ProjectSummary> {
    return this.http.get<ServerProject>(`${this.url}/${encodeURIComponent(id)}`).pipe(map((p) => this.withoutRepositories(p)));
  }

  override create(payload: ProjectCreate): Observable<ProjectSummary> {
    return this.http.post<ServerProject>(this.url, payload).pipe(map((p) => ({ ...p, repositories: ProjectsApi.noRepositories })));
  }

  protected override toUpdateBody(m: ProjectSummary): unknown {
    return { name: m.name, description: m.description, startDate: m.startDate, endDate: m.endDate, ownerId: m.ownerId, code: m.code, statusId: m.statusId };
  }

  /** Workflow-checked status change; may require an approved request first. */
  transition(id: string, request: ProjectTransitionRequest): Observable<ProjectSummary> {
    return this.action<ProjectTransitionRequest, ServerProject>(id, 'transition', request).pipe(switchMap(() => this.getById(id)));
  }

  setArchived(id: string, archived: boolean, version: number): Observable<ProjectSummary> {
    return this.action<{ version: number }, ServerProject>(id, archived ? 'archive' : 'unarchive', { version }).pipe(switchMap(() => this.getById(id)));
  }

  /** Replaces the whole member list; the answer carries warnings (e.g. a removed member who still holds assigned items). */
  setMembers(id: string, members: readonly ProjectMember[], version: number): Observable<ProjectMembersResult> {
    return this.http
      .put<{ readonly project: ServerProject; readonly warnings?: readonly MemberWarning[] }>(`${this.url}/${encodeURIComponent(id)}/members`, { members }, { headers: ifMatch(version) })
      .pipe(switchMap((r) => this.getById(id).pipe(map((project) => ({ ...project, warnings: r.warnings })))));
  }

  setWorkflowOverrides(id: string, overrides: Readonly<Record<string, string>>, version: number): Observable<ProjectSummary> {
    return this.http
      .put<ServerProject>(`${this.url}/${encodeURIComponent(id)}/workflow-overrides`, { overrides }, { headers: ifMatch(version) })
      .pipe(switchMap(() => this.getById(id)));
  }

  configureTypes(id: string, allowedTypeIds: readonly string[], defaultTypeId: string, version: number): Observable<ProjectSummary> {
    return this.http
      .put<ServerProject>(`${this.url}/${encodeURIComponent(id)}/work-item-types`, { allowedTypeIds, defaultTypeId }, { headers: ifMatch(version) })
      .pipe(switchMap(() => this.getById(id)));
  }

  /** The pattern that finds work item refs in commit messages; `null` goes back to the default. */
  setRefPattern(id: string, refPattern: string | null, version?: number): Observable<ProjectSummary> {
    const put = (v: number) =>
      this.http.put<ServerProject>(`${this.url}/${encodeURIComponent(id)}/ref-pattern`, { refPattern }, { headers: ifMatch(v) });
    return (version === undefined ? this.getById(id).pipe(switchMap((p) => put(p.version))) : put(version)).pipe(switchMap(() => this.getById(id)));
  }

  // ---- Git repositories: a resource of the project; each change answers with the project as the screens expect it ----

  connectRepository(id: string, payload: RepositoryConnect): Observable<ProjectSummary> {
    return this.http.post<Repository>(`${this.url}/${encodeURIComponent(id)}/repositories`, payload).pipe(switchMap(() => this.getById(id)));
  }

  disconnectRepository(id: string, repositoryId: string): Observable<ProjectSummary> {
    return this.http
      .post<Repository>(`${this.url}/${encodeURIComponent(id)}/repositories/${encodeURIComponent(repositoryId)}/disconnect`, {})
      .pipe(switchMap(() => this.getById(id)));
  }

  syncRepository(id: string, repositoryId: string): Observable<ProjectSummary> {
    return this.http.post<unknown>(`${this.url}/${encodeURIComponent(id)}/git-sync`, { repositoryId }).pipe(switchMap(() => this.getById(id)));
  }

  rotateSecret(id: string, repositoryId: string): Observable<RotatedSecret> {
    return this.http.post<RotatedSecret>(`${this.url}/${encodeURIComponent(id)}/repositories/${encodeURIComponent(repositoryId)}/rotate-secret`, {});
  }

  private withoutRepositories(project: ServerProject): ProjectSummary {
    return { ...project, repositories: project.repositories ?? ProjectsApi.noRepositories };
  }
}

@Injectable({ providedIn: 'root' })
export class ProjectLookup extends LookupStore<ProjectSummary> {
  protected readonly api = inject(ProjectsApi);
}

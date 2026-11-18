import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseApiService } from '@core/api/base-api.service';
import { UpdateDto } from '@core/models/entity.model';
import { LookupStore } from '@core/state/lookup.store';
import { Project, ProjectCreate, ProjectMember, ProjectMembersResult, ProjectSummary, ProjectTransitionRequest, RepositoryConnect, RotatedSecret } from './project.models';

@Injectable({ providedIn: 'root' })
export class ProjectsApi extends BaseApiService<ProjectSummary, ProjectCreate, UpdateDto<Project>> {
  protected readonly resource = 'projects';

  /** Workflow-checked status change; may require an approved request first. */
  transition(id: string, request: ProjectTransitionRequest): Observable<ProjectSummary> {
    return this.action(id, 'transition', request);
  }

  setArchived(id: string, archived: boolean, version: number): Observable<ProjectSummary> {
    return this.action(id, archived ? 'archive' : 'unarchive', { version });
  }

  setMembers(id: string, members: readonly ProjectMember[], version: number): Observable<ProjectMembersResult> {
    return this.action(id, 'members', { members, version });
  }

  /** FR-WF-10: needs `workflows.manage` and `project.workitemtypes.configure`; empty map clears all overrides. */
  setWorkflowOverrides(id: string, overrides: Readonly<Record<string, string>>, version: number): Observable<ProjectSummary> {
    return this.action(id, 'workflow-overrides', { overrides, version });
  }

  syncRepository(id: string, repositoryId: string): Observable<ProjectSummary> {
    return this.action(id, 'git-sync', { repositoryId });
  }

  /** FR-GIT-01: needs `git.manage`. */
  connectRepository(id: string, payload: RepositoryConnect): Observable<ProjectSummary> {
    return this.action(id, 'repositories', payload);
  }

  /** FR-GIT-09: disconnects but keeps past links and events. */
  disconnectRepository(id: string, repositoryId: string): Observable<ProjectSummary> {
    return this.action(id, `repositories/${encodeURIComponent(repositoryId)}/disconnect`, {});
  }

  /** FR-GIT-09/§7.2: returns the new webhook secret exactly once. */
  rotateSecret(id: string, repositoryId: string): Observable<RotatedSecret> {
    return this.http.post<RotatedSecret>(`${this.url}/${encodeURIComponent(id)}/repositories/${encodeURIComponent(repositoryId)}/rotate-secret`, {});
  }

  /** FR-GIT-03: set (or clear with null) the project's custom ref pattern. */
  setRefPattern(id: string, refPattern: string | null): Observable<ProjectSummary> {
    return this.action(id, 'ref-pattern', { refPattern });
  }

  /** FR-TYP-04: types offered in this project and the default for new items. */
  configureTypes(id: string, allowedTypeIds: readonly string[], defaultTypeId: string, version: number): Observable<ProjectSummary> {
    return this.update(id, { allowedTypeIds, defaultTypeId, version });
  }
}

@Injectable({ providedIn: 'root' })
export class ProjectLookup extends LookupStore<ProjectSummary> {
  protected readonly api = inject(ProjectsApi);
}

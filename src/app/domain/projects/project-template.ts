import { inject, Injectable } from '@angular/core';
import { BaseApiService } from '@core/api/base-api.service';
import { Entity } from '@core/models/entity.model';
import { LookupStore } from '@core/state/lookup.store';

/**
 * Project template (FR-PRJ-10): presets applied once at project creation.
 * Changing a template never touches projects already created from it.
 */
export interface ProjectTemplate extends Entity {
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly allowedTypeIds: readonly string[];
  readonly defaultTypeId: string;
  /** Initial project status (must belong to the project workflow). */
  readonly initialStatusId: string;
  /** Suggested project roles to pre-fill when adding members. */
  readonly suggestedRoleIds: readonly string[];
  /** Default project duration used to pre-fill the end date. */
  readonly durationDays: number;
  /** Members added automatically on project creation (inactive users are skipped). */
  readonly suggestedMembers?: readonly { readonly userId?: string; readonly roleId: string }[];
}

@Injectable({ providedIn: 'root' })
export class ProjectTemplatesApi extends BaseApiService<ProjectTemplate> {
  protected readonly resource = 'project-templates';
}

@Injectable({ providedIn: 'root' })
export class ProjectTemplateLookup extends LookupStore<ProjectTemplate> {
  protected readonly api = inject(ProjectTemplatesApi);
}

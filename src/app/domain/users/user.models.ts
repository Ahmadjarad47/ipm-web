import { PermissionKey, PermissionScope } from '@core/auth/permissions';
import { Entity } from '@core/models/entity.model';

export interface User extends Entity {
  readonly username: string;
  readonly name: string;
  readonly email: string;
  readonly title: string;
  readonly active: boolean;
  /** System-scope roles. Project roles live on `ProjectMember`. */
  readonly systemRoleIds: readonly string[];
  /** Direct manager; resolves the `direct_manager` approval position (FR-APR-02). */
  readonly managerId?: string;
}

export interface Role extends Entity {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly scope: PermissionScope;
  readonly permissions: readonly PermissionKey[];
  readonly denied: readonly PermissionKey[];
  /** Seeded roles cannot be deleted, only edited. */
  readonly builtIn: boolean;
  /** List counters: the roles list carries counts instead of the permission arrays (those come with the single read). */
  readonly permissionCount?: number;
  /** Accounts holding this role as a system role (the server does not count project memberships). */
  readonly userCount?: number;
}

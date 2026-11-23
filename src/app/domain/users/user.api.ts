import { HttpParams, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { concatMap, from, last, map, Observable, of, switchMap } from 'rxjs';
import { BaseApiService } from '@core/api/base-api.service';
import { asPage, ifMatch } from '@core/api/query-params';
import { ListQuery, PagedResult, UpdateDto } from '@core/models/entity.model';
import { LookupStore } from '@core/state/lookup.store';
import { Role, User } from './user.models';

/** A user as the API names it (`isActive`, a `version` only on the single-record read). */
interface ServerUser {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly email?: string;
  readonly title?: string | null;
  readonly isActive: boolean;
  readonly managerId?: string | null;
  readonly systemRoleIds?: readonly string[];
  readonly version?: number;
}

const toUser = (s: ServerUser): User => ({
  id: s.id,
  username: s.username,
  name: s.name,
  email: s.email ?? '',
  title: s.title ?? '',
  active: s.isActive,
  systemRoleIds: s.systemRoleIds ?? [],
  managerId: s.managerId ?? undefined,
  version: s.version ?? 0,
  createdAt: '',
  updatedAt: '',
});

@Injectable({ providedIn: 'root' })
export class UsersApi extends BaseApiService<User, UserCreate> {
  protected readonly resource = 'users';

  override list(query: ListQuery<User>): Observable<PagedResult<User>> {
    return this.http
      .get<PagedResult<ServerUser> | readonly ServerUser[]>(this.url, { params: this.toParams(query) })
      .pipe(map((r) => asPage(r)), map((page) => ({ ...page, items: page.items.map(toUser) })));
  }

  /** Who exists, for names and pickers: the directory every signed-in user may read (the full list needs roles.manage). */
  override all(): Observable<readonly User[]> {
    return this.http.get<readonly ServerUser[]>(`${this.url}/directory`).pipe(map((users) => users.map(toUser)));
  }

  override getById(id: string): Observable<User> {
    return this.http.get<ServerUser>(`${this.url}/${encodeURIComponent(id)}`).pipe(map(toUser));
  }

  override create(payload: UserCreate): Observable<User> {
    return this.http.post<ServerUser>(this.url, payload).pipe(map(toUser));
  }

  /**
   * One screen edit is up to three API calls (profile, roles, activation); each moves the record's version, so they run in
   * order and every call carries the version the one before it produced.
   */
  override update(id: string, payload: UpdateDto<User>): Observable<User> {
    const { version, name, email, title, managerId, systemRoleIds, active } = payload;
    return this.getById(id).pipe(
      switchMap((current) => {
        const steps: ((v: number) => Observable<number>)[] = [];
        if (name !== undefined || email !== undefined || title !== undefined || managerId !== undefined) {
          steps.push((v) => this.step('PUT', id, '', { name: name ?? current.name, email: email ?? current.email, title: title ?? current.title, managerId: managerId ?? current.managerId ?? null }, v));
        }
        if (systemRoleIds !== undefined) steps.push((v) => this.step('PUT', id, '/roles', { systemRoleIds }, v));
        if (active !== undefined && active !== current.active) steps.push((v) => this.step('POST', id, active ? '/activate' : '/deactivate', {}, v));
        if (!steps.length) return of(current);
        return from(steps).pipe(
          concatMap((run, i) => (i === 0 ? run(version ?? current.version) : of(0).pipe(switchMap(() => this.getById(id)), switchMap((fresh) => run(fresh.version))))),
          last(),
          switchMap(() => this.getById(id)),
        );
      }),
    );
  }

  /** The admin sets a new password; the user must change it at the next sign-in. */
  resetPassword(id: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.url}/${encodeURIComponent(id)}/reset-password`, { newPassword });
  }

  private step(method: 'PUT' | 'POST', id: string, path: string, body: unknown, version: number): Observable<number> {
    const url = `${this.url}/${encodeURIComponent(id)}${path}`;
    const options = { headers: ifMatch(version), observe: 'response' as const };
    const call = method === 'PUT' ? this.http.put<unknown>(url, body, options) : this.http.post<unknown>(url, body, options);
    return call.pipe(map((r: HttpResponse<unknown>) => Number(r.headers.get('ETag')?.replaceAll('"', '') ?? version)));
  }
}

/** Internal account creation (FR-AUTH-02). The administrator sets the first password; the user must replace it at first sign-in. */
export type UserCreate = Pick<User, 'username' | 'name' | 'email' | 'title' | 'systemRoleIds'> & { readonly password: string };

/** A role as the API names it: the list carries counts, the single read carries the permissions. */
interface ServerRole {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly scope: Role['scope'];
  readonly isBuiltIn: boolean;
  readonly permissions?: Role['permissions'];
  readonly denied?: Role['denied'];
  readonly permissionCount?: number;
  readonly userCount?: number;
  readonly version?: number;
}

const toRole = (s: ServerRole): Role => ({
  id: s.id,
  key: s.key,
  name: s.name,
  description: s.description ?? '',
  scope: s.scope,
  permissions: s.permissions ?? [],
  denied: s.denied ?? [],
  builtIn: s.isBuiltIn,
  version: s.version ?? 0,
  createdAt: '',
  updatedAt: '',
});

@Injectable({ providedIn: 'root' })
export class RolesApi extends BaseApiService<Role> {
  protected readonly resource = 'roles';

  override list(query: ListQuery<Role>): Observable<PagedResult<Role>> {
    return this.http
      .get<PagedResult<ServerRole> | readonly ServerRole[]>(this.url, { params: this.toParams(query) })
      .pipe(map((r) => asPage(r)), map((page) => ({ ...page, items: page.items.map(toRole) })));
  }

  override all(): Observable<readonly Role[]> {
    return this.http.get<PagedResult<ServerRole> | readonly ServerRole[]>(this.url, { params: new HttpParams().set('page', 1).set('pageSize', 200) }).pipe(map((r) => asPage(r).items.map(toRole)));
  }

  override getById(id: string): Observable<Role> {
    return this.http.get<ServerRole>(`${this.url}/${encodeURIComponent(id)}`).pipe(map(toRole));
  }

  protected override toUpdateBody(merged: Role): unknown {
    return { name: merged.name, description: merged.description, permissions: merged.permissions, denied: merged.denied, scope: merged.scope };
  }
}

@Injectable({ providedIn: 'root' })
export class UserLookup extends LookupStore<User> {
  protected readonly api = inject(UsersApi);

  nameOf(id: string | null | undefined): string {
    return this.get(id)?.name ?? '—';
  }
}

@Injectable({ providedIn: 'root' })
export class RoleLookup extends LookupStore<Role> {
  protected readonly api = inject(RolesApi);
}

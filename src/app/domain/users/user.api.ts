import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseApiService } from '@core/api/base-api.service';
import { LookupStore } from '@core/state/lookup.store';
import { Role, User } from './user.models';

@Injectable({ providedIn: 'root' })
export class UsersApi extends BaseApiService<User, UserCreate> {
  protected readonly resource = 'users';

  /** FR-AUTH-02: the server mints a one-time reset link; no password ever travels through the admin UI. */
  resetPassword(id: string): Observable<PasswordResetLink> {
    return this.http.post<PasswordResetLink>(`${this.url}/${id}/reset-password`, {});
  }
}

export interface PasswordResetLink {
  readonly link: string;
  readonly expiresAt: string;
}

/** Internal account creation (FR-AUTH-02). No password here: the user sets it via the identity flow. */
export type UserCreate = Pick<User, 'username' | 'name' | 'email' | 'title' | 'systemRoleIds'>;

@Injectable({ providedIn: 'root' })
export class RolesApi extends BaseApiService<Role> {
  protected readonly resource = 'roles';
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

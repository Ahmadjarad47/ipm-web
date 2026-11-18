import { inject, Injectable } from '@angular/core';
import { EntityListStore } from '@core/state/entity-list.store';
import { UsersApi } from '@domain/users/user.api';
import { User } from '@domain/users/user.models';

/** Paged user list; provided by `UsersTab` so each visit owns its own query state. */
@Injectable()
export class UserListStore extends EntityListStore<User> {
  protected readonly api = inject(UsersApi);
}

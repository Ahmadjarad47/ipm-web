import { computed, Directive, inject } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { BaseApiService } from '@core/api/base-api.service';
import { AuthSession } from '@core/auth/auth.models';
import { AuthService } from '@core/auth/auth.service';
import { Entity } from '@core/models/entity.model';

/**
 * Generic cached lookup (statuses, types, users, roles...).
 * Loads `all()` once per app session and exposes an id → entity map for O(1) rendering.
 * Concrete lookups are `providedIn: 'root'` singletons.
 */
@Directive()
export abstract class LookupStore<T extends Entity> {
  protected abstract readonly api: BaseApiService<T, unknown, unknown>;

  private readonly auth = inject(AuthService);

  /**
   * Keyed on the session: lookups are visibility-filtered per user, so they are dropped on logout
   * and re-fetched on login or when grants are refreshed — never shown to the next user.
   */
  private readonly resource = rxResource<readonly T[], AuthSession | undefined>({
    params: () => this.auth.session() ?? undefined,
    stream: () => this.api.all(),
    defaultValue: [],
  });

  readonly items = computed(() => this.resource.value());
  readonly loading = this.resource.isLoading;
  /** Last load failure (undefined while healthy); lets tabs render an error state with `reload()`. */
  readonly error = computed(() => this.resource.error());
  readonly byId = computed(() => new Map(this.items().map((item) => [item.id, item])));

  get(id: string | null | undefined): T | undefined {
    return id ? this.byId().get(id) : undefined;
  }

  reload(): void {
    this.resource.reload();
  }
}

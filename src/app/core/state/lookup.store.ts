import { computed, Directive, inject } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { BaseApiService } from '@core/api/base-api.service';
import { AuthService } from '@core/auth/auth.service';
import { Entity } from '@core/models/entity.model';
import { Invalidatable, LookupRegistry } from './lookup-registry';

/**
 * Generic cached lookup (statuses, types, users, roles...).
 * Loads `all()` once per app session and exposes an id → entity map for O(1) rendering.
 * Concrete lookups are `providedIn: 'root'` singletons.
 */
@Directive()
export abstract class LookupStore<T extends Entity> implements Invalidatable {
  protected abstract readonly api: BaseApiService<T, unknown, unknown>;

  private readonly auth = inject(AuthService);

  /** Other resources whose changes also make this lookup stale (e.g. project progress moves with work items). */
  protected readonly alsoDependsOn: readonly string[] = [];

  constructor() {
    inject(LookupRegistry).register(this);
  }

  /**
   * Keyed on the session: lookups are visibility-filtered per user, so they are dropped on logout
   * and re-fetched on login or when grants are refreshed — never shown to the next user.
   */
  private readonly resource = rxResource<readonly T[], string | undefined>({
    // Keyed by who is signed in, not by the session object: a silent token renewal must not reload every lookup.
    params: () => this.auth.user()?.id,
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

  /** The resources this lookup is built from: its own, and those named in `alsoDependsOn`. */
  dependsOn(): readonly string[] {
    return [this.api.resourceName, ...this.alsoDependsOn];
  }

  reload(): void {
    this.resource.reload();
  }
}

import { Injectable } from '@angular/core';

/** A cache that can be told its source changed (every `LookupStore` is one). */
export interface Invalidatable {
  /** The API resources (first path segment, e.g. `projects`, `work-items`) whose changes make this cache stale. */
  dependsOn(): readonly string[];
  reload(): void;
}

/** After this long hidden, a tab refreshes every cache when it comes back (somebody else may have changed things meanwhile). */
const STALE_AFTER_HIDDEN_MS = 2 * 60_000;
/** Several calls of one screen action (e.g. a user edit is three requests) refresh once, not three times. */
const COALESCE_MS = 60;

/**
 * Keeps the cached lookups honest. A successful write (POST/PUT/PATCH/DELETE) on a resource reloads every lookup that depends on it,
 * so a screen never shows what existed before the change; and a tab that was in the background for a while refreshes on return.
 * Screens no longer have to remember which lookups to reload after each save.
 */
@Injectable({ providedIn: 'root' })
export class LookupRegistry {
  private readonly stores = new Set<Invalidatable>();
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hiddenAt: number | null = null;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
      } else if (this.hiddenAt !== null && Date.now() - this.hiddenAt > STALE_AFTER_HIDDEN_MS) {
        this.hiddenAt = null;
        this.stores.forEach((store) => store.reload());
      }
    });
  }

  register(store: Invalidatable): void {
    this.stores.add(store);
  }

  /** A resource changed on the server: reload what depends on it (once, after the burst of calls settles). */
  invalidate(resource: string): void {
    this.pending.add(resource);
    this.timer ??= setTimeout(() => {
      const changed = new Set(this.pending);
      this.pending.clear();
      this.timer = null;
      this.stores.forEach((store) => {
        if (store.dependsOn().some((r) => changed.has(r))) store.reload();
      });
    }, COALESCE_MS);
  }
}

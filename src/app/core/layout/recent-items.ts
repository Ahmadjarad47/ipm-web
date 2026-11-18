import { computed, inject, Injectable, linkedSignal, untracked } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';

export interface RecentItem {
  readonly kind: 'project' | 'workItem' | 'approval';
  readonly id: string;
  readonly title: string;
  /** Short reference such as `ERP-104`. */
  readonly code?: string;
  readonly link: string;
  readonly typeId?: string;
}

const MAX_RECENT = 5;

function load(key: string): readonly RecentItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return (parsed as RecentItem[])
      .filter((x) => typeof x?.id === 'string' && typeof x.link === 'string' && typeof x.title === 'string')
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/**
 * The last entities the user opened, newest first (per user, localStorage `ipm.recent.<userId>`).
 * Detail pages call `recent.add({ kind, id, title, code, link })` once their entity has loaded;
 * the command palette lists them when the query is empty.
 */
@Injectable({ providedIn: 'root' })
export class RecentItems {
  private readonly auth = inject(AuthService);
  private readonly key = computed(() => `ipm.recent.${this.auth.user()?.id ?? 'anon'}`);
  private readonly state = linkedSignal<string, readonly RecentItem[]>({ source: this.key, computation: load });

  readonly items = this.state.asReadonly();

  /**
   * Safe to call from an `effect()`: it reads and writes the same signal, so the read is untracked —
   * otherwise the calling effect would depend on what it writes and re-run forever (a browser freeze).
   */
  add(item: RecentItem): void {
    untracked(() => {
      const current = this.state();
      // Opening the same entity again at the top is a no-op: avoids a pointless write and re-render.
      if (current[0]?.kind === item.kind && current[0].id === item.id && current[0].title === item.title) return;
      const next = [item, ...current.filter((x) => !(x.kind === item.kind && x.id === item.id))].slice(0, MAX_RECENT);
      this.state.set(next);
      this.persist(next);
    });
  }

  clear(): void {
    this.state.set([]);
    this.persist([]);
  }

  private persist(list: readonly RecentItem[]): void {
    try {
      localStorage.setItem(this.key(), JSON.stringify(list));
    } catch {
      /* storage unavailable — list lasts for this tab only */
    }
  }
}

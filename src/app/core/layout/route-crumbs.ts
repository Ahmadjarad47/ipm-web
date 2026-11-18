import { inject, Injectable, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

export interface RouteCrumb {
  readonly label: string;
  readonly link?: string;
}

/** Route `data` key holding the full breadcrumb trail of that route. */
export const ROUTE_CRUMBS = 'crumbs';

/**
 * Breadcrumbs for the shell. Contract for route configs:
 *
 *   { path: 'projects', data: { crumbs: [{ label: 'الرئيسية', link: '/dashboard' }, { label: 'المشاريع' }] } }
 *
 * `data.crumbs` is the FULL trail (last item = current page, no link). The deepest route in the active
 * chain that defines it wins. Detail pages with dynamic names can call `RouteCrumbs.set([...])` once loaded;
 * it is cleared on the next navigation. The shell renders the trail unless a `<app-page-header [crumbs]>`
 * on the page already shows its own (see `registerPageOwned`).
 */
@Injectable({ providedIn: 'root' })
export class RouteCrumbs {
  private readonly router = inject(Router);
  private readonly _crumbs = signal<readonly RouteCrumb[]>([]);
  private readonly override = signal<readonly RouteCrumb[] | null>(null);
  private readonly owners = signal(0);

  /** Effective trail: runtime override, else the route data. */
  readonly crumbs = () => this.override() ?? this._crumbs();
  /** True while a page header renders crumbs itself. */
  readonly pageOwned = () => this.owners() > 0;

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationStart)).subscribe(() => this.override.set(null));
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this._crumbs.set(RouteCrumbs.fromSnapshot(this.router.routerState.snapshot.root)));
  }

  set(crumbs: readonly RouteCrumb[]): void {
    this.override.set(crumbs);
  }

  /** Called by PageHeader; returns the release function. */
  registerPageOwned(): () => void {
    this.owners.update((n) => n + 1);
    return () => this.owners.update((n) => Math.max(0, n - 1));
  }

  static fromSnapshot(root: ActivatedRouteSnapshot): readonly RouteCrumb[] {
    let found: readonly RouteCrumb[] = [];
    for (let r: ActivatedRouteSnapshot | null = root; r; r = r.firstChild) {
      const own = r.routeConfig?.data?.[ROUTE_CRUMBS] as readonly RouteCrumb[] | undefined;
      if (own) found = own;
    }
    return found;
  }
}

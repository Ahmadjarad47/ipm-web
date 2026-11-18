import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input } from '@angular/core';
import { RouteCrumbs } from '@core/layout/route-crumbs';
import { RouterLink } from '@angular/router';
import { Icon } from '../icon/icon';

export interface Crumb {
  readonly label: string;
  readonly link?: string | readonly unknown[];
}

/** Page title, optional breadcrumbs and an action slot: `<app-page-header title="…"><button …/></app-page-header>` */
@Component({
  selector: 'app-page-header',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="ph">
      <div class="titles">
        @if (crumbs().length) {
          <nav class="crumbs" aria-label="مسار التنقل">
            @for (c of crumbs(); track c.label + (c.link ?? "")) {
              @if (c.link) {
                <a [routerLink]="c.link">{{ c.label }}</a>
              } @else {
                <span>{{ c.label }}</span>
              }
              @if (!$last) {
                <app-icon name="chevronLeft" [size]="14" />
              }
            }
          </nav>
        }
        <h1>{{ title() }}</h1>
        @if (subtitle()) {
          <p class="muted">{{ subtitle() }}</p>
        }
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
  styles: `
    .ph { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-5); flex-wrap: wrap; }
    h1 { font-size: var(--fs-2xl); color: var(--c-emerald-900); }
    .crumbs { display: flex; align-items: center; gap: 4px; font-size: var(--fs-sm); color: var(--c-muted); margin-bottom: 4px; }
    .crumbs a { color: var(--c-muted); } .crumbs a:hover { color: var(--c-emerald-700); }
    .actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly crumbs = input<readonly Crumb[]>([]);

  constructor() {
    // While this header shows crumbs itself, the shell hides its own trail.
    const routeCrumbs = inject(RouteCrumbs);
    let release: (() => void) | null = null;
    effect(() => {
      const owns = this.crumbs().length > 0;
      if (owns && !release) release = routeCrumbs.registerPageOwned();
      else if (!owns && release) {
        release();
        release = null;
      }
    });
    inject(DestroyRef).onDestroy(() => release?.());
  }
}

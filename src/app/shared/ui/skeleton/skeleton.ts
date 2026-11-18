import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SkeletonVariant = 'card' | 'detail' | 'chart' | 'table' | 'lines';

/**
 * Loading placeholder. `<app-skeleton variant="table" [count]="5" />`.
 * Announced once as busy to assistive tech; shimmer is disabled under prefers-reduced-motion.
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-busy': 'true', 'aria-label': 'جارٍ التحميل' },
  template: `
    @switch (variant()) {
      @case ('card') {
        <div class="cards">
          @for (i of items(); track i) {
            <div class="card box"><span class="sk w40"></span><span class="sk h28 w60"></span><span class="sk w80"></span></div>
          }
        </div>
      }
      @case ('detail') {
        <div class="card box">
          <span class="sk h28 w50"></span>
          <span class="sk w30"></span>
          @for (i of items(); track i) {
            <span class="sk" [class.w80]="i % 2 === 0" [class.w60]="i % 2 === 1"></span>
          }
        </div>
      }
      @case ('chart') {
        <div class="card box chart">
          @for (h of bars(); track $index) {
            <span class="sk bar" [style.height.%]="h"></span>
          }
        </div>
      }
      @case ('table') {
        <div class="card box">
          <span class="sk h28"></span>
          @for (i of items(); track i) {
            <span class="sk h16"></span>
          }
        </div>
      }
      @default {
        <div class="lines">
          @for (i of items(); track i) {
            <span class="sk" [class.w80]="i % 3 !== 2" [class.w50]="i % 3 === 2"></span>
          }
        </div>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .box { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-5); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-4); }
    .lines { display: flex; flex-direction: column; gap: var(--s-2); }
    .chart { flex-direction: row; align-items: flex-end; height: 220px; }
    .bar { flex: 1; border-radius: var(--r-sm) var(--r-sm) 0 0; }
    .sk { display: block; height: 12px; width: 100%; border-radius: var(--r-pill); background: linear-gradient(90deg, var(--c-border) 0%, var(--c-surface-2) 50%, var(--c-border) 100%); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
    .h16 { height: 16px; } .h28 { height: 28px; }
    .w30 { width: 30%; } .w40 { width: 40%; } .w50 { width: 50%; } .w60 { width: 60%; } .w80 { width: 80%; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
  `,
})
export class Skeleton {
  readonly variant = input<SkeletonVariant>('lines');
  readonly count = input(4);

  protected readonly items = computed(() => Array.from({ length: Math.max(1, this.count()) }, (_, i) => i));
  protected readonly bars = computed(() => Array.from({ length: Math.max(4, this.count() * 2) }, (_, i) => 30 + ((i * 37) % 60)));
}

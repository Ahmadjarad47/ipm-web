import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold' | 'emerald';

/**
 * Pill badge. Use `tone` for semantic colours or `color` for admin-configured colours
 * (status/type colours come from the database, never hard-coded in components).
 */
@Component({
  selector: 'app-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'badge',
    '[class]': '"badge badge--" + toneClass()',
    '[style.--badge-color]': 'color()',
  },
  template: `@if (dot()) {<span class="dot"></span>}<ng-content />`,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; }
    :host(.badge--success) { background: var(--c-success-bg); color: var(--c-success); }
    :host(.badge--warning) { background: var(--c-warning-bg); color: var(--c-warning); }
    :host(.badge--danger) { background: var(--c-danger-bg); color: var(--c-danger); }
    :host(.badge--info) { background: var(--c-info-bg); color: var(--c-info); }
    :host(.badge--neutral) { background: var(--c-neutral-bg); color: var(--c-neutral); }
    :host(.badge--gold) { background: var(--c-gold-100); color: var(--c-gold-600); }
    :host(.badge--emerald) { background: var(--c-emerald-100); color: var(--c-emerald-800); }
    :host(.badge--custom) { background: color-mix(in srgb, var(--badge-color) 14%, var(--c-surface)); color: color-mix(in srgb, var(--badge-color) 85%, var(--c-text)); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  `,
})
export class Badge {
  protected readonly toneClass = computed(() => (this.color() ? 'custom' : this.variant()));
  readonly variant = input<BadgeTone>('neutral', { alias: 'tone' });
  readonly color = input<string | null | undefined>(null);
  readonly dot = input(false);
}

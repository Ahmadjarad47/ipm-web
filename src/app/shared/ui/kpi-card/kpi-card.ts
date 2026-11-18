import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-kpi-card',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="kpi card" [routerLink]="link()" [queryParams]="queryParams()" [class.disabled]="!link()" [class]="'kpi--' + tone()">
      <span class="ico"><app-icon [name]="icon()" [size]="22" /></span>
      <span class="body">
        <span class="label">{{ label() }}</span>
        <strong class="value">{{ loading() ? '…' : value() }}</strong>
        @if (hint()) {
          <span class="hint">{{ hint() }}</span>
        }
      </span>
    </a>
  `,
  styles: `
    .kpi { display: flex; align-items: center; gap: var(--s-4); padding: var(--s-5); color: inherit; text-decoration: none; transition: transform .15s, box-shadow .15s; }
    .kpi:not(.disabled):hover { transform: translateY(-2px); box-shadow: var(--shadow-md); text-decoration: none; }
    .kpi.disabled { pointer-events: none; }
    .ico { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--r-md); }
    .kpi--emerald .ico { background: var(--c-emerald-100); color: var(--c-emerald-700); }
    .kpi--gold .ico { background: var(--c-gold-100); color: var(--c-gold-600); }
    .kpi--danger .ico { background: var(--c-danger-bg); color: var(--c-danger); }
    .kpi--info .ico { background: var(--c-info-bg); color: var(--c-info); }
    .body { display: flex; flex-direction: column; }
    .label { font-size: var(--fs-sm); color: var(--c-muted); }
    .value { font-size: 28px; line-height: 1.2; color: var(--c-emerald-900); }
    .hint { font-size: var(--fs-xs); color: var(--c-muted); }
  `,
})
export class KpiCard {
  readonly label = input.required<string>();
  readonly value = input.required<number | string>();
  readonly icon = input('dashboard');
  readonly tone = input<'emerald' | 'gold' | 'danger' | 'info'>('emerald');
  readonly hint = input('');
  readonly loading = input(false);
  readonly link = input<string | null>(null);
  readonly queryParams = input<Record<string, string> | null>(null);
}

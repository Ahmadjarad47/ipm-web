import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-kpi-card',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="kpi card" [routerLink]="link()" [queryParams]="queryParams()" [class.disabled]="!link()" [class]="'kpi--' + tone()">
      <span class="top">
        <span class="label">{{ label() }}</span>
        <span class="ico"><app-icon [name]="icon()" [size]="18" /></span>
      </span>
      <strong class="value">{{ loading() ? '…' : value() }}</strong>
      @if (hint()) {
        <span class="hint">{{ hint() }}</span>
      }
    </a>
  `,
  styles: `
    .kpi { position: relative; display: flex; flex-direction: column; gap: var(--s-2); padding: var(--s-5); overflow: hidden; color: inherit; text-decoration: none; transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
    .kpi::before { content: ''; position: absolute; inset-block: 0; inset-inline-start: 0; width: 3px; background: var(--tone, var(--c-emerald-700)); }
    .kpi:not(.disabled):hover { transform: translateY(-2px); box-shadow: var(--shadow-md); text-decoration: none; }
    .kpi.disabled { pointer-events: none; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
    .ico { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px; }
    .kpi--emerald { --tone: var(--c-emerald-700); }
    .kpi--gold { --tone: var(--c-gold-500); }
    .kpi--danger { --tone: var(--c-danger-solid); }
    .kpi--info { --tone: var(--c-info); }
    .kpi--emerald .ico { background: var(--c-emerald-100); color: var(--c-emerald-700); }
    .kpi--gold .ico { background: var(--c-gold-100); color: var(--c-gold-600); }
    .kpi--danger .ico { background: var(--c-danger-bg); color: var(--c-danger); }
    .kpi--info .ico { background: var(--c-info-bg); color: var(--c-info); }
    .label { font-size: var(--fs-sm); color: var(--c-muted); }
    .value { font-size: 28px; line-height: 1.2; font-variant-numeric: tabular-nums; color: var(--c-text); }
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

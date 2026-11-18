import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '@shared/ui/icon/icon';

/** Inline banner for rules the admin must know about (FR-WF-11, §4.3 ...). */
@Component({
  selector: 'app-admin-notice',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'note', '[class.warn]': 'tone() === "warning"' },
  template: `<app-icon [name]="tone() === 'warning' ? 'alert' : 'info'" [size]="18" />
    <div><ng-content /></div>`,
  styles: `
    :host { display: flex; gap: var(--s-3); align-items: flex-start; padding: var(--s-3) var(--s-4); border-radius: var(--r-sm); background: var(--c-info-bg); color: var(--c-info); font-size: var(--fs-sm); line-height: 1.7; }
    :host(.warn) { background: var(--c-warning-bg); color: var(--c-warning); }
    app-icon { margin-top: 3px; }
  `,
})
export class AdminNotice {
  readonly tone = input<'info' | 'warning'>('info');
}

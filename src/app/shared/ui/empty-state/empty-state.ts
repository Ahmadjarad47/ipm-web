import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty" role="status">
      <span class="ico"><app-icon [name]="icon()" [size]="26" /></span>
      <strong>{{ title() }}</strong>
      @if (text()) {
        <p class="muted">{{ text() }}</p>
      }
      @if (actionLabel()) {
        <button type="button" class="btn btn--primary" (click)="action.emit()">{{ actionLabel() }}</button>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .empty { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); padding: var(--s-8) var(--s-4); text-align: center; }
    .ico { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--c-gold-100); color: var(--c-gold-600); margin-bottom: var(--s-2); }
    p { max-width: 360px; font-size: var(--fs-sm); }
  `,
})
export class EmptyState {
  readonly icon = input('info');
  readonly title = input.required<string>();
  readonly text = input('');
  /** Convenience CTA; for anything richer project content instead. */
  readonly actionLabel = input('');
  readonly action = output<void>();
}

import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Icon } from '../icon/icon';
import { DialogRef } from './dialog.service';

/**
 * Standard dialog frame. Content goes in the default slot, buttons in `[dialog-actions]`:
 *   <app-dialog-shell title="…"> … <ng-container dialog-actions> … </ng-container></app-dialog-shell>
 */
@Component({
  selector: 'app-dialog-shell',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="dh">
      <div>
        <h2>{{ title() }}</h2>
        @if (subtitle()) {
          <p class="muted">{{ subtitle() }}</p>
        }
      </div>
      <button type="button" class="btn btn--ghost btn--icon" (click)="ref.close()" aria-label="إغلاق">
        <app-icon name="close" />
      </button>
    </header>
    <div class="db"><ng-content /></div>
    <footer class="df"><ng-content select="[dialog-actions]" /></footer>
  `,
  styles: `
    :host { display: flex; flex-direction: column; max-height: calc(100vh - 64px); }
    .dh { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-3); padding: var(--s-5) var(--s-5) var(--s-3); border-bottom: 1px solid var(--c-border); }
    h2 { font-size: var(--fs-xl); color: var(--c-emerald-900); }
    p { font-size: var(--fs-sm); }
    .db { padding: var(--s-5); overflow-y: auto; }
    .df { display: flex; justify-content: flex-end; gap: var(--s-2); padding: var(--s-4) var(--s-5); border-top: 1px solid var(--c-border); background: var(--c-surface-2); }
    .df:empty { display: none; }
  `,
})
export class DialogShell {
  protected readonly ref = inject(DialogRef);
  readonly title = input.required<string>();
  readonly subtitle = input('');
}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '@core/notifications/toast.service';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-toast-host',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="host" aria-live="polite" aria-relevant="additions">
      @for (t of toast.toasts(); track t.id) {
        <div [class]="'toast toast--' + t.kind" [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
          (mouseenter)="toast.pause(t.id)" (mouseleave)="toast.resume(t.id)"
          (focusin)="toast.pause(t.id)" (focusout)="toast.resume(t.id)">
          <app-icon [name]="t.kind === 'success' ? 'checkCircle' : t.kind === 'error' ? 'alert' : 'info'" />
          <span class="msg">{{ t.message }}</span>
          @if (t.action; as a) {
            <button type="button" class="act" (click)="toast.runAction(t.id)">{{ a.label }}</button>
          }
          <button type="button" class="x" (click)="toast.dismiss(t.id)" aria-label="إغلاق"><app-icon name="close" [size]="14" /></button>
        </div>
      }
    </div>
  `,
  styles: `
    .host { position: fixed; inset-block-end: var(--s-5); inset-inline: 0; margin-inline: auto; z-index: 1000; display: flex; flex-direction: column; gap: var(--s-2); width: min(440px, calc(100vw - 32px)); pointer-events: none; }
    .toast { pointer-events: auto; display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--c-ink-1); color: #fff; box-shadow: var(--shadow-lg); animation: up .2s ease-out; }
    .toast--error { background: color-mix(in srgb, var(--c-danger-solid) 80%, black); }
    .toast--success app-icon { color: var(--c-gold-300); }
    .msg { flex: 1; font-size: var(--fs-md); }
    .act { min-height: 44px; min-width: 44px; padding: 0 var(--s-3); border: 1px solid rgb(255 255 255 / 45%); border-radius: var(--r-sm); background: transparent; color: #fff; font-weight: 700; cursor: pointer; }
    .act:hover { background: rgb(255 255 255 / 14%); }
    .x { min-width: 44px; min-height: 44px; border: 0; background: none; color: inherit; opacity: .8; cursor: pointer; display: grid; place-items: center; }
    .toast :focus-visible { box-shadow: 0 0 0 2px var(--c-gold-300); outline: 2px solid transparent; }
    @keyframes up { from { opacity: 0; transform: translateY(8px); } }
  `,
})
export class ToastHost {
  protected readonly toast = inject(ToastService);
}

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Switch used by every admin list to (de)activate a record — config is never deleted (FR-TYP-09, FR-WF-06). */
@Component({
  selector: 'app-active-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="sw">
      <input type="checkbox" role="switch" [checked]="checked()" [disabled]="disabled()" [attr.aria-label]="label()"
        (change)="onChange($event)" />
      <span class="track"></span>
    </label>
  `,
  styles: `
    .sw { position: relative; display: inline-block; width: 38px; height: 22px; cursor: pointer; }
    input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: inherit; }
    .track { position: absolute; inset: 0; border-radius: var(--r-pill); background: var(--c-border-strong); transition: background 0.15s; }
    .track::after { content: ''; position: absolute; top: 3px; inset-inline-start: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: inset-inline-start 0.15s; }
    input:checked + .track { background: var(--c-emerald-600); }
    input:checked + .track::after { inset-inline-start: 19px; }
    input:focus-visible + .track { box-shadow: var(--focus-ring); }
    input:disabled + .track { opacity: 0.5; }
  `,
})
export class ActiveToggle {
  readonly checked = input.required<boolean>();
  readonly label = input('تفعيل');
  readonly disabled = input(false);
  readonly toggled = output<boolean>();

  protected onChange(event: Event): void {
    const box = event.target as HTMLInputElement;
    // Keep the UI bound to the model: the parent re-renders after the server confirms.
    this.toggled.emit(box.checked);
    box.checked = this.checked();
  }
}

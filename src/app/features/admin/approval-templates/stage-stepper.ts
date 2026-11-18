import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface StepperStep {
  readonly name: string;
  readonly approver: string;
  /** Optional SLA label, e.g. «24 ساعة». */
  readonly due?: string;
}

/** Horizontal numbered sequence; the flex direction follows the page (RTL: first stage on the right). */
@Component({
  selector: 'app-stage-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="steps" aria-label="تسلسل مراحل الموافقة">
      @for (s of steps(); track $index) {
        <li class="step">
          <span class="n">{{ $index + 1 }}</span>
          <span class="t">
            <strong>{{ s.name || 'مرحلة بدون اسم' }}</strong>
            <small class="muted">{{ s.approver }}@if (s.due) { · {{ s.due }} }</small>
          </span>
        </li>
      }
    </ol>
  `,
  // Tokens only: `--c-primary` / `--c-on-primary` stay legible in both themes (`--c-emerald-700` is light in dark mode).
  styles: `
    .steps { display: flex; flex-wrap: wrap; align-items: stretch; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
    .step { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-3); border: 1px solid var(--c-border-strong); border-radius: var(--r-pill); background: var(--c-surface); color: var(--c-text); }
    .step:not(:last-child)::after { content: '←'; margin-inline-start: var(--s-2); color: var(--c-gold-600); font-weight: 700; }
    .n { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--c-primary); color: var(--c-on-primary, #fff); font-size: var(--fs-xs); font-weight: 700; flex-shrink: 0; }
    .t { display: flex; flex-direction: column; line-height: 1.3; font-size: var(--fs-sm); }
  `,
})
export class StageStepper {
  readonly steps = input.required<readonly StepperStep[]>();
}

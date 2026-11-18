import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';

let nextId = 0;

/**
 * Focusable "?" with a popover. Opens on click/focus/hover, closes on Esc, blur or outside click.
 *   <label>الحقل <app-help-tip [text]="HELP.progressRule" /></label>
 */
@Component({
  selector: 'app-help-tip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'close($event)',
    '(focusout)': 'onFocusOut($event)',
    '(mouseenter)': 'open.set(true)',
    '(mouseleave)': 'onLeave()',
    '(document:click)': 'onDocClick($event)',
  },
  template: `
    <button type="button" class="q" [attr.aria-label]="label()" [attr.aria-expanded]="open()"
      [attr.aria-describedby]="open() ? id : null" (click)="open.set(true)" (focus)="open.set(true)">?</button>
    @if (open()) {
      <span class="pop" role="tooltip" [id]="id">{{ text() }}</span>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; vertical-align: middle; margin-inline-start: var(--s-1); }
    .q { display: inline-grid; place-items: center; min-width: 24px; min-height: 24px; padding: 0; border: 1px solid var(--c-border-strong); border-radius: 50%; background: var(--c-surface); color: var(--c-emerald-700); font-size: var(--fs-xs); font-weight: 700; cursor: help; }
    .q:hover { background: var(--c-emerald-50); }
    @media (pointer: coarse) { .q { min-width: 44px; min-height: 44px; } }
    .pop { position: absolute; inset-inline-start: 0; top: calc(100% + 6px); z-index: 60; width: max-content; max-width: min(300px, 80vw); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--c-ink-2); color: #fff; font-size: var(--fs-sm); font-weight: 400; line-height: 1.6; box-shadow: var(--shadow-lg); white-space: normal; }
  `,
})
export class HelpTip {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly text = input.required<string>();
  readonly label = input('مساعدة');

  protected readonly id = `help-tip-${++nextId}`;
  protected readonly open = signal(false);

  protected close(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation(); // do not also close a surrounding dialog
    this.open.set(false);
  }

  protected onFocusOut(event: FocusEvent): void {
    if (!this.host.nativeElement.contains(event.relatedTarget as Node | null)) this.open.set(false);
  }

  protected onLeave(): void {
    if (!this.host.nativeElement.contains(document.activeElement)) this.open.set(false);
  }

  protected onDocClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}

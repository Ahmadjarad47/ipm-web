import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';

export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

/**
 * Button + `role="menu"` popup. The trigger content is projected. Esc and outside click close it
 * (focus returns to the trigger on Esc), arrow keys / Home / End move between items.
 */
@Component({
  selector: 'app-action-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)', '(keydown.escape)': 'close(true)' },
  template: `
    <button
      type="button"
      [class]="triggerClass()"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown.arrowdown)="openAndFocus($event)"
    >
      <ng-content />
    </button>
    @if (open()) {
      <ul class="menu" role="menu" [attr.aria-label]="label()" (keydown)="onKey($event)">
        @for (e of entries(); track e.key) {
          <li role="none">
            <button type="button" role="menuitem" tabindex="-1" class="entry" [disabled]="e.disabled" (click)="choose(e)">
              <span>{{ e.label }}</span>
              @if (e.hint) {
                <span class="hint">{{ e.hint }}</span>
              }
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .menu {
      position: absolute;
      inset-inline-start: 0;
      inset-block-start: calc(100% + 4px);
      z-index: 30;
      min-inline-size: 180px;
      margin: 0;
      padding: var(--s-1);
      list-style: none;
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: var(--r-md);
      box-shadow: var(--shadow-md, 0 4px 16px rgb(0 0 0 / 0.12));
    }
    .entry {
      display: flex;
      inline-size: 100%;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      padding: var(--s-2) var(--s-3);
      border: 0;
      border-radius: var(--r-sm);
      background: none;
      color: var(--c-text);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .entry:hover:not(:disabled), .entry:focus-visible { background: var(--c-emerald-50); }
    .entry:disabled { color: var(--c-muted); cursor: not-allowed; }
    .hint { font-size: var(--fs-xs); color: var(--c-muted); }
    .menu { max-inline-size: calc(100vw - 16px); max-block-size: 70vh; overflow-y: auto; }
    @media (pointer: coarse), (max-width: 768px) {
      .entry { min-block-size: 44px; }
    }
  `,
})
export class ActionMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly entries = input.required<readonly MenuEntry[]>();
  /** Accessible name of the button and of the menu. */
  readonly label = input.required<string>();
  readonly triggerClass = input('btn btn--outline');
  readonly disabled = input(false);
  readonly picked = output<string>();

  protected readonly open = signal(false);

  protected toggle(): void {
    if (this.open()) this.close(false);
    else this.openAndFocus();
  }

  protected openAndFocus(event?: Event): void {
    event?.preventDefault();
    this.open.set(true);
    setTimeout(() => this.items()[0]?.focus());
  }

  protected close(restoreFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>('button')?.focus();
  }

  protected choose(entry: MenuEntry): void {
    this.close(true);
    this.picked.emit(entry.key);
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  protected onKey(event: KeyboardEvent): void {
    const items = this.items();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') this.close(false);
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  private items(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
  }
}

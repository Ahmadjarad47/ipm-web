import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, input, output, signal, viewChild } from '@angular/core';
import { Icon } from '@shared/ui/icon/icon';

export interface MenuAction {
  readonly key: string;
  readonly label: string;
  readonly icon?: string;
  readonly danger?: boolean;
}

let nextId = 0;

/**
 * «المزيد» dropdown (WAI-ARIA menu button): Enter/Space/ArrowDown opens, arrows/Home/End move,
 * Esc and outside click close, focus returns to the trigger.
 */
@Component({
  selector: 'app-actions-menu',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocClick($event)', '(keydown.escape)': 'onEscape($event)' },
  template: `
    <button #trigger type="button" class="btn btn--outline" aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? menuId : null"
      (click)="toggle()" (keydown)="onTriggerKey($event)">
      {{ label() }} <app-icon name="chevronDown" [size]="14" />
    </button>
    @if (open()) {
      <div class="menu" role="menu" [id]="menuId" [attr.aria-label]="label()" (keydown)="onMenuKey($event)">
        @for (item of items(); track item.key) {
          <button type="button" role="menuitem" tabindex="-1" class="mi" [class.danger]="item.danger" (click)="choose(item)">
            @if (item.icon) {
              <app-icon [name]="item.icon" [size]="16" />
            }
            {{ item.label }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .menu { position: absolute; inset-inline-end: 0; top: calc(100% + 4px); z-index: 50; display: flex; flex-direction: column; min-width: 220px; padding: var(--s-1); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); box-shadow: var(--shadow-lg); }
    .mi { display: flex; align-items: center; gap: var(--s-2); min-height: 40px; padding: 0 var(--s-3); border: 0; border-radius: var(--r-sm); background: none; color: var(--c-text); font: inherit; text-align: start; cursor: pointer; }
    .mi:hover, .mi:focus-visible { background: var(--c-emerald-50); outline: none; }
    .mi:focus-visible { box-shadow: var(--focus-ring); }
    .mi.danger { color: var(--c-danger); }
    .menu { max-inline-size: calc(100vw - 16px); max-block-size: 70vh; overflow-y: auto; }
    @media (pointer: coarse), (max-width: 768px) {
      .mi { min-height: 44px; }
    }
  `,
})
export class ActionsMenu {
  readonly items = input.required<readonly MenuAction[]>();
  readonly label = input('المزيد');
  readonly select = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly menuId = `actions-menu-${++nextId}`;
  protected readonly open = signal(false);

  protected toggle(): void {
    if (this.open()) this.close(false);
    else this.openMenu(0);
  }

  private openMenu(index: number): void {
    this.open.set(true);
    afterNextRender(() => this.focusItem(index), { injector: this.injector });
  }

  private close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) this.trigger().nativeElement.focus();
  }

  protected choose(item: MenuAction): void {
    this.close(true);
    this.select.emit(item.key);
  }

  private menuItems(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  private focusItem(index: number): void {
    const list = this.menuItems();
    if (!list.length) return;
    list[(index + list.length) % list.length].focus();
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openMenu(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.openMenu(-1);
    }
  }

  protected onMenuKey(event: KeyboardEvent): void {
    const list = this.menuItems();
    const current = list.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusItem(-1);
        break;
      case 'Tab':
        this.close(false);
        break;
    }
  }

  protected onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.close(true);
  }

  protected onDocClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }
}

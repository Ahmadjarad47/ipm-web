import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface TabItem<K extends string = string> {
  readonly key: K;
  readonly label: string;
  readonly count?: number | null;
}

/** Generic, keyboard-accessible tab bar; bind with `[(active)]`. The panel content is rendered by the parent. */
@Component({
  selector: 'app-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist" (keydown)="onKey($event)">
      @for (t of tabs(); track t.key) {
        <button type="button" role="tab" class="tab" [class.active]="t.key === active()" [attr.aria-selected]="t.key === active()"
          [attr.tabindex]="t.key === active() ? 0 : -1" [attr.id]="idPrefix() + t.key" (click)="active.set(t.key)">
          {{ t.label }}
          @if (t.count !== undefined && t.count !== null) {
            <span class="count">{{ t.count }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    .tabs { display: flex; gap: var(--s-1); border-bottom: 1px solid var(--c-border); overflow-x: auto; }
    @media (pointer: coarse), (max-width: 768px) { .tab { min-block-size: 44px; } }
    .tab { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: var(--s-3) var(--s-4); border: 0; background: none; color: var(--c-text-2); font-weight: 600; cursor: pointer; white-space: nowrap; }
    .tab:hover { color: var(--c-emerald-700); }
    .tab.active { color: var(--c-emerald-800); }
    .tab.active::after { content: ''; position: absolute; inset-inline: var(--s-3); bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--c-gold-500); }
    .count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: var(--r-pill); background: var(--c-emerald-50); font-size: 11px; display: inline-grid; place-items: center; }
  `,
})
export class Tabs<K extends string = string> {
  readonly tabs = input.required<readonly TabItem<K>[]>();
  readonly active = model.required<K>();
  /** Prefix for the tab element ids; set a unique one when two tab bars share a page. */
  readonly idPrefix = input('tab-');

  protected onKey(event: KeyboardEvent): void {
    // RTL: ArrowLeft moves forward.
    const delta = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
    if (!delta) return;
    const list = this.tabs();
    const i = list.findIndex((t) => t.key === this.active());
    const next = list[(i + delta + list.length) % list.length];
    this.active.set(next.key);
    (document.getElementById(`${this.idPrefix()}${next.key}`) as HTMLElement | null)?.focus();
  }
}

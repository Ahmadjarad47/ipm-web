import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FilterValue, Sort } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { WorkItem } from '@domain/work-items/work-item.models';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { Icon } from '@shared/ui/icon/icon';
import { ViewMode } from './work-item-filters';

export type { ViewMode } from './work-item-filters';

/** Everything a saved view restores: filters, view mode, sort and search text. */
export interface ViewState {
  readonly filters: Readonly<Record<string, FilterValue>>;
  readonly view: ViewMode;
  readonly sort?: Sort<WorkItem>;
  readonly search?: string;
}

interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly state: ViewState;
}

interface NamedView {
  readonly id: string;
  readonly name: string;
  readonly state: ViewState;
  readonly builtIn: boolean;
}

let nextId = 0;

const storageKey = (userId: string): string => `ipm.views.${userId}`;
const defaultKey = (userId: string): string => `ipm.views.default.${userId}`;

function read(userId: string): readonly SavedView[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedView[]).filter((v) => typeof v?.id === 'string' && typeof v?.name === 'string' && !!v.state) : [];
  } catch {
    return [];
  }
}

function write(userId: string, views: readonly SavedView[]): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(views));
  } catch {
    /* storage unavailable: views live for this session only */
  }
}

interface DefaultView {
  readonly id: string;
  readonly state: ViewState;
}

function readDefault(userId: string): DefaultView | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(defaultKey(userId)) ?? 'null') as DefaultView | null;
    return parsed && typeof parsed.id === 'string' && parsed.state ? parsed : null;
  } catch {
    return null;
  }
}

function writeDefault(userId: string, value: DefaultView | null): void {
  try {
    if (value) localStorage.setItem(defaultKey(userId), JSON.stringify(value));
    else localStorage.removeItem(defaultKey(userId));
  } catch {
    /* storage unavailable: the default is not persisted */
  }
}

/** The user's default saved view, applied when the list opens without URL parameters. */
export function loadDefaultView(userId: string): ViewState | null {
  return readDefault(userId)?.state ?? null;
}

const canonical = (s: ViewState): string =>
  JSON.stringify({ f: Object.entries(s.filters).sort(([a], [b]) => a.localeCompare(b)), v: s.view, s: s.sort ?? null, q: s.search ?? '' });

/** «العروض المحفوظة»: built-in and per-user saved filter sets. Persisted in localStorage when available. */
@Component({
  selector: 'app-views-menu',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)', '(keydown.escape)': 'close(true)' },
  template: `
    <div class="wrap">
      <button type="button" class="btn btn--outline" aria-haspopup="menu" [attr.aria-expanded]="open()" (click)="open.set(!open())">
        <app-icon name="filter" [size]="16" /> العروض المحفوظة
        @if (dirty()) {
          <span class="dirty" aria-hidden="true">●</span>
          <span class="sr-only">(معدّل)</span>
        }
        <app-icon name="chevronDown" [size]="14" />
      </button>
      @if (open()) {
        <div class="menu card">
          <ul class="list" role="menu" aria-label="العروض المحفوظة" (keydown)="onKey($event)">
            @for (v of all(); track v.id) {
              <li class="item" role="none">
                <button type="button" role="menuitem" class="apply" [class.active]="v.id === activeId()" (click)="choose(v)">
                  {{ v.name }}
                  @if (v.id === defaultId()) {
                    <span class="tag">افتراضي</span>
                  }
                </button>
                @if (v.id !== defaultId()) {
                  <button type="button" role="menuitem" class="btn btn--ghost" (click)="makeDefault(v)">تعيين كافتراضي</button>
                } @else {
                  <button type="button" role="menuitem" class="btn btn--ghost" (click)="clearDefault()">إلغاء الافتراضي</button>
                }
                @if (!v.builtIn) {
                  <button type="button" role="menuitem" class="btn btn--ghost btn--icon" [attr.aria-label]="'حذف ' + v.name" (click)="remove(v)">
                    <app-icon name="trash" [size]="14" />
                  </button>
                }
              </li>
            }
          </ul>
          <div class="save">
            <label class="sr-only" [attr.for]="uid + '-name'">اسم العرض</label>
            <input [id]="uid + '-name'" class="input" placeholder="اسم العرض" [(ngModel)]="name" (keydown.enter)="save()" />
            <button type="button" class="btn btn--primary" [disabled]="!name.trim()" (click)="save()">حفظ العرض الحالي</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    .menu { position: absolute; inset-inline-start: 0; inset-block-start: calc(100% + 4px); z-index: 20; min-inline-size: 320px; padding: var(--s-2); box-shadow: var(--shadow-md, 0 4px 16px rgb(0 0 0 / 0.12)); }
    .list { list-style: none; margin: 0; padding: 0; }
    .item { display: flex; align-items: center; gap: var(--s-1); }
    .apply { flex: 1; text-align: start; padding: var(--s-2); background: none; border: 0; border-radius: var(--r-sm); cursor: pointer; font: inherit; color: var(--c-text); }
    .apply:hover, .apply:focus-visible { background: var(--c-emerald-50); }
    .apply.active { font-weight: 700; }
    .tag { margin-inline-start: var(--s-2); font-size: var(--fs-xs); color: var(--c-muted); }
    .dirty { color: var(--c-gold-600); }
    .save { display: flex; gap: var(--s-2); padding-top: var(--s-2); margin-top: var(--s-2); border-top: 1px solid var(--c-border); }
    .save .input { min-inline-size: 0; flex: 1; }
    .save { flex-wrap: wrap; }
    .menu { max-inline-size: calc(100vw - 16px); max-block-size: 70vh; overflow-y: auto; }
    .apply { overflow-wrap: anywhere; }
    @media (max-width: 768px) {
      .menu { min-inline-size: 0; inline-size: calc(100vw - 16px); }
      .item { flex-wrap: wrap; }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .apply, .item .btn, .save .input, .save .btn { min-block-size: 44px; }
      .item .btn--icon { min-inline-size: 44px; }
    }
  `,
})
export class ViewsMenu {
  private readonly statuses = inject(StatusLookup);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly userId = input.required<string>();
  readonly current = input.required<ViewState>();
  readonly apply = output<ViewState>();

  protected readonly open = signal(false);
  protected name = '';
  protected readonly uid = `views-menu-${++nextId}`;
  private readonly saved = signal<readonly SavedView[] | null>(null);
  private readonly defaultOverride = signal<DefaultView | null | undefined>(undefined);
  /** The view last applied or saved; the list is "dirty" when the current state drifts from it. */
  private readonly applied = signal<{ readonly id: string; readonly state: ViewState } | null>(null);

  private readonly stored = computed(() => this.saved() ?? read(this.userId()));
  protected readonly defaultId = computed(() => {
    const override = this.defaultOverride();
    return (override === undefined ? readDefault(this.userId()) : override)?.id ?? null;
  });
  protected readonly activeId = computed(() => this.applied()?.id ?? null);
  protected readonly dirty = computed(() => {
    const applied = this.applied();
    return !!applied && canonical(applied.state) !== canonical(this.current());
  });

  protected readonly all = computed<readonly NamedView[]>(() => {
    const me = this.userId();
    const builtIns: NamedView[] = [
      { id: 'b-mine', name: 'عناصر عملي', builtIn: true, state: { filters: { assigneeIds: [me] }, view: 'table' } },
      { id: 'b-overdue', name: 'المتأخرة', builtIn: true, state: { filters: { overdue: true }, view: 'table' } },
    ];
    const review = this.statuses.items().find((s) => s.scope === 'work-item' && s.key === 'in_review');
    if (review) builtIns.push({ id: 'b-review', name: 'قيد المراجعة', builtIn: true, state: { filters: { statusId: [review.id] }, view: 'table' } });
    return [...builtIns, ...this.stored().map((v) => ({ ...v, builtIn: false }))];
  });

  protected choose(v: NamedView): void {
    this.applied.set({ id: v.id, state: v.state });
    this.apply.emit(v.state);
    this.close(false);
  }

  protected save(): void {
    const name = this.name.trim();
    if (!name) return;
    const view: SavedView = { id: `v-${Date.now()}`, name, state: this.current() };
    const next = [...this.stored().filter((v) => v.name !== name), view];
    this.saved.set(next);
    write(this.userId(), next);
    this.applied.set({ id: view.id, state: view.state });
    this.name = '';
    this.toast.success('تم حفظ العرض');
  }

  protected makeDefault(v: NamedView): void {
    const value: DefaultView = { id: v.id, state: v.state };
    this.defaultOverride.set(value);
    writeDefault(this.userId(), value);
    this.toast.success(`«${v.name}» هو العرض الافتراضي الآن`);
  }

  protected clearDefault(): void {
    this.defaultOverride.set(null);
    writeDefault(this.userId(), null);
  }

  protected remove(v: NamedView): void {
    this.confirm
      .confirm({ title: 'حذف العرض', message: `حذف العرض «${v.name}»؟`, confirmText: 'حذف', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        const before = this.stored();
        const wasDefault = this.defaultId() === v.id;
        this.persist(before.filter((x) => x.id !== v.id));
        if (wasDefault) this.clearDefault();
        this.toast.undoable(`تم حذف العرض «${v.name}»`, () => {
          this.persist(before);
          if (wasDefault) this.makeDefault(v);
        });
      });
  }

  protected close(restoreFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>('button')?.focus();
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  protected onKey(event: KeyboardEvent): void {
    const items = [...this.host.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : -1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  private persist(views: readonly SavedView[]): void {
    this.saved.set(views);
    write(this.userId(), views);
  }
}

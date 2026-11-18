import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { SearchApi, SearchHit } from '@domain/search/search.api';
import { TypeChip } from '@shared/domain-ui/domain-ui';
import { DialogRef } from '@shared/ui/dialog/dialog.service';
import { Icon } from '@shared/ui/icon/icon';
import { NAVIGATION } from './navigation';
import { RecentItems } from './recent-items';
import { Shortcuts } from './shortcuts';

interface PaletteItem {
  readonly key: string;
  readonly icon: string;
  readonly title: string;
  readonly subtitle: string;
  readonly code: string | null;
  readonly link: string;
  readonly typeId?: string;
  readonly group: string;
  /** Runs instead of navigating (actions that are not routes). */
  readonly run?: () => void;
}

const KIND_ICON: Record<SearchHit['kind'], string> = { project: 'folder', workItem: 'list', approval: 'approval', user: 'user' };
const KIND_GROUP: Record<SearchHit['kind'], string> = { project: 'المشاريع', workItem: 'عناصر العمل', approval: 'الموافقات', user: 'المستخدمون' };

/**
 * Global search & navigation (Ctrl/⌘+K). Searches everything the user may see; with an empty
 * query it lists the pages they can open. Fully keyboard driven: ↑/↓, Enter, Esc.
 */
@Component({
  selector: 'app-command-palette',
  imports: [Icon, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="palette" role="combobox" aria-haspopup="listbox" [attr.aria-expanded]="true" aria-owns="cp-list">
      <div class="search">
        <app-icon name="search" />
        <input #input type="text" [value]="query()" (input)="query.set($any($event.target).value); active.set(0)" (keydown)="onKey($event)"
          placeholder="ابحث برمز (ERP-104) أو اسم مشروع أو عنصر…" aria-label="بحث شامل" aria-controls="cp-list"
          [attr.aria-activedescendant]="items().length ? 'cp-' + active() : null" autocomplete="off" />
        <kbd>Esc</kbd>
      </div>
      <ul id="cp-list" role="listbox" aria-label="النتائج">
        @for (item of items(); track item.key; let i = $index) {
          @if (i === 0 || items()[i - 1].group !== item.group) {
            <li class="group" role="presentation">{{ item.group }}</li>
          }
          <li [id]="'cp-' + i" role="option" [attr.aria-selected]="i === active()" [class.active]="i === active()"
            (mouseenter)="active.set(i)" (click)="go(item)">
            @if (item.typeId) {
              <app-type-chip [typeId]="item.typeId" [iconOnly]="true" />
            } @else {
              <span class="ico"><app-icon [name]="item.icon" [size]="16" /></span>
            }
            <span class="text">
              <span class="title">@if (item.code) {<span class="ltr code">{{ item.code }}</span>} {{ item.title }}</span>
              @if (item.subtitle) {
                <small>{{ item.subtitle }}</small>
              }
            </span>
            <app-icon name="chevronLeft" [size]="14" />
          </li>
        } @empty {
          <li class="empty" role="presentation">
            @if (loading()) { جارٍ البحث… } @else if (query().trim().length >= 2) { لا توجد نتائج مطابقة } @else { اكتب حرفين على الأقل }
          </li>
        }
      </ul>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> للتنقل</span><span><kbd>Enter</kbd> للفتح</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> في أي مكان</span></footer>
    </div>
  `,
  styles: `
    .palette { display: flex; flex-direction: column; max-height: min(70vh, 560px); }
    .search { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-4); border-bottom: 1px solid var(--c-border); color: var(--c-muted); }
    input { flex: 1; border: 0; outline: none; font-size: var(--fs-lg); background: none; color: var(--c-text); }
    ul { list-style: none; margin: 0; padding: var(--s-2); overflow-y: auto; }
    .group { padding: var(--s-2) var(--s-3) 4px; font-size: var(--fs-xs); font-weight: 700; color: var(--c-gold-600); }
    [role='option'] { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); cursor: pointer; }
    [role='option'].active { background: var(--c-emerald-50); box-shadow: inset -3px 0 0 var(--c-emerald-600); }
    .ico { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: var(--c-surface-2); color: var(--c-text-2); }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .code { color: var(--c-muted); margin-inline-end: 6px; }
    small { color: var(--c-muted); font-size: var(--fs-xs); }
    .empty { padding: var(--s-6); text-align: center; color: var(--c-muted); }
    footer { display: flex; gap: var(--s-4); padding: var(--s-2) var(--s-4); border-top: 1px solid var(--c-border); background: var(--c-surface-2); font-size: var(--fs-xs); color: var(--c-muted); flex-wrap: wrap; }
    kbd { display: inline-block; min-width: 20px; padding: 0 5px; margin: 0 2px; border: 1px solid var(--c-border-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--c-surface); font-family: inherit; font-size: 11px; text-align: center; direction: ltr; }
  `,
})
export class CommandPalette {
  private readonly api = inject(SearchApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly ref = inject(DialogRef<void>);
  private readonly recent = inject(RecentItems);
  private readonly shortcuts = inject(Shortcuts);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly loading = signal(false);
  private readonly hits = signal<readonly SearchHit[]>([]);

  /** Pages the user may open, shown when the query is empty or matches a page name. */
  private readonly pages = computed<PaletteItem[]>(() =>
    NAVIGATION.flatMap((s) => s.items)
      .filter((i) => !i.permissions.length || i.permissions.some((p) => this.auth.canSomewhere(p)))
      .map((i) => ({ key: `page-${i.link}`, icon: i.icon, title: i.label, subtitle: '', code: null, link: i.link, group: 'الصفحات' })),
  );

  private readonly recentItems = computed<PaletteItem[]>(() =>
    this.recent.items().map((r) => ({
      key: `recent-${r.kind}-${r.id}`, icon: KIND_ICON[r.kind === 'approval' ? 'approval' : r.kind], title: r.title, subtitle: '', code: r.code ?? null, link: r.link, typeId: r.typeId, group: 'الأخيرة',
    })),
  );

  /** Quick actions, shown only when the user holds the permission. */
  private readonly actions = computed<PaletteItem[]>(() => {
    const a = this.auth;
    const act = (key: string, icon: string, title: string, link: string, run?: () => void): PaletteItem => ({ key: `act-${key}`, icon, title, subtitle: '', code: null, link, group: 'إجراءات', run });
    const list: PaletteItem[] = [];
    if (a.can('projects.create')) list.push(act('project', 'plus', 'إنشاء مشروع', '/projects?create=true'));
    if (a.canSomewhere('tasks.create')) list.push(act('workitem', 'plus', 'إنشاء عنصر عمل', '/work-items?create=true'));
    list.push(act('notifications', 'bell', 'الإشعارات', '/notifications'));
    list.push(act('profile', 'user', 'الملف الشخصي', '/profile'));
    list.push(act('shortcuts', 'info', 'اختصارات لوحة المفاتيح', '', () => this.shortcuts.openCheatSheet()));
    list.push(act('logout', 'logout', 'تسجيل الخروج', '', () => a.logout()));
    return list;
  });

  protected readonly items = computed<PaletteItem[]>(() => {
    const q = this.query().trim();
    const pages = this.pages().filter((p) => !q || p.title.includes(q));
    const results = this.hits().map((h) => ({
      key: `${h.kind}-${h.id}`, icon: KIND_ICON[h.kind], title: h.title, subtitle: h.subtitle, code: h.code, link: h.link, typeId: h.typeId, group: KIND_GROUP[h.kind],
    }));
    if (q.length >= 2) return [...results, ...pages];
    if (q) return [...this.actions().filter((x) => x.title.includes(q)), ...pages];
    return [...this.recentItems(), ...this.actions(), ...pages];
  });

  constructor() {
    toObservable(this.query)
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) return of([] as readonly SearchHit[]);
          this.loading.set(true);
          return this.api.search(q.trim()).pipe(catchError(() => of([] as readonly SearchHit[])));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((hits) => {
        this.hits.set(hits);
        this.loading.set(false);
        this.active.set(0);
      });
    queueMicrotask(() => this.input().nativeElement.focus());
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.items().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.active.set((this.active() + 1) % count);
      this.scrollActive();
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.set((this.active() - 1 + count) % count);
      this.scrollActive();
    } else if (event.key === 'Enter' && count) {
      event.preventDefault();
      // The list may have shrunk since `active` was set; clamp before using it.
      this.go(this.items()[Math.min(this.active(), count - 1)]);
    }
  }

  protected go(item: PaletteItem): void {
    this.ref.close();
    if (item.run) item.run();
    else void this.router.navigateByUrl(item.link);
  }

  private scrollActive(): void {
    queueMicrotask(() => document.getElementById(`cp-${this.active()}`)?.scrollIntoView({ block: 'nearest' }));
  }
}

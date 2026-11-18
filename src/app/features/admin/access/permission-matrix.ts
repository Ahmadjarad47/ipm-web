import { ChangeDetectionStrategy, Component, computed, model, signal } from '@angular/core';
import { PERMISSION_LABELS } from '@core/auth/permission-labels';
import { PERMISSION_GROUP_LABELS, PERMISSION_GROUPS, PermissionGroup, PermissionKey } from '@core/auth/permissions';

export type PermissionState = 'none' | 'grant' | 'deny';
export type PermissionStates = Readonly<Partial<Record<PermissionKey, PermissionState>>>;

const STATE_OPTIONS: readonly { readonly value: PermissionState; readonly label: string }[] = [
  { value: 'none', label: 'غير ممنوح' },
  { value: 'grant', label: 'ممنوح' },
  { value: 'deny', label: 'ممنوع صراحة' },
];

/** Three-state permission grid grouped by `PERMISSION_GROUPS`; an explicit deny wins over any grant (§2.2). */
@Component({
  selector: 'app-permission-matrix',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="find">
      <input class="input" type="search" placeholder="ابحث في الصلاحيات بالاسم أو الوصف…" aria-label="بحث في الصلاحيات" [value]="query()" (input)="query.set($any($event.target).value)" />
    </div>
    @for (g of visibleGroups(); track g.key) {
      <fieldset class="grp">
        <legend>
          <span>{{ g.label }}</span>
          <span class="count muted">{{ grantedIn(g.keys) }} / {{ g.keys.length }}</span>
        </legend>
        <div class="bulk">
          <button type="button" class="btn btn--ghost btn--sm" (click)="setGroup(g.keys, 'grant')">منح الكل</button>
          <button type="button" class="btn btn--ghost btn--sm" (click)="setGroup(g.keys, 'none')">إلغاء الكل</button>
        </div>
        @for (k of g.keys; track k) {
          <div class="perm" role="radiogroup" [attr.aria-label]="labels[k]">
            <span class="what"><span class="desc">{{ labels[k] }}</span><span class="ltr key muted">{{ k }}</span></span>
            <div class="seg">
              @for (o of options; track o.value) {
                <label [class.on]="state(k) === o.value" [class.deny]="o.value === 'deny'" [class.grant]="o.value === 'grant'">
                  <input type="radio" [name]="'perm-' + k" [value]="o.value" [checked]="state(k) === o.value" (change)="set(k, o.value)" />
                  {{ o.label }}
                </label>
              }
            </div>
          </div>
        }
      </fieldset>
    } @empty {
      <p class="muted none">لا توجد صلاحيات مطابقة للبحث.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .grp { position: relative; margin: 0; padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); }
    legend { display: flex; gap: var(--s-2); padding-inline: var(--s-2); font-weight: 700; color: var(--c-emerald-800); }
    .bulk { display: flex; flex-wrap: wrap; gap: var(--s-1); justify-content: flex-end; margin-block-end: var(--s-1); }
    .perm { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; padding: 6px 0; border-top: 1px dashed var(--c-border); }
    .find { position: sticky; inset-block-start: 0; z-index: 2; padding-block-end: var(--s-2); background: var(--c-surface); }
    .what { display: flex; flex-direction: column; min-width: 0; }
    .desc { font-weight: 600; }
    .key { font-size: var(--fs-xs); }
    .none { text-align: center; padding: var(--s-4); }
    .seg { display: inline-flex; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); overflow: hidden; }
    .seg label { position: relative; display: inline-flex; align-items: center; min-height: 32px; padding: 3px 12px; font-size: var(--fs-xs); cursor: pointer; background: var(--c-surface); white-space: nowrap; }
    .seg label + label { border-inline-start: 1px solid var(--c-border-strong); }
    .seg input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
    .seg label:has(input:focus-visible) { box-shadow: var(--focus-ring); }
    .seg label.on { background: var(--c-neutral-bg); font-weight: 700; }
    .seg label.on.grant { background: var(--c-success-bg); color: var(--c-success); }
    .seg label.on.deny { background: var(--c-danger-bg); color: var(--c-danger); }
    @media (pointer: coarse), (max-width: 768px) { .seg label { min-block-size: 44px; } }
  `,
})
export class PermissionMatrix {
  readonly states = model.required<PermissionStates>();

  protected readonly options = STATE_OPTIONS;
  protected readonly labels = PERMISSION_LABELS;
  protected readonly query = signal('');
  protected readonly groups = (Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((key) => ({
    key,
    label: PERMISSION_GROUP_LABELS[key],
    keys: PERMISSION_GROUPS[key] as readonly PermissionKey[],
  }));

  /** Groups narrowed by the search box (matches the Arabic description, the key or the group name). */
  protected readonly visibleGroups = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.groups;
    return this.groups
      .map((g) => ({ ...g, keys: g.keys.filter((k) => k.toLowerCase().includes(q) || PERMISSION_LABELS[k].includes(q) || g.label.includes(q)) }))
      .filter((g) => g.keys.length > 0);
  });

  protected state(key: PermissionKey): PermissionState {
    return this.states()[key] ?? 'none';
  }

  protected grantedIn(keys: readonly PermissionKey[]): number {
    return keys.filter((k) => this.state(k) === 'grant').length;
  }

  protected set(key: PermissionKey, value: PermissionState): void {
    this.states.update((s) => ({ ...s, [key]: value }));
  }

  protected setGroup(keys: readonly PermissionKey[], value: PermissionState): void {
    this.states.update((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, value])) }));
  }
}

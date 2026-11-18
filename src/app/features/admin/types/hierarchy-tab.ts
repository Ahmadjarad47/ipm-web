import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, output, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { AuthService } from '@core/auth/auth.service';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { HierarchyRulesApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { HierarchyPair, WorkItemType } from '@domain/work-items/work-item.models';
import { HELP } from '@shared/help/help-texts';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { AdminNotice } from '../shared/admin-notice';
import { errorEntries } from '../shared/api-errors';
import { diffSets, PairSet, pairsToSet, sameSet, setToPairs, toggleCell, pairKey } from './hierarchy-matrix';

/** Parent × child matrix of allowed hierarchy rules; saved as the full pair list (FR-REL-01). */
@Component({
  selector: 'app-hierarchy-tab',
  imports: [AdminNotice, EmptyState, ErrorState, HelpTip, Icon, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../shared/matrix.scss'],
  styles: `
    .ttl { display: flex; align-items: center; gap: var(--s-1); }
    .err-list { margin: 0; padding-inline-start: var(--s-5); color: var(--c-danger); font-size: var(--fs-sm); }
  `,
  template: `
    @if (rules.isLoading() && !rules.hasValue()) {
      <app-skeleton variant="table" [count]="5" />
    } @else if (rules.error()) {
      <section class="card"><app-error-state title="تعذّر تحميل قواعد التسلسل الهرمي" (retry)="rules.reload()" /></section>
    } @else if (!types().length) {
      <section class="card">
        <app-empty-state icon="layers" title="لا توجد أنواع بعد" text="أنشئ نوعين على الأقل لتحديد قواعد التسلسل بينهما." actionLabel="نوع جديد" (action)="createType.emit()" />
      </section>
    } @else {
      <div class="stack">
        <app-admin-notice>
          حدّد لكل نوع (صف) الأنواع المسموح أن تكون أبناءً مباشرين له (أعمدة). تُحفظ القواعد كاملة دفعة واحدة، ولا تُغيّر العناصر القائمة.
        </app-admin-notice>

        <section class="card" aria-labelledby="hr-title"><div class="card-body stack">
          <h2 class="section-title ttl" id="hr-title">قواعد التسلسل الهرمي <app-help-tip [text]="help" /></h2>

          <div class="mx-scroll" tabindex="0" role="region" aria-labelledby="hr-title">
            <table class="mx">
              <caption class="sr-only">قواعد التسلسل الهرمي: الصفوف هي النوع الأب والأعمدة هي النوع الابن</caption>
              <thead>
                <tr>
                  <th scope="col" class="corner">الأب (الصفوف) / الابن (الأعمدة)</th>
                  @for (c of types(); track c.id) {
                    <th scope="col" [style.--sw]="c.color"><span class="dot"></span>{{ c.name }}@if (!c.active) { <span class="muted"> (معطّل)</span> }</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (p of types(); track p.id) {
                  <tr>
                    <th scope="row" [style.--sw]="p.color"><span class="dot"></span>{{ p.name }}@if (!p.active) { <span class="muted"> (معطّل)</span> }</th>
                    @for (c of types(); track c.id) {
                      <td [class.on]="has(p.id, c.id)" [class.self]="p.id === c.id && !has(p.id, c.id)">
                        <label class="hit">
                          <input type="checkbox" [checked]="has(p.id, c.id)" [disabled]="!canManage() || saving()"
                            [attr.aria-label]="'السماح للنوع ' + c.name + ' بأن يكون ابنًا مباشرًا للنوع ' + p.name"
                            (change)="toggle(p.id, c.id, $any($event.target).checked)" />
                        </label>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <ul class="legend" aria-label="دليل الألوان">
            <li>☑ مسموح أن يكون الابن (العمود) تحت الأب (الصف)</li>
            <li>☐ غير مسموح</li>
            <li>لا يُسمح بالحلقات ولا بنقل عنصر تحت أحد أبنائه.</li>
          </ul>

          @if (errors().length) {
            <ul class="err-list" role="alert" aria-label="أخطاء الحفظ">
              @for (e of errors(); track e[0]) {
                <li>{{ e[1] }}</li>
              }
            </ul>
          }
        </div></section>

        @if (dirty()) {
          <div class="savebar" role="region" aria-label="حفظ القواعد">
            <span class="muted">تغييرات غير محفوظة: {{ diff().added }} قاعدة مضافة، {{ diff().removed }} قاعدة محذوفة.</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--outline" [disabled]="saving()" (click)="undo()"><app-icon name="refresh" [size]="14" /> تراجع</button>
            <button type="button" class="btn btn--primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'جارٍ الحفظ…' : 'حفظ القواعد' }}</button>
          </div>
        }
      </div>
    }
  `,
})
export class HierarchyTab {
  private readonly api = inject(HierarchyRulesApi);
  private readonly lookup = inject(WorkItemTypeLookup);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly createType = output<void>();

  protected readonly help = HELP.hierarchyRules;
  protected readonly canManage = computed(() => this.auth.can('workitem.types.manage'));

  protected readonly rules = rxResource<{ readonly pairs: readonly HierarchyPair[] }, true>({
    params: () => true,
    stream: () => this.api.get(),
  });

  protected readonly types = computed<readonly WorkItemType[]>(() => [...this.lookup.items()].sort((a, b) => a.order - b.order));
  private readonly saved = computed<PairSet>(() => pairsToSet(this.rules.hasValue() ? this.rules.value().pairs : []));
  protected readonly draft = linkedSignal<PairSet>(() => this.saved());
  protected readonly saving = signal(false);
  protected readonly errors = signal<readonly (readonly [string, string])[]>([]);

  readonly dirty = computed(() => !sameSet(this.saved(), this.draft()));
  protected readonly diff = computed(() => diffSets(this.saved(), this.draft()));

  protected has(parentId: string, childId: string): boolean {
    return this.draft().has(pairKey(parentId, childId));
  }

  protected toggle(parentId: string, childId: string, on: boolean): void {
    this.draft.update((set) => toggleCell(set, parentId, childId, on));
  }

  protected undo(): void {
    this.draft.set(this.saved());
    this.errors.set([]);
  }

  protected save(): void {
    const previous = setToPairs(this.types().map((t) => t.id), this.saved());
    this.apply(setToPairs(this.types().map((t) => t.id), this.draft()), () =>
      this.toast.undoable('تم حفظ قواعد التسلسل الهرمي', () => this.apply(previous, () => this.toast.info('تم التراجع عن التغيير'))),
    );
  }

  private apply(pairs: readonly HierarchyPair[], done: () => void): void {
    this.saving.set(true);
    this.errors.set([]);
    this.api.save(pairs).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.rules.set(res);
        this.lookup.reload();
        done();
      },
      error: (e: unknown) => {
        this.saving.set(false);
        const entries = errorEntries(e);
        this.errors.set(entries.length ? entries : isApiError(e) ? [['message', e.message]] : []);
      },
    });
  }
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { CreateDto } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { RelationsApi, RelationTypeLookup, WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { RelationView, WorkItem, WorkItemRelation } from '@domain/work-items/work-item.models';
import { StatusBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { Badge } from '@shared/ui/badge/badge';
import { Icon } from '@shared/ui/icon/icon';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { asApiError, ltr, relationPairAllowed } from './work-item-utils';

interface RelationRow {
  readonly relation: WorkItemRelation;
  readonly other: WorkItem;
}

/** Create payload plus the optimistic-concurrency versions of both ends (FR-REL-13). */
type RelationCreate = CreateDto<WorkItemRelation> & { readonly sourceVersion: number; readonly targetVersion: number };

let nextId = 0;

/** Relations of one item (FR-REL-03..06, 14): labels depend on direction, add and delete. */
@Component({
  selector: 'app-relations-panel',
  imports: [RouterLink, StatusBadge, TypeChip, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @for (v of views(); track v.relation.id) {
        <div class="row rel">
          <strong class="label">{{ v.label }}</strong>
          <app-type-chip [typeId]="v.other.typeId" [iconOnly]="true" />
          <a [routerLink]="['/work-items', v.other.id]"><span class="ltr">{{ v.other.ref }}</span> {{ v.other.title }}</a>
          @if (v.other.archived) {
            <app-badge tone="warning">مؤرشف</app-badge>
          }
          <span class="spacer"></span>
          <app-status-badge [statusId]="v.other.statusId" />
          @if (canDelete()) {
            <button type="button" class="btn btn--ghost btn--icon" [attr.aria-label]="'حذف الرابط مع ' + ltr(v.other.ref)" (click)="remove(v)">
              <app-icon name="trash" />
            </button>
          }
        </div>
      } @empty {
        <span class="muted">لا توجد روابط.</span>
      }

      @if (canCreate()) {
        <hr />
        <h4>إضافة رابط</h4>
        <div class="add">
          <div class="field">
            <label [attr.for]="uid + '-rl-type'">نوع الرابط</label>
            <select [id]="uid + '-rl-type'" class="select" (change)="relationTypeId.set(pick($event))">
              <option value="">— اختر —</option>
              @for (t of activeTypes(); track t.id) {
                <option [value]="t.id">{{ t.directed ? t.name + ' / ' + t.inverseName : t.name }}</option>
              }
            </select>
          </div>
          @if (selectedType()?.directed) {
            <div class="field">
              <label [attr.for]="uid + '-rl-dir'">الاتجاه</label>
              <select [id]="uid + '-rl-dir'" class="select" (change)="outgoing.set(pick($event) === 'out')">
                <option value="out">هذا العنصر {{ selectedType()?.name }}…</option>
                <option value="in">هذا العنصر {{ selectedType()?.inverseName }}…</option>
              </select>
            </div>
          }
          <div class="field">
            <label [attr.for]="uid + '-rl-search'">بحث عن العنصر الآخر</label>
            <input [id]="uid + '-rl-search'" class="input" type="search" placeholder="المرجع أو العنوان" (input)="search.set(pick($event))" />
          </div>
          <div class="field">
            <label [attr.for]="uid + '-rl-target'">العنصر</label>
            <select [id]="uid + '-rl-target'" class="select" [attr.aria-describedby]="pairsHint() ? uid + '-rl-hint' : null" (change)="targetId.set(pick($event))">
              <option value="" [selected]="!targetId()">— اختر عنصرًا —</option>
              @for (c of candidates(); track c.id) {
                <option [value]="c.id" [selected]="c.id === targetId()" [disabled]="!pairAllowed(c)">
                  {{ ltr(c.ref) }} — {{ c.title }}{{ pairAllowed(c) ? '' : ' (نوع غير مسموح)' }}
                </option>
              }
            </select>
          </div>
          <button type="button" class="btn btn--primary" [disabled]="!relationTypeId() || !targetId() || busy()" (click)="add()">إضافة</button>
        </div>
        @if (pairsHint(); as hint) {
          <p [id]="uid + '-rl-hint'" class="muted hint">{{ hint }}</p>
        }
        @if (error(); as message) {
          <div class="alert" role="alert">
            <strong>تعذّر إنشاء الرابط</strong>
            <span>{{ message }}</span>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .rel .label { min-inline-size: 110px; color: var(--c-emerald-800); }
    .add { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: var(--s-3); align-items: end; }
    .rel { flex-wrap: wrap; }
    .rel a { overflow-wrap: anywhere; min-inline-size: 0; }
    .add select { min-inline-size: 0; max-inline-size: 100%; }
    @media (max-width: 768px) { .rel .spacer { display: none; } }
    @media (pointer: coarse), (max-width: 768px) { .rel a { display: inline-flex; align-items: center; min-block-size: 44px; } }
    hr { border: 0; border-top: 1px solid var(--c-border); inline-size: 100%; }
    .hint { margin: 0; font-size: var(--fs-sm); }
    .alert { display: flex; flex-direction: column; gap: var(--s-1); padding: var(--s-3); border-radius: var(--r-md); background: var(--c-danger-bg); color: var(--c-danger); border: 1px solid var(--c-danger); }
  `,
})
export class RelationsPanel {
  protected readonly uid = `relations${++nextId}`;
  private readonly auth = inject(AuthService);
  private readonly items = inject(WorkItemsApi);
  private readonly relationsApi = inject(RelationsApi);
  private readonly relationTypes = inject(RelationTypeLookup);
  private readonly itemTypes = inject(WorkItemTypeLookup);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly item = input.required<WorkItem>();
  readonly changed = output<void>();

  protected readonly relationTypeId = signal('');
  protected readonly outgoing = signal(true);
  protected readonly search = signal('');
  protected readonly ltr = ltr;
  protected readonly targetId = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  private readonly canView = computed(() => this.auth.can('workitem.relations.view', this.item().projectId));
  protected readonly canCreate = computed(() => this.auth.can('workitem.relations.create', this.item().projectId));
  protected readonly canDelete = computed(() => this.auth.can('workitem.relations.delete', this.item().projectId));
  protected readonly activeTypes = computed(() => this.relationTypes.items().filter((t) => t.active));
  protected readonly selectedType = computed(() => this.relationTypes.get(this.relationTypeId()));

  /** «يسمح بالربط بين: مهمة ← خطأ …» when the selected relation type restricts type pairs. */
  protected readonly pairsHint = computed(() => {
    const pairs = this.selectedType()?.allowedPairs;
    if (!pairs?.length) return '';
    const name = (id: string): string => this.itemTypes.get(id)?.name ?? '—';
    return `يسمح هذا النوع بالربط بين: ${pairs.map((p) => `${name(p.sourceTypeId)} ← ${name(p.targetTypeId)}`).join('، ')}`;
  });

  private readonly rows = rxResource<readonly RelationRow[], string | undefined>({
    params: () => (this.canView() ? this.item().id : undefined),
    stream: ({ params: id }) =>
      this.relationsApi.forWorkItem(id).pipe(
        switchMap((relations): Observable<readonly RelationRow[]> => {
          if (!relations.length) return of([]);
          return forkJoin(
            relations.map((relation) =>
              this.items.getById(relation.sourceId === id ? relation.targetId : relation.sourceId).pipe(
                map((other): RelationRow | null => ({ relation, other })),
                catchError(() => of(null)),
              ),
            ),
          ).pipe(map((list) => list.filter((r): r is RelationRow => r !== null)));
        }),
      ),
    defaultValue: [],
  });

  protected readonly views = computed<readonly RelationView[]>(() =>
    this.rows.value().map(({ relation, other }) => {
      const type = this.relationTypes.get(relation.relationTypeId);
      const outgoing = relation.sourceId === this.item().id;
      const label = !type ? '—' : type.directed && !outgoing ? type.inverseName : type.name;
      return { relation, label, other, outgoing };
    }),
  );

  private readonly results = rxResource({
    params: () => ({ projectId: this.item().projectId, search: this.search() }),
    stream: ({ params }) => this.items.list({ page: 1, pageSize: 20, search: params.search, filters: { projectId: params.projectId } }),
  });
  protected readonly candidates = computed(() => (this.results.value()?.items ?? []).filter((w) => w.id !== this.item().id && !w.archived));

  constructor() {
    // Drop a selection that is no longer among the options (e.g. after searching) or became an invalid pair.
    effect(() => {
      const id = this.targetId();
      const current = this.candidates().find((c) => c.id === id);
      if (id && (!current || !this.pairAllowed(current))) this.targetId.set('');
    });
  }

  protected pick(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  /** Whether the (source, target) type pair is allowed for the selected relation type and direction. */
  protected pairAllowed(candidate: WorkItem): boolean {
    const type = this.selectedType();
    if (!type) return true;
    const reverse = type.directed && !this.outgoing();
    const own = this.item().typeId;
    return reverse ? relationPairAllowed(type.allowedPairs, candidate.typeId, own) : relationPairAllowed(type.allowedPairs, own, candidate.typeId);
  }

  protected add(): void {
    const self = this.item();
    const other = this.candidates().find((c) => c.id === this.targetId());
    const type = this.selectedType();
    if (!other || !type) return;
    const reverse = type.directed && !this.outgoing();
    const source = reverse ? other : self;
    const target = reverse ? self : other;
    const payload: RelationCreate = { sourceId: source.id, targetId: target.id, relationTypeId: type.id, createdBy: this.auth.user()?.id ?? '', sourceVersion: source.version, targetVersion: target.version };
    this.busy.set(true);
    this.error.set('');
    this.relationsApi.create(payload).subscribe({
      next: () => {
        this.busy.set(false);
        this.targetId.set('');
        this.toast.success('تمت إضافة الرابط');
        this.rows.reload();
        this.changed.emit();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        const err = asApiError(e);
        this.error.set(err?.message ?? 'تعذّر إنشاء الرابط');
        if (err?.status === 409) {
          // A stale version on either end: reload so the next attempt uses fresh versions.
          this.results.reload();
          this.changed.emit();
        }
      },
    });
  }

  protected remove(view: RelationView): void {
    this.confirm
      .confirm({ title: 'حذف الرابط', message: `حذف الرابط «${view.label}» مع ${ltr(view.other.ref)}؟`, confirmText: 'حذف', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.relationsApi.remove(view.relation.id).subscribe(() => {
          this.toast.success('تم حذف الرابط');
          this.rows.reload();
          this.changed.emit();
        });
      });
  }
}

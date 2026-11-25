import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { RelationTypeLookup, RelationTypesApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { RelationType } from '@domain/work-items/work-item.models';
import { Badge } from '@shared/ui/badge/badge';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { ActiveToggle } from '../shared/active-toggle';
import { ADMIN_HELP } from '../shared/admin-help';
import { isAnyType } from './allowed-pairs';
import { RelationTypeDialog, RelationTypeDialogData } from './relation-type-dialog';

/** Relation types table (FR-REL-04): create, rename, allowed type pairs; semantics lock once links exist (FR-REL-05). */
@Component({
  selector: 'app-relation-types-section',
  imports: [Badge, Icon, ActiveToggle, EmptyState, HelpTip, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/admin-table.scss',
  template: `
    <section class="card" aria-labelledby="rel-title">
      <div class="card-body row">
        <div>
          <h2 class="section-title" id="rel-title">أنواع الروابط <app-help-tip [text]="lockHelp" /></h2>
          <p class="muted">تعديل الأسماء والأزواج المسموحة متاح دائمًا؛ المفتاح والاتجاه ومنع الحلقات تُقفل بعد استخدام النوع في روابط فعلية. التعطيل يمنع إنشاء روابط جديدة فقط.</p>
        </div>
        <span class="spacer"></span>
        <button type="button" class="btn btn--primary" [disabled]="!canManage()" (click)="open(null)">
          <app-icon name="plus" [size]="16" /> نوع رابط جديد
        </button>
      </div>
      @if (lookup.error()) {
        <app-error-state title="تعذّر تحميل أنواع الروابط" (retry)="lookup.reload()" />
      } @else if (lookup.loading() && !lookup.items().length) {
        <div class="card-body"><app-skeleton variant="table" [count]="3" /></div>
      } @else if (!lookup.items().length) {
        <app-empty-state icon="link" title="لا توجد أنواع روابط" text="أنشئ أول نوع رابط لربط الأعمال ببعضها." actionLabel="نوع رابط جديد" (action)="open(null)" />
      } @else {
        <div class="scroll">
          <table class="atable">
            <caption class="sr-only">أنواع الروابط</caption>
            <thead>
              <tr>
                <th scope="col">الاسم</th>
                <th scope="col">الاسم العكسي</th>
                <th scope="col">الاتجاه</th>
                <th scope="col">يمنع الحلقات</th>
                <th scope="col">الأنواع المسموحة</th>
                <th scope="col" class="num">نشط</th>
                <th scope="col"><span class="sr-only">إجراءات</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of lookup.items(); track r.id) {
                <tr>
                  <td>
                    {{ r.name }} <span class="ltr muted">({{ r.key }})</span>
                    @if (lockedIds().has(r.id)) {
                      <app-badge tone="warning"><app-icon name="lock" [size]="12" /> مقفل بعد الاستخدام</app-badge>
                    }
                  </td>
                  <td>{{ r.inverseName }}</td>
                  <td><app-badge [tone]="r.directed ? 'info' : 'neutral'">{{ r.directed ? 'موجَّه' : 'متماثل' }}</app-badge></td>
                  <td><app-badge [tone]="r.acyclic ? 'gold' : 'neutral'">{{ r.acyclic ? 'نعم' : 'لا' }}</app-badge></td>
                  <td>{{ pairsLabel(r) }}</td>
                  <td class="num">
                    <app-active-toggle [checked]="r.active" [disabled]="!canManage()" [label]="'تفعيل ' + r.name" (toggled)="setActive(r, $event)" />
                  </td>
                  <td class="actions">
                    <button type="button" class="btn btn--ghost btn--sm" [disabled]="!canManage()" (click)="open(r)" [attr.aria-label]="'تعديل ' + r.name">
                      <app-icon name="edit" [size]="15" /> تعديل
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class RelationTypesSection {
  protected readonly lookup = inject(RelationTypeLookup);
  private readonly typeLookup = inject(WorkItemTypeLookup);
  private readonly api = inject(RelationTypesApi);
  private readonly dialog = inject(DialogService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly lockHelp = ADMIN_HELP.relationLocked;
  protected readonly canManage = computed(() => this.auth.can('workitem.relationtypes.manage'));
  /** Types the server has told us are in use (there is no usage endpoint; learned from 422 rejections). */
  protected readonly lockedIds = signal<ReadonlySet<string>>(new Set());

  protected pairsLabel(r: RelationType): string {
    if (isAnyType(r.allowedPairs)) return 'أي نوع';
    const name = (id: string): string => this.typeLookup.get(id)?.name ?? id;
    const pairs = r.allowedPairs ?? [];
    const shown = pairs.slice(0, 3).map((p) => `${name(p.sourceTypeId)} ← ${name(p.targetTypeId)}`);
    return pairs.length > 3 ? `${shown.join('، ')} (+${pairs.length - 3})` : shown.join('، ');
  }

  protected open(relation: RelationType | null): void {
    this.dialog.open<RelationTypeDialog, RelationTypeDialogData, RelationType>(RelationTypeDialog, {
      data: {
        relation,
        locked: !!relation && this.lockedIds().has(relation.id),
        onLocked: () => relation && this.lockedIds.update((ids) => new Set(ids).add(relation.id)),
      },
      width: 'min(760px, calc(100vw - 32px))',
    });
  }

  protected setActive(relation: RelationType, active: boolean): void {
    if (active) {
      this.persist(relation, true);
      return;
    }
    // No impact endpoint exists for relation types: explain the (mild) effect instead.
    this.confirm
      .confirm({
        title: 'تعطيل نوع الرابط',
        message: `تعطيل «${relation.name}» يمنع إنشاء روابط جديدة من هذا النوع فقط؛ الروابط القائمة تبقى كما هي ولا تُحذف.`,
        confirmText: 'تعطيل',
        danger: true,
      })
      .subscribe((ok) => (ok ? this.persist(relation, false) : this.lookup.reload()));
  }

  private persist(relation: RelationType, active: boolean): void {
    this.api.update(relation.id, { active, version: relation.version }).subscribe({
      next: () => {
        this.toast.success(active ? 'تم تفعيل نوع الرابط' : 'تم تعطيل نوع الرابط');
        this.lookup.reload();
      },
      error: () => this.lookup.reload(),
    });
  }
}

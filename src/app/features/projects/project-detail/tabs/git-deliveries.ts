import { ChangeDetectionStrategy, Component, computed, inject, input, signal, TemplateRef, viewChild } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CanDirective } from '@core/auth/can.directive';
import { emptyPage, PagedResult } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { GitIntegrationApi } from '@domain/git/git.api';
import { WEBHOOK_OUTCOME_LABELS, WebhookDelivery, WebhookOutcome } from '@domain/git/git.models';
import { AppDatePipe } from '@shared/pipes/pipes';
import { Badge, BadgeTone } from '@shared/ui/badge/badge';
import { DataTable } from '@shared/ui/data-table/data-table';
import { CellContext, ColumnDef, loadTablePrefs } from '@shared/ui/data-table/data-table.models';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { explainDelivery } from './git-logic';

const OUTCOME_TONES: Record<WebhookOutcome, BadgeTone> = { processed: 'success', duplicate: 'neutral', rejected: 'danger', failed: 'warning' };
const OUTCOMES = Object.keys(WEBHOOK_OUTCOME_LABELS) as WebhookOutcome[];
const EVENTS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'push', label: 'دفع (push)' },
  { key: 'pull_request', label: 'طلب دمج (pull_request)' },
];

let nextId = 0;

type Cell = TemplateRef<CellContext<WebhookDelivery>>;

/** FR-GIT-05/06: received webhook deliveries with outcome, filters, plain-Arabic explanations and redelivery of failed ones. */
@Component({
  selector: 'app-git-deliveries',
  imports: [DataTable, Badge, Icon, CanDirective, AppDatePipe, RouterLink, FormsModule, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="section-title">سجل التسليمات (Webhook)</h3>
    <div class="filters">
      <div class="field">
        <label [attr.for]="uid + '-outcome'">النتيجة</label>
        <select [id]="uid + '-outcome'" class="select" [ngModel]="outcome()" (ngModelChange)="setOutcome($event)">
          <option value="">الكل</option>
          @for (o of outcomes; track o) {
            <option [value]="o">{{ outcomeLabels[o] }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label [attr.for]="uid + '-event'">الحدث</label>
        <select [id]="uid + '-event'" class="select" [ngModel]="event()" (ngModelChange)="setEvent($event)">
          <option value="">الكل</option>
          @for (e of events; track e.key) {
            <option [value]="e.key">{{ e.label }}</option>
          }
        </select>
      </div>
      @if (outcome() || event()) {
        <button type="button" class="btn btn--ghost btn--sm" (click)="clearFilters()">مسح الفلاتر</button>
      }
    </div>

    @if (lastRedelivery(); as r) {
      <div class="redelivery" [class.bad]="r.outcome === 'failed'" [attr.role]="r.outcome === 'failed' ? 'alert' : 'status'" aria-live="polite">
        <strong>نتيجة إعادة المعالجة: {{ outcomeLabels[r.outcome] }}.</strong> {{ r.message ?? '' }}
      </div>
    }

    @if (deliveries.error()) {
      <app-error-state title="تعذّر تحميل سجل التسليمات" (retry)="deliveries.reload()" />
    } @else {
      <app-data-table
        tableId="git-deliveries"
        [rows]="deliveries.value().items"
        [columns]="columns()"
        [loading]="deliveries.isLoading()"
        [total]="deliveries.value().total"
        [page]="page()"
        [pageSize]="pageSize()"
        [clickable]="false"
        caption="سجل تسليمات Webhook"
        [emptyTitle]="outcome() || event() ? 'لا توجد تسليمات مطابقة' : 'لا توجد تسليمات'"
        [emptyText]="outcome() || event() ? 'جرّب تغيير الفلاتر.' : 'لم يستقبل النظام أي استدعاء Webhook لهذا المشروع بعد. تأكد من إعداد Webhook لدى مزوّد Git.'"
        (pageChange)="page.set($event)"
        (pageSizeChange)="setPageSize($event)"
      />
    }

    <ng-template #timeCell let-row>{{ row.createdAt | appDate: true }}</ng-template>
    <ng-template #eventCell let-row><span class="ltr">{{ row.event }}</span></ng-template>
    <ng-template #idCell let-row><span class="ltr id" [attr.title]="row.deliveryId">{{ row.deliveryId }}</span></ng-template>
    <ng-template #sigCell let-row>
      @if (row.signatureValid) {
        <span class="ok" role="img" aria-label="التوقيع صالح">✓</span>
      } @else {
        <span class="bad" role="img" aria-label="التوقيع غير صالح">✗</span>
      }
    </ng-template>
    <ng-template #outcomeCell let-row>
      <app-badge [tone]="tone(row.outcome)">{{ label(row.outcome) }}</app-badge>
    </ng-template>
    <ng-template #msgCell let-row>
      <span class="msg" [attr.title]="row.message">{{ explain(row) }}</span>
    </ng-template>
    <ng-template #refsCell let-row>
      <span class="refs">
        @for (ref of row.linkedRefs; track ref) {
          <a class="ltr ref" routerLink="/work-items" [queryParams]="{ search: ref }">{{ ref }}</a>
        }
      </span>
    </ng-template>
    <ng-template #actionCell let-row>
      @if (row.outcome === 'failed') {
        <button *appCan="'git.manage'; project: projectId()" type="button" class="btn btn--outline btn--sm" [disabled]="redelivering() === row.id" (click)="redeliver(row)">
          <app-icon name="refresh" [size]="14" /> إعادة المعالجة
        </button>
      }
    </ng-template>
  `,
  styles: `
    .filters { display: flex; gap: var(--s-3); align-items: flex-end; flex-wrap: wrap; margin-block-end: var(--s-3); }
    .id { display: inline-block; max-inline-size: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
    .ok { color: var(--c-success); font-weight: 700; }
    .bad { color: var(--c-danger); font-weight: 700; }
    .msg { font-size: var(--fs-sm); }
    .refs { display: inline-flex; gap: var(--s-2); flex-wrap: wrap; }
    .ref { color: var(--c-primary); font-weight: 600; }
    .redelivery { margin-block-end: var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--c-success-bg); color: var(--c-success); }
    .redelivery.bad { background: var(--c-warning-bg); color: var(--c-warning); font-weight: 400; }
    .redelivery { overflow-wrap: anywhere; }
    .msg { overflow-wrap: anywhere; }
    @media (max-width: 768px) {
      .filters > .field { flex: 1 1 100%; }
      .filters .select { inline-size: 100%; }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .filters .btn, .ref { min-block-size: 44px; display: inline-flex; align-items: center; }
      td .btn--sm { min-block-size: 44px; }
    }
  `,
})
export class GitDeliveries {
  readonly projectId = input.required<string>();
  /** Incremented by the parent to force a reload (e.g. after a simulated event). */
  readonly refreshKey = input(0);

  private readonly api = inject(GitIntegrationApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly uid = `gd${++nextId}`;
  protected readonly outcomes = OUTCOMES;
  protected readonly outcomeLabels = WEBHOOK_OUTCOME_LABELS;
  protected readonly events = EVENTS;
  protected readonly pageSize = signal(loadTablePrefs('git-deliveries').pageSize ?? 10);
  protected readonly page = signal(1);
  protected readonly outcome = signal<WebhookOutcome | ''>('');
  protected readonly event = signal('');
  protected readonly redelivering = signal<string | null>(null);
  protected readonly lastRedelivery = signal<WebhookDelivery | null>(null);

  protected readonly deliveries = rxResource<PagedResult<WebhookDelivery>, { projectId: string; page: number; size: number; outcome: string; event: string; key: number }>({
    params: () => ({ projectId: this.projectId(), page: this.page(), size: this.pageSize(), outcome: this.outcome(), event: this.event(), key: this.refreshKey() }),
    stream: ({ params }) =>
      this.api.deliveries(params.projectId, {
        page: params.page,
        pageSize: params.size,
        filters: { ...(params.outcome ? { outcome: params.outcome } : {}), ...(params.event ? { event: params.event } : {}) },
      }),
    defaultValue: emptyPage<WebhookDelivery>(10),
  });

  private readonly timeCell = viewChild.required<Cell>('timeCell');
  private readonly eventCell = viewChild.required<Cell>('eventCell');
  private readonly idCell = viewChild.required<Cell>('idCell');
  private readonly sigCell = viewChild.required<Cell>('sigCell');
  private readonly outcomeCell = viewChild.required<Cell>('outcomeCell');
  private readonly msgCell = viewChild.required<Cell>('msgCell');
  private readonly refsCell = viewChild.required<Cell>('refsCell');
  private readonly actionCell = viewChild.required<Cell>('actionCell');

  protected readonly columns = computed<readonly ColumnDef<WebhookDelivery>[]>(() => [
    { key: 'createdAt', header: 'الوقت', template: this.timeCell() },
    { key: 'event', header: 'الحدث', template: this.eventCell() },
    { key: 'deliveryId', header: 'معرّف التسليم', hideOnMobile: true, hidden: true, template: this.idCell() },
    { key: 'signatureValid', header: 'التوقيع', align: 'center', template: this.sigCell() },
    { key: 'outcome', header: 'النتيجة', template: this.outcomeCell() },
    { key: 'message', header: 'الشرح', hideOnMobile: true, template: this.msgCell() },
    { key: 'linkedRefs', header: 'الأعمال المرتبطة', template: this.refsCell() },
    { key: '_actions', header: '', srHeader: 'إجراءات', required: true, template: this.actionCell() },
  ]);

  protected label(o: WebhookOutcome): string {
    return WEBHOOK_OUTCOME_LABELS[o];
  }

  protected tone(o: WebhookOutcome): BadgeTone {
    return OUTCOME_TONES[o];
  }

  protected explain(row: WebhookDelivery): string {
    return explainDelivery(row);
  }

  protected setOutcome(value: WebhookOutcome | ''): void {
    this.outcome.set(value);
    this.page.set(1);
  }

  protected setEvent(value: string): void {
    this.event.set(value);
    this.page.set(1);
  }

  protected clearFilters(): void {
    this.outcome.set('');
    this.event.set('');
    this.page.set(1);
  }

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  protected redeliver(row: WebhookDelivery): void {
    this.confirm
      .confirm({
        title: 'إعادة معالجة التسليم',
        message: 'ستُعاد معالجة الحمولة المحفوظة لهذا التسليم الفاشل دون الحاجة إلى إعادة إرساله من المزوّد. الروابط المنشأة سابقًا لا تتكرر.',
        confirmText: 'إعادة المعالجة',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.redelivering.set(row.id);
        this.api.redeliver(row.id).subscribe({
          next: (d) => {
            this.redelivering.set(null);
            this.lastRedelivery.set(d);
            if (d.outcome === 'failed') this.toast.error(`فشلت إعادة المعالجة: ${d.message ?? 'سبب غير معروف'}`);
            else this.toast.success(`أُعيدت المعالجة: ${WEBHOOK_OUTCOME_LABELS[d.outcome]}`);
            this.deliveries.reload();
          },
          error: () => this.redelivering.set(null),
        });
      });
  }
}

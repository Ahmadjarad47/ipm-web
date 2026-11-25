import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, TemplateRef, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { rxResource } from '@core/state/safe-resource';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, forkJoin, map, Subject } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalBox, ApprovalRequest } from '@domain/approvals/approval.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { ApprovalStatusBadge } from '@shared/domain-ui/domain-ui';
import { RelativeTimePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Badge } from '@shared/ui/badge/badge';
import { DataTable } from '@shared/ui/data-table/data-table';
import { CellContext, ColumnDef, loadTablePrefs } from '@shared/ui/data-table/data-table.models';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { slaState, slaText, summarizeBulk } from './approval-logic';
import { ApprovalListStore } from './approval-list.store';
import { BulkResultData, BulkResultDialog } from './bulk-result-dialog';

const BOXES: readonly ApprovalBox[] = ['inbox', 'sent', 'closed'];

const EMPTY: Record<ApprovalBox, { title: string; text: string; icon: string }> = {
  inbox: { title: 'لا توجد طلبات بانتظارك — أحسنت', text: 'لا شيء يحتاج قرارك الآن. ستصلك إشعارات عند وصول طلب جديد.', icon: 'checkCircle' },
  sent: { title: 'لم ترسل أي طلب موافقة بعد', text: 'يمكنك طلب موافقة من صفحة المشروع أو عنصر العمل.', icon: 'approval' },
  closed: { title: 'لا توجد طلبات منتهية', text: 'تظهر هنا الطلبات المعتمدة أو المرفوضة التي يحق لك الاطلاع عليها.', icon: 'approval' },
};

@Component({
  selector: 'app-approvals-page',
  imports: [RouterLink, PageHeader, Tabs, DataTable, ApprovalStatusBadge, RelativeTimePipe, UserNamePipe, Badge, EmptyState, ErrorState, Skeleton],
  providers: [ApprovalListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approvals-page.html',
  styleUrl: './approvals-page.scss',
})
export class ApprovalsPage {
  protected readonly store = inject(ApprovalListStore);
  private readonly api = inject(ApprovalRequestsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly projects = inject(ProjectLookup);
  private readonly dialog = inject(DialogService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  private readonly counts = rxResource<Record<ApprovalBox, number>, number>({
    params: () => this.countsKey(),
    stream: () =>
      forkJoin(BOXES.map((b) => this.api.listBox(b, { page: 1, pageSize: 1 }).pipe(map((p) => p.total)))).pipe(
        map(([inbox, sent, closed]) => ({ inbox, sent, closed })),
      ),
  });
  private readonly countsKey = signal(0);

  protected readonly tabs = computed<readonly TabItem<ApprovalBox>[]>(() => {
    const c = this.counts.hasValue() ? this.counts.value() : null;
    return [
      { key: 'inbox', label: 'واردة بانتظار قراري', count: c?.inbox ?? null },
      { key: 'sent', label: 'مرسلة مني', count: c?.sent ?? null },
      { key: 'closed', label: 'منتهية', count: c?.closed ?? null },
    ];
  });

  private readonly param = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('box'))), { initialValue: null });
  protected readonly box = computed<ApprovalBox>(() => BOXES.find((b) => b === this.param()) ?? 'inbox');
  protected readonly empty = computed(() => EMPTY[this.box()]);
  protected readonly firstLoad = computed(() => this.store.loading() && !this.store.items().length);

  // Bulk selection (inbox only): id -> request, so the result dialog can name rows.
  protected readonly selected = signal<ReadonlyMap<string, ApprovalRequest>>(new Map());
  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly bulking = signal(false);
  protected readonly bulkEnabled = computed(() => this.box() === 'inbox');
  private readonly me = computed(() => this.auth.user()?.id);

  private readonly selectCell = viewChild.required<TemplateRef<CellContext<ApprovalRequest>>>('selectCell');
  private readonly titleCell = viewChild.required<TemplateRef<CellContext<ApprovalRequest>>>('titleCell');
  private readonly requesterCell = viewChild.required<TemplateRef<CellContext<ApprovalRequest>>>('requesterCell');
  private readonly stageCell = viewChild.required<TemplateRef<CellContext<ApprovalRequest>>>('stageCell');
  private readonly statusCell = viewChild.required<TemplateRef<CellContext<ApprovalRequest>>>('statusCell');
  private readonly updatedCell = viewChild.required<TemplateRef<CellContext<ApprovalRequest>>>('updatedCell');

  protected readonly columns = computed<readonly ColumnDef<ApprovalRequest>[]>(() => {
    const cols: ColumnDef<ApprovalRequest>[] = [
      { key: 'title', header: 'الطلب', required: true, template: this.titleCell() },
      { key: 'projectId', header: 'المشروع', hideOnMobile: true, format: (r) => this.projects.get(r.projectId)?.name ?? '—' },
      { key: 'requesterId', header: 'مقدّم الطلب', hideOnMobile: true, template: this.requesterCell() },
      { key: '_stage', header: 'المرحلة والمهلة', template: this.stageCell() },
      { key: 'status', header: 'الحالة', template: this.statusCell() },
      { key: 'updatedAt', header: 'آخر تحديث', hideOnMobile: true, template: this.updatedCell() },
    ];
    if (this.bulkEnabled()) cols.unshift({ key: '_select', header: '', srHeader: 'تحديد للموافقة الجماعية', required: true, width: '44px', template: this.selectCell() });
    return cols;
  });

  private readonly search$ = new Subject<string>();

  constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed()).subscribe((s) => this.store.setSearch(s));
    const saved = loadTablePrefs('approvals').pageSize;
    if (saved) this.store.setPageSize(saved);
    effect(() => {
      const box = this.box();
      untracked(() => {
        this.store.setBox(box);
        this.selected.set(new Map());
      });
    });
  }

  protected setBox(box: ApprovalBox): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { box }, queryParamsHandling: 'merge' });
  }

  protected onSearch(event: Event): void {
    this.search$.next((event.target as HTMLInputElement).value);
  }

  protected open(row: ApprovalRequest): void {
    void this.router.navigate(['/approvals', row.id]);
  }

  protected reload(): void {
    this.store.reload();
    this.countsKey.update((k) => k + 1);
  }

  protected isSelectable(row: ApprovalRequest): boolean {
    return row.status === 'pending-approval' && !!row.canDecide;
  }

  protected isMine(row: ApprovalRequest): boolean {
    return row.requesterId === this.me();
  }

  protected isSelected(row: ApprovalRequest): boolean {
    return this.selected().has(row.id);
  }

  protected toggle(row: ApprovalRequest, checked: boolean): void {
    this.selected.update((m) => {
      const next = new Map(m);
      if (checked) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });
  }

  protected selectAllOnPage(): void {
    this.selected.update((m) => {
      const next = new Map(m);
      for (const r of this.store.items()) if (this.isSelectable(r)) next.set(r.id, r);
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Map());
  }

  protected selectableOnPage = computed(() => this.store.items().filter((r) => this.isSelectable(r)).length);

  protected bulkApprove(): void {
    const rows = [...this.selected().values()];
    if (!rows.length || this.bulking()) return;
    this.confirm
      .confirm({
        title: `موافقة على ${rows.length} ${rows.length > 10 ? 'طلبًا' : 'طلبات'}`,
        message: 'ستُسجَّل موافقتك على المرحلة الحالية لكل طلب محدد. الرفض والإرجاع غير متاحين جماعيًا لأن التعليق إلزامي لكل طلب؛ افتح الطلب لاتخاذ هذا القرار.',
        confirmText: 'موافقة على المحدد',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.bulking.set(true);
        const revisions = Object.fromEntries(rows.map((r) => [r.id, r.revision]));
        this.api.bulkApprove(rows.map((r) => r.id), undefined, revisions).subscribe({
          next: (results) => {
            this.bulking.set(false);
            const summary = summarizeBulk(results);
            const titles = Object.fromEntries(rows.map((r) => [r.id, r.title]));
            this.clearSelection();
            this.reload();
            if (summary.okIds.length && !summary.failed.length) this.toast.success(`تمت الموافقة على ${summary.okIds.length} طلبًا`);
            this.dialog.open<BulkResultDialog, BulkResultData, void>(BulkResultDialog, {
              data: { summary, titles },
              width: 'min(560px, calc(100vw - 32px))',
            });
          },
          error: () => this.bulking.set(false),
        });
      });
  }

  /** Dot states for the mini stepper: done / active / pending. */
  protected dots(row: ApprovalRequest): readonly ('done' | 'active' | 'pending')[] {
    return row.stages.map((s) =>
      row.status === 'approved' || (row.currentStage > 0 && s.order < row.currentStage)
        ? 'done'
        : s.order === row.currentStage
          ? 'active'
          : 'pending',
    );
  }

  protected stageText(row: ApprovalRequest): string {
    const total = row.stages.length;
    return `${row.status === 'approved' ? total : Math.max(row.currentStage, 0)} / ${total}`;
  }

  protected isPending(row: ApprovalRequest): boolean {
    return row.status === 'pending-approval';
  }

  protected sla(row: ApprovalRequest): string {
    return slaText(row.stageDueAt, this.isPending(row));
  }

  protected slaClass(row: ApprovalRequest): string {
    return row.overdue ? 'overdue' : slaState(row.stageDueAt, this.isPending(row));
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { AuditApi } from '@domain/activity/activity.api';
import { AUDIT_ACTION_LABELS, AuditEvent, AuditVerification, SubjectType } from '@domain/activity/activity.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { UserLookup } from '@domain/users/user.api';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Avatar } from '@shared/ui/avatar/avatar';
import { Badge } from '@shared/ui/badge/badge';
import { DataTable } from '@shared/ui/data-table/data-table';
import { loadTablePrefs } from '@shared/ui/data-table/data-table.models';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { CellContext, ColumnDef } from '@shared/ui/data-table/data-table.models';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { AuditEventDialog } from './audit-event-dialog';
import { activeChips, AuditFilterKey, AuditUiFilters, EMPTY_AUDIT_FILTERS } from './audit-filters';
import { SUBJECT_TYPE_LABELS } from './audit-labels';
import { AuditListStore } from './audit-list.store';

type Cell = TemplateRef<CellContext<AuditEvent>>;

/** FR-AUD-01..09: read-only, append-only audit log with filters and (permitted) CSV export. */
@Component({
  selector: 'app-audit-page',
  imports: [PageHeader, DataTable, ErrorState, Avatar, Badge, Icon, AppDatePipe, UserNamePipe],
  providers: [AuditListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit-page.html',
  styleUrl: './audit-page.scss',
})
export class AuditPage {
  protected readonly store = inject(AuditListStore);
  protected readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly users = inject(UserLookup);
  private readonly auditApi = inject(AuditApi);
  private readonly toast = inject(ToastService);
  protected readonly exporting = signal(false);
  protected readonly projects = inject(ProjectLookup);

  protected readonly userItems = this.users.items;
  protected readonly subjectTypes = Object.entries(SUBJECT_TYPE_LABELS) as [SubjectType, string][];
  protected readonly actions = Object.entries(AUDIT_ACTION_LABELS);

  private readonly search$ = new Subject<string>();

  /** Mirror of the filter bar, used for the chips and for controlled inputs. */
  protected readonly ui = signal<AuditUiFilters>(EMPTY_AUDIT_FILTERS);
  protected readonly chips = computed(() =>
    activeChips(this.ui(), (key, value) => {
      switch (key) {
        case 'projectId': return this.projects.get(value)?.name ?? value;
        case 'actorId': return this.users.nameOf(value);
        case 'subjectType': return SUBJECT_TYPE_LABELS[value as SubjectType] ?? value;
        case 'action': return AUDIT_ACTION_LABELS[value] ?? value;
        default: return value;
      }
    }),
  );

  protected readonly verifying = signal(false);
  protected readonly verification = signal<AuditVerification | null>(null);
  protected readonly verifyFailed = signal(false);

  constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed()).subscribe((s) => this.set('search', s));
    const size = loadTablePrefs('audit').pageSize;
    if (size) this.store.setPageSize(size);
  }

  /** Updates one filter in the UI mirror and the server-side query. */
  protected set<K extends AuditFilterKey>(key: K, value: AuditUiFilters[K]): void {
    this.ui.update((f) => ({ ...f, [key]: value }));
    switch (key) {
      case 'search': this.store.setSearch(String(value).trim()); break;
      case 'from':
      case 'to': this.store.setDateFilter(key, String(value)); break;
      case 'security': this.store.setFilter('security', value ? true : undefined); break;
      default: this.store.setFilter(key as 'projectId' | 'actorId' | 'subjectType' | 'action' | 'subjectId' | 'correlationId', String(value) || undefined);
    }
  }

  protected clearAll(): void {
    this.ui.set(EMPTY_AUDIT_FILTERS);
    this.store.resetFilters();
  }

  protected clearOne(key: AuditFilterKey): void {
    this.set(key, EMPTY_AUDIT_FILTERS[key]);
  }

  /** FR-AUD-09: server recomputes the hash chain; the banner shows the first broken event if any. */
  protected verify(): void {
    if (this.verifying()) return;
    this.verifying.set(true);
    this.verifyFailed.set(false);
    this.auditApi.verify().subscribe({
      next: (v) => {
        this.verification.set(v);
        this.verifying.set(false);
      },
      error: () => {
        this.verification.set(null);
        this.verifyFailed.set(true);
        this.verifying.set(false);
      },
    });
  }

  private readonly timeCell = viewChild.required<Cell>('timeCell');
  private readonly actorCell = viewChild.required<Cell>('actorCell');
  private readonly actionCell = viewChild.required<Cell>('actionCell');
  private readonly subjectCell = viewChild.required<Cell>('subjectCell');
  private readonly securityCell = viewChild.required<Cell>('securityCell');
  private readonly corrCell = viewChild.required<Cell>('corrCell');

  protected readonly columns = computed<readonly ColumnDef<AuditEvent>[]>(() => [
    { key: 'at', header: 'الوقت', sortable: true, template: this.timeCell() },
    { key: 'actorId', header: 'المنفّذ', template: this.actorCell() },
    { key: 'action', header: 'الإجراء', template: this.actionCell() },
    { key: 'subjectLabel', header: 'الموضوع', template: this.subjectCell() },
    { key: 'source', header: 'المصدر', hideOnMobile: true },
    { key: 'security', header: 'أمني', hideOnMobile: true, template: this.securityCell() },
    { key: 'correlationId', header: 'معرّف الارتباط', hideOnMobile: true, template: this.corrCell() },
  ]);

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected onSearch(event: Event): void {
    this.search$.next(this.text(event));
  }

  protected onSecurity(event: Event): void {
    this.set('security', (event.target as HTMLInputElement).checked);
  }

  protected open(row: AuditEvent): void {
    this.dialog.open<AuditEventDialog, AuditEvent>(AuditEventDialog, { data: row, width: 'min(820px, calc(100vw - 32px))' });
  }

  protected actionLabel(action: string): string | undefined {
    return AUDIT_ACTION_LABELS[action];
  }

  protected typeLabel(type: SubjectType): string {
    return SUBJECT_TYPE_LABELS[type];
  }

  /** FR-AUD-08: the server builds the CSV of every event matching the current filters and records the export in the audit log. */
  protected exportCsv(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.auditApi.exportCsv(this.store.query()).subscribe({
      next: (file) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.toast.success('تم تصدير السجل');
      },
      error: () => this.exporting.set(false),
    });
  }
}

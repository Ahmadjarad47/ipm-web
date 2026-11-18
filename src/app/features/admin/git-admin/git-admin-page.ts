import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { GitIntegrationApi } from '@domain/git/git.api';
import { ProjectsApi, ProjectLookup } from '@domain/projects/project.api';
import { ProjectSummary, Repository } from '@domain/projects/project.models';
import { AppDatePipe, RelativeTimePipe } from '@shared/pipes/pipes';
import { Badge } from '@shared/ui/badge/badge';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { KpiCard } from '@shared/ui/kpi-card/kpi-card';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';

const WEBHOOK_SECURITY =
  'كل تسليم يُتحقق من توقيعه: HMAC-SHA256 على نص الحمولة (Gitea وGitHub) أو رمز مشترك (GitLab)، بمقارنة ثابتة الزمن. التسليم الأقدم من 5 دقائق يُرفض (نافذة الحماية من إعادة الإرسال)، والمعرّف نفسه لا يُعالج مرتين.';

const PROVIDERS: Record<Repository['provider'], string> = { gitea: 'Gitea', github: 'GitHub', gitlab: 'GitLab' };

export interface RepoRow {
  readonly project: ProjectSummary;
  readonly repo: Repository;
}

/** Pure: flattens projects into one row per repository. */
export function repoRows(projects: readonly ProjectSummary[]): RepoRow[] {
  return projects.flatMap((project) => project.repositories.map((repo) => ({ project, repo })));
}

/** Git integration overview across every project the user can see (FR-GIT-01/06/09). */
@Component({
  selector: 'app-git-admin-page',
  imports: [RouterLink, PageHeader, KpiCard, Badge, Icon, EmptyState, ErrorState, Skeleton, HelpTip, AppDatePipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/admin-table.scss',
  styles: `
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-4); margin-block-end: var(--s-4); }
    .err { color: var(--c-danger); font-size: var(--fs-sm); }
    .sec { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-4) var(--s-4) 0; }
  `,
  template: `
    <app-page-header title="تكامل Git" subtitle="المستودعات المرتبطة بالمشاريع وحالة مزامنتها وتسليمات Webhook" />

    @if (projectsError()) {
      <app-error-state title="تعذّر تحميل المشاريع" (retry)="reload()" />
    } @else {
      <div class="kpis">
        <app-kpi-card label="مستودعات متصلة" [value]="connectedCount()" icon="git" tone="emerald" [loading]="loading()" />
        <app-kpi-card label="مستودعات بها خطأ مزامنة" [value]="errorCount()" icon="alert" [tone]="errorCount() ? 'danger' : 'emerald'" [loading]="loading()" />
        <app-kpi-card label="تسليمات فاشلة" [value]="failed.hasValue() ? failed.value() : '—'" icon="alert" [tone]="failed.hasValue() && failed.value() ? 'gold' : 'emerald'" [loading]="failed.isLoading()" hint="تحتاج إعادة معالجة" />
      </div>

      <section class="card" aria-labelledby="gr-title">
        <h2 class="section-title sec" id="gr-title">
          المستودعات
          <app-help-tip [text]="security" label="أمان Webhook" />
        </h2>
        @if (loading() && !rows().length) {
          <app-skeleton variant="table" [count]="5" />
        } @else if (!rows().length) {
          <app-empty-state icon="git" title="لا توجد مستودعات مرتبطة" text="اربط مستودعًا من تبويب Git داخل أي مشروع ليظهر هنا." />
        } @else {
          <div class="scroll">
            <table class="atable">
              <caption class="sr-only">المستودعات المرتبطة بالمشاريع</caption>
              <thead>
                <tr>
                  <th scope="col">المشروع</th>
                  <th scope="col">المستودع</th>
                  <th scope="col">المزوّد</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">بيانات الاعتماد</th>
                  <th scope="col">آخر مزامنة</th>
                  <th scope="col"><span class="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.repo.id) {
                  <tr>
                    <td>
                      <span class="ltr"><strong>{{ row.project.code }}</strong></span>
                      <small class="muted"> {{ row.project.name }}</small>
                    </td>
                    <td class="ltr">{{ row.repo.name }}</td>
                    <td>{{ providerLabel(row.repo.provider) }}</td>
                    <td><app-badge [tone]="row.repo.connected ? 'success' : 'neutral'">{{ row.repo.connected ? 'متصل' : 'مفصول' }}</app-badge></td>
                    <td>
                      <app-badge [tone]="row.repo.hasCredential ? 'success' : 'warning'">{{ row.repo.hasCredential ? 'محفوظة' : 'غير محفوظة' }}</app-badge>
                    </td>
                    <td>
                      @if (row.repo.lastSyncAt; as at) {
                        {{ at | relativeTime }} <small class="muted ltr">({{ at | appDate: true }})</small>
                      } @else {
                        <span class="muted">لم تتم</span>
                      }
                      @if (row.repo.lastSyncError; as e) {
                        <div class="err" role="alert"><app-icon name="alert" [size]="14" /> {{ e }}</div>
                      }
                    </td>
                    <td class="actions">
                      @if (row.repo.connected && can('git.sync', row.project.id)) {
                        <button type="button" class="btn btn--outline btn--sm" [disabled]="syncing() === row.repo.id" [attr.aria-label]="'مزامنة ' + row.repo.name" (click)="sync(row)">
                          <app-icon name="refresh" [size]="14" /> {{ syncing() === row.repo.id ? 'جارٍ المزامنة…' : 'مزامنة' }}
                        </button>
                      }
                      @if (can('git.view', row.project.id)) {
                        <a class="btn btn--ghost btn--sm" [routerLink]="['/projects', row.project.id]" [queryParams]="{ tab: 'git' }">تبويب Git</a>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
})
export class GitAdminPage {
  private readonly projects = inject(ProjectLookup);
  private readonly projectsApi = inject(ProjectsApi);
  private readonly gitApi = inject(GitIntegrationApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly security = WEBHOOK_SECURITY;
  protected readonly providerLabel = (p: Repository['provider']): string => PROVIDERS[p];
  protected readonly syncing = signal<string | null>(null);

  protected readonly rows = computed(() => repoRows(this.projects.items()));
  protected readonly loading = this.projects.loading;
  protected readonly projectsError = signal(false);
  protected readonly connectedCount = computed(() => this.rows().filter((r) => r.repo.connected).length);
  protected readonly errorCount = computed(() => this.rows().filter((r) => !!r.repo.lastSyncError).length);

  private readonly viewableIds = computed(() => [...new Set(this.rows().filter((r) => this.auth.can('git.view', r.project.id)).map((r) => r.project.id))]);

  /** Failed deliveries across the projects the user may see (one count per project). */
  protected readonly failed = rxResource<number, readonly string[]>({
    params: () => this.viewableIds(),
    stream: ({ params }) =>
      params.length
        ? forkJoin(params.map((id) => this.gitApi.deliveries(id, { page: 1, pageSize: 1, filters: { outcome: 'failed' } }).pipe(map((p) => p.total), catchError(() => of(0))))).pipe(
            map((counts) => counts.reduce((a, b) => a + b, 0)),
          )
        : of(0),
  });

  protected can(permission: 'git.sync' | 'git.view', projectId: string): boolean {
    return this.auth.can(permission, projectId);
  }

  protected reload(): void {
    this.projects.reload();
    this.failed.reload();
  }

  protected sync(row: RepoRow): void {
    this.syncing.set(row.repo.id);
    this.projectsApi.syncRepository(row.project.id, row.repo.id).subscribe({
      next: () => {
        this.syncing.set(null);
        this.toast.success(`تمت مزامنة ${row.repo.name}`);
        this.reload();
      },
      error: () => {
        this.syncing.set(null);
        // The server stored `lastSyncError`; refresh so the row shows it.
        this.reload();
      },
    });
  }
}

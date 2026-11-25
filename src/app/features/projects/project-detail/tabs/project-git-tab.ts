import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { map, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { CanDirective } from '@core/auth/can.directive';
import { isApiError } from '@core/models/api-error.model';
import { emptyPage, PagedResult } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { GitEventsApi } from '@domain/activity/activity.api';
import { GitEvent } from '@domain/activity/activity.models';
import { ProjectsApi } from '@domain/projects/project.api';
import { ProjectSummary, Repository } from '@domain/projects/project.models';
import { AppDatePipe, RelativeTimePipe } from '@shared/pipes/pipes';
import { Badge, BadgeTone } from '@shared/ui/badge/badge';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { Icon } from '@shared/ui/icon/icon';
import { GitDeliveries } from './git-deliveries';
import { providerLabel, WebhookStep, webhookSteps } from './git-logic';
import { GitRefPattern } from './git-ref-pattern';
import { GitSecretData, GitSecretDialog } from './git-secret-dialog';
import { GitSimulator } from './git-simulator';
import { RepositoryConnectData, RepositoryConnectDialog } from './repository-connect-dialog';

const KIND_LABELS: Record<GitEvent['kind'], string> = { push: 'دفع', pull_request: 'طلب دمج (PR)', merge: 'دمج' };
const KIND_TONES: Record<GitEvent['kind'], BadgeTone> = { push: 'info', pull_request: 'gold', merge: 'success' };

@Component({
  selector: 'app-project-git-tab',
  imports: [CanDirective, Badge, Icon, EmptyState, ErrorState, RelativeTimePipe, AppDatePipe, GitDeliveries, GitSimulator, GitRefPattern],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h3 class="section-title">المستودعات</h3>
      @if (!project().archived && canManage()) {
        <button type="button" class="btn btn--primary btn--sm" (click)="connect()">
          <app-icon name="link" [size]="14" /> ربط مستودع
        </button>
      }
    </div>
    @if (project().repositories.length) {
      <ul class="repos">
        @for (r of project().repositories; track r.id) {
          <li>
            <app-icon name="git" [size]="18" />
            <app-badge tone="neutral">{{ providerLabel(r.provider) }}</app-badge>
            <app-badge [tone]="r.connected ? 'success' : 'neutral'">{{ r.connected ? 'متصل' : 'مفصول' }}</app-badge>
            <strong class="ltr">{{ r.name }}</strong>
            <span class="muted">الفرع الافتراضي: <span class="ltr" dir="ltr">{{ r.defaultBranch }}</span></span>
            <span class="spacer"></span>
            @if (r.hasCredential) {
              <span class="muted">بيانات الاعتماد محفوظة</span>
            }
            @if (r.connected) {
              <button *appCan="'git.sync'; project: project().id" type="button" class="btn btn--outline btn--sm" [disabled]="syncing() === r.id" [attr.aria-busy]="syncing() === r.id" (click)="sync(r)">
                <app-icon name="refresh" [size]="14" /> {{ syncing() === r.id ? 'جارٍ المزامنة…' : 'مزامنة' }}
              </button>
            } @else {
              <button type="button" class="btn btn--outline btn--sm" disabled title="المستودع مفصول؛ أعد ربطه قبل المزامنة">
                <app-icon name="refresh" [size]="14" /> مزامنة
              </button>
            }
            @if (r.connected && canManage() && !project().archived) {
              <button type="button" class="btn btn--outline btn--sm" [disabled]="rotating() === r.id" (click)="rotate(r)">تدوير السر</button>
              <button type="button" class="btn btn--danger btn--sm" (click)="disconnect(r)">فصل</button>
            }
            @if (syncing() === r.id) {
              <div class="line bar" role="progressbar" aria-label="جارٍ مزامنة الإيداعات من الخادم"><span></span></div>
            }
            <p class="line muted sync-line" aria-live="polite">
              آخر مزامنة:
              @if (r.lastSyncAt; as at) {
                <span>{{ at | relativeTime }} <span class="ltr">({{ at | appDate: true }})</span></span>
              } @else {
                <span>لم تتم بعد</span>
              }
            </p>
            @if (syncError(r); as err) {
              <div class="line banner" role="alert">
                <app-icon name="alert" [size]="16" />
                <span><strong>تعذّرت المزامنة:</strong> {{ err }}</span>
              </div>
            }
            @if (webhookStepsFor(r); as steps) {
              <details class="line setup">
                <summary>إعداد Webhook</summary>
                <ol class="steps">
                  @for (s of steps; track $index) {
                    <li>
                      {{ s.text }}
                      @if (s.code) {
                        <span class="ltr code">{{ s.code }}</span>
                        @if ($first && r.webhookUrl) {
                          <button type="button" class="btn btn--ghost btn--sm" (click)="copy(s.code)"><app-icon name="link" [size]="14" /> نسخ</button>
                        }
                      }
                    </li>
                  }
                  <li class="muted">السر لا يُعرض بعد الربط؛ استخدم «تدوير السر» للحصول على سر جديد يُعرض مرة واحدة.</li>
                </ol>
              </details>
            }
          </li>
        }
      </ul>
    } @else {
      <app-empty-state icon="git" title="لا توجد مستودعات مرتبطة" text="اربط مستودعًا لتُربط الإيداعات وطلبات الدمج بالأعمال تلقائيًا." />
    }

    <app-git-deliveries class="block" [projectId]="project().id" [refreshKey]="refreshKey()" />

    @if (canManage() && !project().archived) {
      <app-git-ref-pattern [project]="project()" (changed)="changed.emit()" />
    }

    @if (simulatorEnabled && canSync() && connectedRepos().length) {
      <app-git-simulator [project]="project()" (simulated)="onSimulated()" />
    }

    <h3 class="section-title events-title">آخر أحداث Git</h3>
    @if (events.error()) {
      <app-error-state title="تعذّر تحميل أحداث Git" (retry)="events.reload()" />
    } @else if (events.value().items.length) {
      <ul class="events">
        @for (e of events.value().items; track e.id) {
          <li>
            <app-badge [tone]="kindTone(e.kind)">{{ kindLabel(e.kind) }}</app-badge>
            <div class="body">
              <strong>{{ e.title }}</strong>
              <div class="meta muted">
                <span class="ltr">{{ e.branch }}</span>
                <span class="ltr">{{ e.sha.slice(0, 7) }}</span>
                <span>{{ e.author }}</span>
                @for (ref of e.workItemRefs; track ref) {
                  <span class="ltr ref">{{ ref }}</span>
                }
              </div>
            </div>
            <span class="spacer"></span>
            <span class="muted">{{ (e.occurredAt ?? e.createdAt) | relativeTime }}</span>
            <a class="btn btn--ghost btn--icon btn--sm" [href]="e.url" target="_blank" rel="noopener noreferrer" aria-label="فتح في المستودع">
              <app-icon name="link" [size]="16" />
            </a>
          </li>
        }
      </ul>
    } @else if (!events.isLoading()) {
      <app-empty-state icon="git" title="لا توجد أحداث" />
    }
  `,
  styles: `
    .repos, .events { list-style: none; margin: 0; padding: 0; }
    .repos li, .events li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); flex-wrap: wrap; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
    .line { flex-basis: 100%; margin: 0; }
    .sync-line { font-size: var(--fs-sm); }
    .banner { display: flex; align-items: flex-start; gap: var(--s-2); padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--c-danger-bg); color: var(--c-danger); }
    .bar { block-size: 4px; border-radius: 2px; background: var(--c-border); overflow: hidden; }
    .bar span { display: block; inline-size: 40%; block-size: 100%; background: var(--c-primary); animation: slide 1.2s ease-in-out infinite; }
    @keyframes slide { from { margin-inline-start: -40%; } to { margin-inline-start: 100%; } }
    @media (prefers-reduced-motion: reduce) { .bar span { animation: none; inline-size: 100%; } }
    .setup summary { cursor: pointer; font-weight: 600; color: var(--c-primary); }
    .steps { margin: var(--s-2) 0 0; padding-inline-start: var(--s-5); display: grid; gap: var(--s-2); }
    .code { background: var(--c-surface-2); padding: 2px 6px; border-radius: 4px; word-break: break-all; }
    app-git-deliveries { display: block; margin-block-start: var(--s-6); }
    .events-title { margin-top: var(--s-6); }
    .body { display: flex; flex-direction: column; gap: 2px; }
    .meta { display: flex; gap: var(--s-3); font-size: var(--fs-sm); flex-wrap: wrap; }
    .ref { color: var(--c-primary); font-weight: 600; }
    .head { flex-wrap: wrap; }
    .body { flex: 1 1 200px; min-inline-size: 0; overflow-wrap: anywhere; }
    .repos strong, .meta .ltr { overflow-wrap: anywhere; }
    .banner { overflow-wrap: anywhere; }
    @media (max-width: 768px) {
      .spacer { display: none; }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .setup summary { display: flex; align-items: center; min-block-size: 44px; }
    }
  `,
})
export class ProjectGitTab {
  readonly project = input.required<ProjectSummary>();
  readonly changed = output<void>();

  private readonly api = inject(ProjectsApi);
  private readonly gitEvents = inject(GitEventsApi);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly confirmService = inject(ConfirmService);

  protected readonly syncing = signal<string | null>(null);
  protected readonly rotating = signal<string | null>(null);
  /** Last sync failure per repository (the 502 message), until the next successful sync. */
  private readonly syncErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly refreshKey = signal(0);
  /** Webhook simulator is a demo-only tool (mock backend). */
  /** The webhook simulator existed only in the in-app mock; real deliveries come from the Git server. */
  protected readonly simulatorEnabled = false;
  protected readonly providerLabel = providerLabel;

  protected readonly events = rxResource<PagedResult<GitEvent>, string>({
    params: () => this.project().id,
    stream: ({ params }) => this.gitEvents.list({ page: 1, pageSize: 10, filters: { projectId: params } }),
    defaultValue: emptyPage<GitEvent>(),
  });

  protected readonly canManage = computed(() => this.auth.can('git.manage', this.project().id));
  protected readonly canSync = computed(() => this.auth.can('git.sync', this.project().id));
  protected readonly connectedRepos = computed(() => this.project().repositories.filter((r) => r.connected));

  protected onSimulated(): void {
    this.events.reload();
    this.refreshKey.update((k) => k + 1);
  }

  protected webhookStepsFor(r: Repository): WebhookStep[] | null {
    return r.connected ? webhookSteps(r.provider, r.webhookUrl) : null;
  }

  /** The error of the attempt just made, else the one the server stored on the repository. */
  /** A disconnected repository is never synced, so an error left from before it was disconnected is not shown. */
  protected syncError(r: Repository): string | null {
    if (!r.connected) {
      return null;
    }
    return this.syncErrors()[r.id] ?? r.lastSyncError;
  }

  protected connect(): void {
    this.dialog
      .open<RepositoryConnectDialog, RepositoryConnectData, ProjectSummary>(RepositoryConnectDialog, {
        data: { projectId: this.project().id },
        width: 'min(640px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((saved) => {
        if (!saved) return;
        this.toast.success('تم ربط المستودع');
        this.changed.emit();
      });
  }

  protected disconnect(repo: Repository): void {
    this.confirmService
      .confirm({
        title: 'فصل المستودع',
        message: `سيتوقف استقبال الأحداث من «${repo.name}» وسيُحذف سر Webhook ورمز الوصول المحفوظان لدينا نهائيًا، فلا يمكن استرجاعهما (عند إعادة الربط تُدخل أسرارًا جديدة). يبقى سجل الروابط والأحداث السابقة كما هو.`,
        confirmText: 'فصل وحذف الأسرار',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.disconnectRepository(this.project().id, repo.id).subscribe(() => {
          this.toast.success('تم فصل المستودع وحُذفت أسراره');
          this.changed.emit();
        });
      });
  }

  protected rotate(repo: Repository): void {
    this.confirmService
      .confirm({
        title: 'تدوير سر Webhook',
        message: `سيُنشأ سر جديد لـ «${repo.name}» ويُعرض مرة واحدة فقط، ويتوقف السر الحالي عن العمل فورًا؛ ستُرفض التسليمات الواردة إلى أن تحدّث السر في إعدادات Webhook لدى مزوّد Git.`,
        confirmText: 'تدوير السر',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.rotating.set(repo.id);
        this.api.rotateSecret(this.project().id, repo.id).subscribe({
          next: (res) => {
            this.rotating.set(null);
            this.dialog.open<GitSecretDialog, GitSecretData, void>(GitSecretDialog, {
              data: { repoName: repo.name, secret: res.secret },
              width: 'min(560px, calc(100vw - 32px))',
              dismissible: false,
            });
            this.changed.emit();
          },
          error: () => this.rotating.set(null),
        });
      });
  }

  protected copy(text: string): void {
    void navigator.clipboard.writeText(text).then(() => this.toast.success('نُسخ الرابط'));
  }

  protected kindLabel(k: GitEvent['kind']): string {
    return KIND_LABELS[k];
  }

  protected kindTone(k: GitEvent['kind']): BadgeTone {
    return KIND_TONES[k];
  }

  /** FR-GIT-06: ingests the commits webhooks missed; reports how many were imported. */
  protected sync(repo: Repository): void {
    const projectId = this.project().id;
    const count$ = () => this.gitEvents.list({ page: 1, pageSize: 1, filters: { projectId } }).pipe(map((p) => p.total));
    this.syncing.set(repo.id);
    this.syncErrors.update((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== repo.id)));
    count$()
      .pipe(
        switchMap((before) =>
          this.api.syncRepository(projectId, repo.id).pipe(
            switchMap(() => count$()),
            map((after) => Math.max(0, after - before)),
          ),
        ),
      )
      .subscribe({
        next: (imported) => {
          this.syncing.set(null);
          this.toast.success(imported ? `استُوردت ${imported} commits مفقودة` : 'تمت المزامنة — لا توجد commits مفقودة');
          this.events.reload();
          this.refreshKey.update((k) => k + 1);
          this.changed.emit();
        },
        error: (e: unknown) => {
          this.syncing.set(null);
          if (isApiError(e)) this.syncErrors.update((m) => ({ ...m, [repo.id]: e.message }));
          // Reload so the server-stored `lastSyncError` is shown too.
          this.changed.emit();
        },
      });
  }
}

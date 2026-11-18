import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { GitEventsApi } from '@domain/activity/activity.api';
import { GitEvent } from '@domain/activity/activity.models';
import { suggestedBranch, summarizeDev } from '@domain/git/git.models';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { RelativeTimePipe } from '@shared/pipes/pipes';
import { Badge, BadgeTone } from '@shared/ui/badge/badge';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { GitLinkDialog, GitLinkDialogData } from './git-link-dialog';
import { ltr } from './work-item-utils';

type PrState = NonNullable<GitEvent['prState']>;
const PR_TONE: Readonly<Record<PrState, BadgeTone>> = { open: 'info', merged: 'success', closed: 'neutral' };
const PR_LABEL: Readonly<Record<PrState, string>> = { open: 'مفتوح', merged: 'مدموج', closed: 'مغلق' };

/** "التطوير" panel (FR-GIT-02/03/11): suggested branch, linked branches/PRs/commits, manual link and unlink. */
@Component({
  selector: 'app-dev-panel',
  imports: [NgTemplateOutlet, Icon, Badge, RelativeTimePipe, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="dev-title">
      <div class="card-body stack">
        <h3 class="section-title" id="dev-title"><app-icon name="git" [size]="16" /> التطوير</h3>

        <div class="branch">
          <span class="muted lbl">الفرع المقترح</span>
          <div class="copy">
            <code class="ltr">{{ branch() }}</code>
            <button type="button" class="btn btn--ghost btn--icon" aria-label="نسخ اسم الفرع" title="نسخ اسم الفرع" (click)="copy(branch())">
              <app-icon name="link" [size]="14" />
            </button>
          </div>
          <div class="copy">
            <code class="ltr">git checkout -b {{ branch() }}</code>
            <button type="button" class="btn btn--ghost btn--icon" aria-label="نسخ الأمر" title="نسخ الأمر" (click)="copy('git checkout -b ' + branch())">
              <app-icon name="link" [size]="14" />
            </button>
          </div>
          <p class="muted hint">اذكر الرمز {{ ltr(item().ref) }} في رسالة الـ commit أو اسم الفرع أو عنوان الـ PR ليُربط تلقائيًا.</p>
        </div>

        @if (events.isLoading() && !events.hasValue()) {
          <app-skeleton variant="lines" [count]="3" />
        } @else if (events.error()) {
          <app-error-state title="تعذّر تحميل أنشطة Git" (retry)="events.reload()" />
        } @else {
          @if (summary().branches.length) {
            <div>
              <h4 class="sub">الفروع</h4>
              <div class="chips">
                @for (b of summary().branches; track b) {
                  <span class="chip ltr">{{ b }}</span>
                }
              </div>
            </div>
          }
          @if (summary().pullRequests.length) {
            <div>
              <h4 class="sub">طلبات الدمج (PR)</h4>
              <ul class="items">
                @for (e of summary().pullRequests; track e.id) {
                  <li>
                    <div class="line">
                      @if (e.prNumber) {
                        <span class="ltr">#{{ e.prNumber }}</span>
                      }
                      <a [href]="e.url" target="_blank" rel="noopener noreferrer" class="grow">{{ e.title }}</a>
                      <app-badge [tone]="prTone(e)">{{ prLabel(e) }}</app-badge>
                    </div>
                    <div class="muted meta">
                      {{ e.author }} · {{ e.createdAt | relativeTime }}
                      <ng-container *ngTemplateOutlet="manual; context: { $implicit: e }" />
                    </div>
                  </li>
                }
              </ul>
            </div>
          }
          @if (summary().commits.length) {
            <div>
              <h4 class="sub">Commits</h4>
              <ul class="items">
                @for (e of summary().commits; track e.id) {
                  <li>
                    <div class="line">
                      <a [href]="e.url" target="_blank" rel="noopener noreferrer" class="ltr sha" [attr.aria-label]="'فتح Commit ' + e.sha.slice(0, 7)">{{ e.sha.slice(0, 7) }}</a>
                      <span class="grow">{{ e.title }}</span>
                    </div>
                    <div class="muted meta">
                      {{ e.author }} · {{ e.createdAt | relativeTime }}
                      <ng-container *ngTemplateOutlet="manual; context: { $implicit: e }" />
                    </div>
                  </li>
                }
              </ul>
            </div>
          }
          @if (!events.value()?.length) {
            <span class="muted">لا توجد أنشطة Git مرتبطة.</span>
          }
        }

        @if (canEdit()) {
          <button type="button" class="btn btn--outline" (click)="openLink()"><app-icon name="link" [size]="14" /> ربط Commit يدويًا</button>
        }
        <p class="muted note">دمج PR في Git لا يُغلق العنصر ولا يعتمده؛ الإغلاق يتم عبر سير العمل.</p>
      </div>
    </section>

    <ng-template #manual let-e>
      @if (isManual(e)) {
        <app-badge tone="gold">ربط يدوي</app-badge>
        @if (canEdit()) {
          <button type="button" class="btn btn--ghost unlink" (click)="unlink(e)">فك الربط</button>
        }
      }
    </ng-template>
  `,
  styles: `
    :host { display: block; }
    .lbl { font-size: var(--fs-xs); }
    .branch { display: flex; flex-direction: column; gap: var(--s-1); }
    .copy { display: flex; align-items: center; gap: var(--s-2); }
    .copy code { flex: 1; min-width: 0; overflow-wrap: anywhere; padding: 2px var(--s-2); background: var(--c-surface-2); border-radius: var(--r-sm); font-size: var(--fs-xs); }
    .hint, .note { margin: 0; font-size: var(--fs-xs); }
    .sub { margin: 0 0 var(--s-1); font-size: var(--fs-sm); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--s-1); }
    .chip { padding: 2px var(--s-2); border-radius: var(--r-pill); background: var(--c-emerald-50); font-size: var(--fs-xs); }
    .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); }
    .line { display: flex; align-items: center; gap: var(--s-2); font-size: var(--fs-sm); }
    .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .meta { font-size: var(--fs-xs); display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1); }
    .unlink { height: 22px; padding: 0 var(--s-2); font-size: var(--fs-xs); }
    .line { flex-wrap: wrap; }
    @media (pointer: coarse), (max-width: 768px) {
      .unlink, .btn--icon { min-height: 44px; min-width: 44px; }
      .sha { display: inline-flex; align-items: center; min-height: 44px; }
      .line a { display: inline-flex; align-items: center; min-height: 44px; }
    }
  `,
})
export class DevPanel {
  private readonly api = inject(GitEventsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly confirm = inject(ConfirmService);
  private readonly types = inject(WorkItemTypeLookup);

  readonly item = input.required<WorkItem>();

  protected readonly ltr = ltr;
  protected readonly events = rxResource({
    params: () => ({ ref: this.item().ref }),
    stream: ({ params }) => this.api.forWorkItem(params.ref),
  });
  protected readonly summary = computed(() => summarizeDev(this.events.value() ?? []));
  protected readonly branch = computed(() => suggestedBranch(this.item().ref, this.types.get(this.item().typeId)?.key));
  protected readonly canEdit = computed(() => this.auth.can('tasks.edit', this.item().projectId));

  private state(e: GitEvent): PrState {
    return e.prState ?? (e.kind === 'merge' ? 'merged' : 'open');
  }

  protected prTone(e: GitEvent): BadgeTone {
    return PR_TONE[this.state(e)];
  }

  protected prLabel(e: GitEvent): string {
    return PR_LABEL[this.state(e)];
  }

  protected isManual(e: GitEvent): boolean {
    return !!e.manualRefs?.includes(this.item().ref);
  }

  protected copy(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.toast.success('نُسخ'),
      () => this.toast.error('تعذّر النسخ'),
    );
  }

  protected openLink(): void {
    const item = this.item();
    this.dialog
      .open<GitLinkDialog, GitLinkDialogData, GitEvent>(GitLinkDialog, {
        data: { projectId: item.projectId, ref: item.ref },
        width: 'min(560px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((e) => {
        if (!e) return;
        this.api.link(e.id, item.ref).subscribe(() => {
          this.toast.success('تم الربط');
          this.events.reload();
        });
      });
  }

  protected unlink(e: GitEvent): void {
    const ref = this.item().ref;
    this.confirm
      .confirm({ title: 'فك الربط', message: `فك ربط هذا النشاط عن ${ltr(ref)}؟`, confirmText: 'فك الربط', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.unlink(e.id, ref).subscribe(() => {
          this.toast.success('تم فك الربط');
          this.events.reload();
        });
      });
  }
}

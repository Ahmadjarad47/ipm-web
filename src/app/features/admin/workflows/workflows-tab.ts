import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { PERMISSION_LABELS } from '@core/auth/permission-labels';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { StatusesApi, StatusLookup, WorkflowLookup, WorkflowsApi } from '@domain/workflow/workflow.api';
import { Status, Transition } from '@domain/workflow/workflow.models';
import { HELP } from '@shared/help/help-texts';
import { Badge } from '@shared/ui/badge/badge';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { Icon } from '@shared/ui/icon/icon';
import { ADMIN_HELP } from '../shared/admin-help';
import { AdminNotice } from '../shared/admin-notice';
import { errorEntries, fieldErrors, isConflict } from '../shared/api-errors';
import { ImpactPrompt } from '../shared/impact-dialog';
import { TransitionMatrix, TransitionToggle } from './transition-matrix';
import { TransitionRuleData, TransitionRuleDialog } from './transition-rule-dialog';

@Component({
  selector: 'app-workflows-tab',
  imports: [Badge, Icon, EmptyState, AdminNotice, TransitionMatrix, HelpTip, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflows-tab.scss',
  template: `
    <div class="stack">
      <app-admin-notice tone="warning">الأعمال الحالية تحتفظ بحالتها الحالية ولا تتأثر بتغيير سير العمل؛ التغييرات تحكم الانتقالات القادمة فقط (FR-WF-11).</app-admin-notice>

      @if (workflows.loading() && !workflows.items().length) {
        <app-skeleton variant="detail" [count]="4" />
      } @else if (!workflows.items().length) {
        <app-empty-state icon="flow" title="لا توجد مسارات عمل" text="تُنشأ المسارات مع بيانات النظام الأولية؛ تواصل مع مدير النظام إن كنت تتوقع مسارًا هنا." />
      } @else if (workflow(); as wf) {
        <div class="card"><div class="card-body stack">
          <div class="form-grid">
            <div class="field">
              <label for="wf-pick">سير العمل <app-help-tip [text]="scopeHelp" /></label>
              <select id="wf-pick" class="select" [value]="wf.id" (change)="select($event)">
                @for (w of workflows.items(); track w.id) {
                  <option [value]="w.id" [selected]="w.id === wf.id">{{ w.name }}</option>
                }
              </select>
              <span class="hint"><span class="ltr">{{ wf.key }}</span> · {{ wf.scope === 'project' ? 'للمشاريع' : 'للأعمال' }}</span>
            </div>
            <div class="field">
              <label for="wf-init">الحالة الابتدائية (واحدة بالضبط)</label>
              <select id="wf-init" class="select" [disabled]="!canManage()" (change)="setInitial($event)">
                @for (s of members(); track s.id) {
                  <option [value]="s.id" [selected]="s.id === initialId()">{{ s.name }}</option>
                }
              </select>
              @if (serverErrors()['initialStatusId']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
            </div>
          </div>

          <div>
            <h3 class="sub">حالات هذا المسار <app-help-tip [text]="categoryHelp" /></h3>
            <div class="chips">
              @for (s of members(); track s.id) {
                <span class="chip" [style.--sw]="s.color">
                  <span class="dot"></span>{{ s.name }}
                  @if (s.id === initialId()) {
                    <app-badge tone="gold">ابتدائية</app-badge>
                  } @else if (canManage()) {
                    <button type="button" class="x" (click)="removeStatus(s.id)" [attr.aria-label]="'إزالة ' + s.name"><app-icon name="close" [size]="12" /></button>
                  }
                </span>
              }
              @if (canManage() && available().length) {
                <select class="select add" aria-label="إضافة حالة" (change)="addStatus($event)">
                  <option value="">+ إضافة حالة…</option>
                  @for (s of available(); track s.id) {
                    <option [value]="s.id">{{ s.name }}</option>
                  }
                </select>
              }
            </div>
          </div>
        </div></div>

        <section class="card" aria-labelledby="mx-title"><div class="card-body stack">
          <h3 class="section-title" id="mx-title">مصفوفة الانتقالات <app-help-tip [text]="blockedHelp" label="شرح قواعد الانتقال" /></h3>
          <app-transition-matrix [statuses]="members()" [transitions]="visibleTransitions()" [readonly]="!canManage()"
            (toggled)="toggle($event)" (editRule)="editRule($event)" />
        </div></section>

        <section class="card" aria-labelledby="list-title"><div class="card-body stack">
          <h3 class="section-title" id="list-title">الانتقالات المسموحة ({{ visibleTransitions().length }})</h3>
          <ul class="tlist">
            @for (t of visibleTransitions(); track t.fromStatusId + t.toStatusId) {
              <li>
                <strong>{{ nameOf(t.fromStatusId) }}</strong> ← <strong>{{ nameOf(t.toStatusId) }}</strong>
                @for (b of badges(t); track b) {
                  <app-badge tone="gold">{{ b }}</app-badge>
                }
              </li>
            } @empty {
              <li class="muted">لا توجد انتقالات مسموحة بعد.</li>
            }
          </ul>
        </div></section>

        @if (canManage()) {
          <div class="row">
            <button type="button" class="btn btn--primary" [disabled]="!dirty() || saving()" (click)="save(wf.id, wf.version)">{{ saving() ? 'جارٍ الحفظ…' : 'حفظ سير العمل' }}</button>
            <button type="button" class="btn btn--outline" [disabled]="!dirty()" (click)="reset()">تراجع عن التغييرات</button>
            @if (dirty()) {
              <span class="muted">توجد تغييرات غير محفوظة.</span>
            }
          </div>
        }

        @if (serverMessage() || errorList().length) {
          <section class="card err-box" role="alert" aria-label="أخطاء الحفظ"><div class="card-body stack">
            @if (serverMessage(); as m) { <strong>{{ m }}</strong> }
            @if (errorList().length) {
              <ul>
                @for (e of errorList(); track e[0]) { <li>{{ e[1] }}</li> }
              </ul>
            }
            @if (conflictList().length) {
              <ul class="conflict-list" aria-label="الحالات التي عليها أعمال">
                @for (c of conflictList(); track c[0]) { <li><strong>«{{ c[0] }}»</strong>: {{ c[1] }}</li> }
              </ul>
              <p>انقل الأعمال أولًا إلى حالة أخرى باقية في المسار (من لوحة كانبان أو الإجراءات الجماعية)، ثم أعد حفظ المسار.</p>
            }
          </div></section>
        }
      }
    </div>
  `,
})
export class WorkflowsTab {
  protected readonly workflows = inject(WorkflowLookup);
  private readonly statuses = inject(StatusLookup);
  private readonly statusesApi = inject(StatusesApi);
  private readonly impact = inject(ImpactPrompt);
  protected readonly scopeHelp = ADMIN_HELP.workflowScope;
  protected readonly categoryHelp = HELP.statusCategory;
  protected readonly blockedHelp = HELP.blockedByOpenDependencies;
  protected readonly serverMessage = signal('');
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly conflictList = signal<readonly (readonly [string, string])[]>([]);
  /** 400 details that are not shown next to a control (statusIds, transitions, ...). */
  protected readonly errorList = computed(() => Object.entries(this.serverErrors()).filter(([k]) => k !== 'initialStatusId'));
  private readonly api = inject(WorkflowsApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly canManage = computed(() => this.auth.can('workflows.manage'));
  protected readonly saving = signal(false);

  private readonly selectedId = signal<string | null>(null);
  protected readonly workflow = computed(() => this.workflows.get(this.selectedId()) ?? this.workflows.items()[0]);

  // Draft state resets whenever the selected workflow (or its saved version) changes.
  protected readonly statusIds = linkedSignal<readonly string[]>(() => this.workflow()?.statusIds ?? []);
  protected readonly initialId = linkedSignal<string>(() => this.workflow()?.initialStatusId ?? '');
  protected readonly transitions = linkedSignal<readonly Transition[]>(() => this.workflow()?.transitions ?? []);
  protected readonly dirty = linkedSignal<boolean>(() => {
    this.workflow();
    return false;
  });

  protected readonly members = computed(() =>
    this.statusIds()
      .map((id) => this.statuses.get(id))
      .filter((s): s is Status => !!s),
  );

  protected readonly available = computed(() => {
    const scope = this.workflow()?.scope;
    const used = new Set(this.statusIds());
    return this.statuses.items().filter((s) => s.scope === scope && s.active && !used.has(s.id));
  });

  protected readonly visibleTransitions = computed(() => {
    const ids = new Set(this.statusIds());
    return this.transitions().filter((t) => ids.has(t.fromStatusId) && ids.has(t.toStatusId));
  });

  protected nameOf(id: string): string {
    return this.statuses.get(id)?.name ?? '—';
  }

  protected badges(t: Transition): string[] {
    return [
      ...(t.permission ? [`صلاحية: ${PERMISSION_LABELS[t.permission]}`] : []),
      ...(t.requiresAssignee ? ['يتطلب مكلَّفًا'] : []),
      ...(t.requiresApproval ? ['يتطلب موافقة'] : []),
      ...(t.blockedByOpenDependencies ? ['تمنعه اعتماديات مفتوحة'] : []),
    ];
  }

  protected select(event: Event): void {
    this.selectedId.set((event.target as HTMLSelectElement).value);
  }

  protected setInitial(event: Event): void {
    this.initialId.set((event.target as HTMLSelectElement).value);
    this.dirty.set(true);
  }

  protected addStatus(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select.value) {
      this.statusIds.update((ids) => [...ids, select.value]);
      this.dirty.set(true);
    }
    select.value = '';
  }

  /** FR-WF-06: preview the impact first, then drop the status (and its transitions) from the draft. */
  protected removeStatus(id: string): void {
    const name = this.nameOf(id);
    this.impact
      .confirm({
        title: 'إزالة حالة من المسار',
        intro: `ستُزال «${name}» من هذا المسار مع انتقالاتها. لا يُحفظ التغيير إلا بزر «حفظ سير العمل».`,
        kind: 'status',
        load: this.statusesApi.impact(id),
        guidance: 'إن وُجدت أعمال في هذه الحالة فسيرفض الخادم الحفظ: انقل الأعمال أولًا إلى حالة أخرى باقية في المسار.',
        confirmText: 'إزالة من المسار',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.statusIds.update((ids) => ids.filter((i) => i !== id));
        this.transitions.update((list) => list.filter((t) => t.fromStatusId !== id && t.toStatusId !== id));
        this.dirty.set(true);
      });
  }

  protected toggle(change: TransitionToggle): void {
    const { fromStatusId, toStatusId, allowed } = change;
    this.transitions.update((list) => {
      const rest = list.filter((t) => !(t.fromStatusId === fromStatusId && t.toStatusId === toStatusId));
      return allowed ? [...rest, { fromStatusId, toStatusId }] : rest;
    });
    this.dirty.set(true);
  }

  protected editRule(transition: Transition): void {
    this.dialog
      .open<TransitionRuleDialog, TransitionRuleData, Transition>(TransitionRuleDialog, {
        data: { fromName: this.nameOf(transition.fromStatusId), toName: this.nameOf(transition.toStatusId), transition },
        width: 'min(480px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((updated) => {
        if (!updated) return;
        this.transitions.update((list) =>
          list.map((t) => (t.fromStatusId === updated.fromStatusId && t.toStatusId === updated.toStatusId ? updated : t)),
        );
        this.dirty.set(true);
      });
  }

  protected reset(): void {
    const wf = this.workflow();
    this.statusIds.set(wf?.statusIds ?? []);
    this.initialId.set(wf?.initialStatusId ?? '');
    this.transitions.set(wf?.transitions ?? []);
    this.dirty.set(false);
    this.clearErrors();
  }

  private clearErrors(): void {
    this.serverMessage.set('');
    this.serverErrors.set({});
    this.conflictList.set([]);
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  protected save(id: string, version: number): void {
    if (!this.statusIds().includes(this.initialId())) {
      this.toast.error('يجب أن تكون الحالة الابتدائية إحدى حالات المسار.');
      return;
    }
    this.saving.set(true);
    this.clearErrors();
    this.api
      .update(id, {
        statusIds: this.statusIds(),
        initialStatusId: this.initialId(),
        transitions: this.visibleTransitions(),
        version,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('تم حفظ سير العمل');
          this.workflows.reload();
        },
        error: (e: unknown) => {
          this.saving.set(false);
          // Stale version: the interceptor toasted the message; reload so the draft resets to the fresh version.
          if (!isApiError(e)) return;
          if (e.status === 409) {
            this.workflows.reload();
          } else if (isConflict(e)) {
            // {statusName: count}: items (or projects) still sitting in a status the new definition removes.
            const noun = this.workflow()?.scope === 'project' ? 'مشروعًا' : 'عملًا';
            this.serverMessage.set(e.message);
            this.conflictList.set(errorEntries(e).map(([name, count]) => [name, /^\d+$/.test(count) ? `${count} ${noun}` : count] as const));
          } else {
            this.serverMessage.set(e.message);
            this.serverErrors.set(fieldErrors(e));
          }
        },
      });
  }
}

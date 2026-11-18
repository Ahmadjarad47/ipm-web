import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectsApi } from '@domain/projects/project.api';
import { ProjectSummary } from '@domain/projects/project.models';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { WorkflowLookup } from '@domain/workflow/workflow.api';
import { TypeChip } from '@shared/domain-ui/domain-ui';
import { Badge } from '@shared/ui/badge/badge';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { buildOverrideMap, ConflictRow, conflictRows, sameOverrides } from '../project-workflow-overrides';

const OVERRIDE_HELP = 'اختر سير عمل مختلفًا لنوع معيّن داخل هذا المشروع فقط. لا يُسمح بالتغيير إذا كانت عناصر قائمة في حالات غير موجودة في سير العمل الجديد.';

let nextId = 0;

/** FR-TYP-04: which work item types this project offers, and the default for new items. */
@Component({
  selector: 'app-project-settings-tab',
  imports: [TypeChip, Badge, HelpTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="section-title">أنواع عناصر العمل</h3>
    <p class="muted note">إلغاء إتاحة نوع يمنع إنشاء عناصر جديدة منه فقط؛ العناصر الحالية تبقى قابلة للعرض والتقارير.</p>
    <ul class="types">
      @for (t of types(); track t.id) {
        <li>
          <app-type-chip [typeId]="t.id" />
          <span class="muted desc">{{ t.description }}</span>
          <span class="spacer"></span>
          @if (!t.active) {
            <app-badge tone="neutral">معطّل</app-badge>
          }
          <label class="checkbox">
            <input type="checkbox" [checked]="allowed().includes(t.id)" [disabled]="locked() || (!t.active && !originallyAllowed().includes(t.id))" (change)="toggle(t.id)" />
            متاح في هذا المشروع
          </label>
          <label class="checkbox">
            <input type="radio" [name]="uid + '-default-type'" [checked]="defaultId() === t.id" [disabled]="locked() || !allowed().includes(t.id) || !t.active" (change)="defaultId.set(t.id)" />
            افتراضي
          </label>
        </li>
      }
    </ul>
    @if (error(); as e) {
      <p class="error" role="alert">{{ e }}</p>
    }
    @if (!project().archived) {
      <div class="actions">
        <button type="button" class="btn btn--primary" [disabled]="!canSave()" (click)="save()">حفظ</button>
      </div>
    } @else {
      <p class="muted note">المشروع مؤرشف، الإعدادات للقراءة فقط.</p>
    }

    <h3 class="section-title overrides-title">
      سير العمل لكل نوع
      <app-help-tip [text]="overrideHelp" />
    </h3>
    <p class="muted note">استثناء سير العمل (FR-WF-10) يخص هذا المشروع فقط ولا يغيّر سير العمل الافتراضي للنوع.</p>
    <ul class="types">
      @for (t of allowedTypes(); track t.id) {
        <li>
          <app-type-chip [typeId]="t.id" />
          <span class="spacer"></span>
          <label class="wf-label" [for]="'wf-' + t.id">سير العمل:</label>
          <select [id]="'wf-' + t.id" class="select wf" [disabled]="!canOverride() || savingOverrides()" (change)="setOverride(t.id, $event)">
            <option value="" [selected]="!overrides()[t.id]">الافتراضي ({{ workflowName(t.workflowId) }})</option>
            @for (w of itemWorkflows(); track w.id) {
              @if (w.id !== t.workflowId) {
                <option [value]="w.id" [selected]="overrides()[t.id] === w.id">{{ w.name }}</option>
              }
            }
          </select>
        </li>
      } @empty {
        <li class="muted">لا توجد أنواع متاحة في هذا المشروع.</li>
      }
    </ul>
    @if (!canOverride() && !project().archived) {
      <p class="muted note">تغيير سير العمل يتطلب صلاحيتي «إدارة سير العمل» و«ضبط أنواع المشروع».</p>
    }
    @if (conflicts().length) {
      <div class="alert" role="alert">
        <strong>تعذّر تطبيق سير العمل المختار</strong>
        <p>توجد عناصر قائمة في حالات غير موجودة في سير العمل الجديد. انقل هذه العناصر إلى حالة صالحة أو اختر سير عمل يحتوي حالاتها، ثم أعد المحاولة.</p>
        <ul>
          @for (c of conflicts(); track c.label) {
            <li><strong>{{ c.label }}</strong>: {{ c.count }} عنصر</li>
          }
        </ul>
      </div>
    } @else if (overrideError(); as e) {
      <p class="error" role="alert">{{ e }}</p>
    }
    @if (canOverride()) {
      <div class="actions">
        <button type="button" class="btn btn--primary" [disabled]="!overridesDirty() || savingOverrides()" (click)="saveOverrides()">حفظ سير العمل</button>
      </div>
    }
  `,
  styles: `
    .types { list-style: none; margin: 0; padding: 0; }
    .types li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); flex-wrap: wrap; }
    .note { margin: 0 0 var(--s-3); font-size: var(--fs-sm); }
    .actions { margin-block-start: var(--s-4); }
    .error { color: var(--c-danger); }
    .overrides-title { margin-block-start: var(--s-6); }
    .wf { width: auto; min-width: min(100%, 220px); }
    .wf-label { font-size: var(--fs-sm); color: var(--c-muted); }
    .alert { margin-block-start: var(--s-3); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--c-danger-bg); color: var(--c-danger); }
    .alert p { margin: var(--s-1) 0; font-size: var(--fs-sm); }
    .alert ul { margin: 0; padding-inline-start: var(--s-5); }
    .desc { flex: 1 1 160px; min-inline-size: 0; overflow-wrap: anywhere; }
    @media (max-width: 768px) {
      .spacer { display: none; }
      .wf { flex: 1 1 100%; }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .types .checkbox { min-block-size: 44px; }
      .types .checkbox input { inline-size: 20px; block-size: 20px; }
    }
  `,
})
export class ProjectSettingsTab {
  readonly project = input.required<ProjectSummary>();
  readonly changed = output<void>();
  protected readonly uid = `ps${++nextId}`;

  private readonly api = inject(ProjectsApi);
  private readonly lookup = inject(WorkItemTypeLookup);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly workflows = inject(WorkflowLookup);

  protected readonly saving = signal(false);

  protected readonly overrideHelp = OVERRIDE_HELP;
  protected readonly savingOverrides = signal(false);
  protected readonly overrideError = signal<string | null>(null);
  protected readonly conflicts = signal<readonly ConflictRow[]>([]);
  protected readonly overrides = linkedSignal<Readonly<Record<string, string>>>(() => this.project().workflowOverrides ?? {});
  protected readonly itemWorkflows = computed(() => this.workflows.items().filter((w) => w.scope === 'workItem'));
  protected readonly allowedTypes = computed(() => this.types().filter((t) => this.project().allowedTypeIds.includes(t.id)));
  /** FR-WF-10: needs both `workflows.manage` and `project.workitemtypes.configure`. */
  protected readonly canOverride = computed(
    () => !this.project().archived && this.auth.can('workflows.manage') && this.auth.can('project.workitemtypes.configure', this.project().id),
  );
  protected readonly overridesDirty = computed(() => !sameOverrides(this.overrides(), this.project().workflowOverrides));
  protected readonly allowed = linkedSignal<readonly string[]>(() => this.project().allowedTypeIds);
  protected readonly defaultId = linkedSignal<string>(() => this.project().defaultTypeId);

  protected readonly types = computed(() => [...this.lookup.items()].sort((a, b) => a.order - b.order));
  protected readonly originallyAllowed = computed(() => this.project().allowedTypeIds);
  protected readonly locked = computed(() => this.project().archived || this.saving());

  protected readonly dirty = computed(() => {
    const p = this.project();
    const a = this.allowed();
    return this.defaultId() !== p.defaultTypeId || a.length !== p.allowedTypeIds.length || a.some((id) => !p.allowedTypeIds.includes(id));
  });
  protected readonly error = computed(() => {
    if (!this.allowed().length) return 'يجب إتاحة نوع واحد على الأقل.';
    if (!this.allowed().includes(this.defaultId())) return 'يجب أن يكون النوع الافتراضي من الأنواع المتاحة.';
    return null;
  });
  protected readonly canSave = computed(() => this.dirty() && !this.error() && !this.locked());

  protected workflowName(id: string): string {
    return this.workflows.get(id)?.name ?? '—';
  }

  protected setOverride(typeId: string, event: Event): void {
    const workflowId = (event.target as HTMLSelectElement).value;
    const rows = this.allowedTypes().map((t) => ({ typeId: t.id, workflowId: t.id === typeId ? workflowId : (this.overrides()[t.id] ?? '') }));
    // Keep overrides of types no longer offered so saving never silently drops them.
    const hidden = Object.entries(this.overrides()).filter(([id]) => !this.allowedTypes().some((t) => t.id === id)).map(([id, wf]) => ({ typeId: id, workflowId: wf }));
    this.overrides.set(buildOverrideMap([...rows, ...hidden]));
    this.conflicts.set([]);
    this.overrideError.set(null);
  }

  protected saveOverrides(): void {
    if (!this.canOverride() || !this.overridesDirty()) return;
    const p = this.project();
    this.savingOverrides.set(true);
    this.conflicts.set([]);
    this.overrideError.set(null);
    this.api.setWorkflowOverrides(p.id, this.overrides(), p.version).subscribe({
      next: () => {
        this.savingOverrides.set(false);
        this.toast.success('تم حفظ سير العمل للمشروع');
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.savingOverrides.set(false);
        if (!isApiError(err)) return;
        if (err.status === 422 && err.details) this.conflicts.set(conflictRows(err.details));
        else if (err.status === 409) this.changed.emit();
        else this.overrideError.set(err.message);
      },
    });
  }

  protected toggle(id: string): void {
    const on = this.allowed().includes(id);
    this.allowed.set(on ? this.allowed().filter((x) => x !== id) : [...this.allowed(), id]);
    if (on && this.defaultId() === id) this.defaultId.set('');
  }

  protected save(): void {
    if (!this.canSave()) return;
    const p = this.project();
    this.saving.set(true);
    this.api.configureTypes(p.id, this.allowed(), this.defaultId(), p.version).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('تم حفظ أنواع المشروع');
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        // The interceptor already toasted; on conflict reload so the retry uses the new version.
        if (isApiError(err) && err.status === 409) this.changed.emit();
      },
    });
  }
}

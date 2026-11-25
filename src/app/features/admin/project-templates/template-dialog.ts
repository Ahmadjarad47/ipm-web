import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, startWith } from 'rxjs';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectTemplate, ProjectTemplateLookup, ProjectTemplatesApi } from '@domain/projects/project-template';
import { RoleLookup, UserLookup } from '@domain/users/user.api';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { StatusLookup, WorkflowLookup } from '@domain/workflow/workflow.api';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { ADMIN_HELP } from '../shared/admin-help';
import { AdminNotice } from '../shared/admin-notice';
import { fieldErrors } from '../shared/api-errors';
import { memberRowErrors, MemberRow, PREVIEW_LABELS, previewMembers } from './suggested-members';

type MemberForm = FormGroup<{ userId: FormControl<string>; roleId: FormControl<string> }>;

const TEMPLATE_CONTROLS: readonly string[] = ['name', 'durationDays', 'allowedTypeIds', 'defaultTypeId', 'initialStatusId'];

export interface TemplateDialogData {
  readonly template: ProjectTemplate | null;
}

/** Create / edit a project template (FR-PRJ-10). */
@Component({
  selector: 'app-project-template-dialog',
  imports: [ReactiveFormsModule, DialogShell, AdminNotice, HelpTip, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); }
    .span-2 { grid-column: 1 / -1; }
    fieldset { margin: 0; padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); }
    legend { padding-inline: var(--s-2); font-size: var(--fs-sm); font-weight: 600; color: var(--c-text-2); }
    .mrow { display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--s-2); align-items: center; inline-size: 100%; }
    .mrow .error { grid-column: 1 / -1; }
    .members { inline-size: 100%; flex-direction: column; flex-wrap: nowrap; }
    .prev { inline-size: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .prev th, .prev td { padding: var(--s-1) var(--s-2); text-align: start; border-block-end: 1px solid var(--c-border); }
    .prev th { font-size: var(--fs-xs); color: var(--c-muted); font-weight: 600; }
    .ok { color: var(--c-success, var(--c-emerald-800)); }
    .skip { color: var(--c-warning); }
    .error { font-size: var(--fs-xs); color: var(--c-danger); }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } .mrow { grid-template-columns: 1fr; } }
  `,
  template: `
    <app-dialog-shell [title]="editing ? 'تعديل قالب مشروع' : 'قالب مشروع جديد'">
      <form id="pt-form" [formGroup]="form" (ngSubmit)="save()" class="stack">
        <app-admin-notice>تعديل القالب لا يغيّر المشاريع المنشأة منه سابقًا.</app-admin-notice>
        <div class="grid">
          <div class="field">
            <label for="pt-name">الاسم <span class="req">*</span></label>
            <input id="pt-name" class="input" formControlName="name" [attr.aria-invalid]="(form.controls.name.invalid && form.controls.name.touched) || srv().top['name'] ? 'true' : null" />
            @if (form.controls.name.invalid && form.controls.name.touched) { <span class="error" role="alert">الاسم مطلوب.</span> }
            @if (srv().top['name']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field">
            <label for="pt-days">المدة الافتراضية (أيام) <span class="req">*</span></label>
            <input id="pt-days" class="input ltr" type="number" min="1" formControlName="durationDays" />
            @if (form.controls.durationDays.invalid && form.controls.durationDays.touched) { <span class="error" role="alert">أدخل عددًا صحيحًا موجبًا.</span> }
            @if (srv().top['durationDays']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field span-2">
            <label for="pt-desc">الوصف</label>
            <textarea id="pt-desc" class="textarea" rows="2" formControlName="description"></textarea>
          </div>
        </div>

        <fieldset>
          <legend>أنواع الأعمال المسموحة <span class="req">*</span></legend>
          @for (t of types(); track t.id) {
            <label class="checkbox">
              <input type="checkbox" [checked]="allowed().includes(t.id)" (change)="toggleType(t.id, $any($event.target).checked)" /> {{ t.name }}
            </label>
          }
        </fieldset>
        @if (touched() && !allowed().length) { <p class="error" role="alert">اختر نوعًا واحدًا على الأقل.</p> }
        @if (srv().top['allowedTypeIds']; as msg) { <p class="error" role="alert">{{ msg }}</p> }

        <div class="grid">
          <div class="field">
            <label for="pt-def">النوع الافتراضي <span class="req">*</span></label>
            <select id="pt-def" class="select" formControlName="defaultTypeId">
              <option value="">— اختر —</option>
              @for (t of allowedTypes(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
            </select>
            @if (touched() && allowed().length && !defaultValid()) { <span class="error" role="alert">النوع الافتراضي يجب أن يكون ضمن الأنواع المسموحة.</span> }
            @if (srv().top['defaultTypeId']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field">
            <label for="pt-status">الحالة الابتدائية <span class="req">*</span></label>
            <select id="pt-status" class="select" formControlName="initialStatusId">
              <option value="">— اختر —</option>
              @for (s of projectStatuses(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
            </select>
            @if (form.controls.initialStatusId.invalid && form.controls.initialStatusId.touched) { <span class="error" role="alert">اختر الحالة الابتدائية.</span> }
            @if (srv().top['initialStatusId']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
        </div>

        <fieldset>
          <legend>أدوار المشروع المقترحة</legend>
          @for (r of projectRoles(); track r.id) {
            <label class="checkbox">
              <input type="checkbox" [checked]="roleIds().includes(r.id)" (change)="toggleRole(r.id, $any($event.target).checked)" /> {{ r.name }}
            </label>
          } @empty {
            <span class="muted">لا توجد أدوار مشروع.</span>
          }
        </fieldset>

        <fieldset class="members">
          <legend>الأعضاء المقترحون <app-help-tip [text]="membersHelp" /></legend>
          @for (row of members.controls; track row; let i = $index) {
            <div class="mrow" [formGroup]="row">
              <select class="select" formControlName="userId" [attr.aria-label]="'المستخدم في الصف ' + (i + 1)">
                <option value="">— بدون مستخدم (دور فقط) —</option>
                @for (u of userOptions(); track u.id) { <option [value]="u.id">{{ u.name }}@if (!u.active) { (غير نشط) }</option> }
              </select>
              <select class="select" formControlName="roleId" [attr.aria-label]="'الدور في الصف ' + (i + 1)" [attr.aria-invalid]="rowError(i) ? 'true' : null">
                <option value="">— اختر دور المشروع —</option>
                @for (r of projectRoles(); track r.id) { <option [value]="r.id">{{ r.name }}</option> }
              </select>
              <button type="button" class="btn btn--ghost btn--sm btn--icon" (click)="removeMember(i)" [attr.aria-label]="'حذف العضو المقترح ' + (i + 1)"><app-icon name="trash" [size]="15" /></button>
              @if (rowError(i); as msg) { <span class="error" role="alert">{{ msg }}</span> }
            </div>
          } @empty {
            <span class="muted">لا يوجد أعضاء مقترحون.</span>
          }
          <div><button type="button" class="btn btn--outline btn--sm" (click)="addMember()"><app-icon name="plus" [size]="14" /> عضو مقترح</button></div>

          @if (preview().length) {
            <div class="scroll-x"><table class="prev">
              <caption class="sr-only">الأعضاء الفعليون عند إنشاء مشروع من هذا القالب</caption>
              <thead><tr><th scope="col">المستخدم</th><th scope="col">الدور</th><th scope="col">النتيجة</th></tr></thead>
              <tbody>
                @for (p of preview(); track p.index) {
                  <tr>
                    <td>{{ p.userName }}</td>
                    <td>{{ p.roleName }}</td>
                    <td [class.ok]="p.status === 'added'" [class.skip]="p.status !== 'added' && p.status !== 'role-only'">{{ previewLabels[p.status] }}</td>
                  </tr>
                }
              </tbody>
            </table></div>
          }
          <span class="hint">معاينة الأعضاء الفعليين: يُضاف دائمًا مالك المشروع ومنشئه بدور «مدير المشروع»، ثم الأعضاء أعلاه عند إنشاء المشروع.</span>
          @for (m of srv().members; track m) { <span class="error" role="alert">{{ m }}</span> }
        </fieldset>

        <label class="checkbox"><input type="checkbox" formControlName="active" /> قالب نشط</label>

        @for (d of srv().general; track d) { <p class="error" role="alert">{{ d }}</p> }
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="pt-form" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : editing ? 'حفظ' : 'إنشاء القالب' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class TemplateDialog {
  protected readonly ref = inject<DialogRef<ProjectTemplate>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as TemplateDialogData;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(ProjectTemplatesApi);
  private readonly lookup = inject(ProjectTemplateLookup);
  private readonly typeLookup = inject(WorkItemTypeLookup);
  private readonly statusLookup = inject(StatusLookup);
  private readonly workflows = inject(WorkflowLookup);
  private readonly roleLookup = inject(RoleLookup);
  private readonly userLookup = inject(UserLookup);
  protected readonly membersHelp = ADMIN_HELP.suggestedMembers;
  protected readonly previewLabels = PREVIEW_LABELS;
  private readonly toast = inject(ToastService);

  protected readonly editing = this.data.template;
  protected readonly saving = signal(false);
  protected readonly touched = signal(false);
  private readonly serverDetails = signal<Readonly<Record<string, string>>>({});

  /** 400/422 details: top-level controls, per-member rows (`suggestedMembers[i].roleId`) and the rest. */
  protected readonly srv = computed(() => {
    const top: Record<string, string> = {};
    const members: string[] = [];
    const general: string[] = [];
    for (const [key, message] of Object.entries(this.serverDetails())) {
      if (TEMPLATE_CONTROLS.includes(key)) top[key] = message;
      else if (key.startsWith('suggestedMembers')) members.push(message);
      else general.push(message);
    }
    return { top, members, general };
  });
  protected readonly allowed = signal<readonly string[]>(this.editing?.allowedTypeIds ?? []);
  protected readonly roleIds = signal<readonly string[]>(this.editing?.suggestedRoleIds ?? []);

  protected readonly members = this.fb.array<MemberForm>(
    (this.editing?.suggestedMembers ?? []).map((m) => this.memberForm(m.userId ?? '', m.roleId)),
  );
  private readonly memberRows = toSignal(this.members.valueChanges.pipe(startWith(null), map(() => this.members.getRawValue() as MemberRow[])), {
    initialValue: this.members.getRawValue() as MemberRow[],
  });
  private readonly submitted = signal(false);
  private readonly roleInfo = computed(() => new Map(this.roleLookup.items().map((r) => [r.id, { name: r.name, scope: r.scope }] as const)));
  private readonly userInfo = computed(() => new Map(this.userLookup.items().map((u) => [u.id, { name: u.name, active: u.active }] as const)));
  protected readonly preview = computed(() => previewMembers(this.memberRows(), this.userInfo(), this.roleInfo()));
  private readonly rowErrors = computed(() => memberRowErrors(this.memberRows(), this.roleInfo()));
  protected readonly userOptions = computed(() => {
    const chosen = new Set(this.memberRows().map((r) => r.userId));
    return this.userLookup.items().filter((u) => u.active || chosen.has(u.id));
  });

  protected readonly types = computed(() => this.typeLookup.items().filter((t) => t.active || this.allowed().includes(t.id)));
  protected readonly allowedTypes = computed(() => this.typeLookup.items().filter((t) => this.allowed().includes(t.id)));
  protected readonly projectRoles = computed(() => this.roleLookup.items().filter((r) => r.scope === 'project'));
  protected readonly projectStatuses = computed(() => {
    const ids = this.workflows.projectWorkflow()?.statusIds ?? [];
    return this.statusLookup.items().filter((s) => s.scope === 'project' && ids.includes(s.id));
  });

  protected readonly form = this.fb.group({
    name: this.fb.control(this.editing?.name ?? '', Validators.required),
    description: this.fb.control(this.editing?.description ?? ''),
    active: this.fb.control(this.editing?.active ?? true),
    defaultTypeId: this.fb.control(this.editing?.defaultTypeId ?? '', Validators.required),
    initialStatusId: this.fb.control(this.editing?.initialStatusId ?? '', Validators.required),
    durationDays: this.fb.control(this.editing?.durationDays ?? 90, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
  });

  private readonly defaultId = toSignal(this.form.controls.defaultTypeId.valueChanges, { initialValue: this.form.controls.defaultTypeId.value });
  protected readonly defaultValid = computed(() => this.allowed().includes(this.defaultId()));

  private memberForm(userId: string, roleId: string): MemberForm {
    return this.fb.group({ userId: this.fb.control(userId), roleId: this.fb.control(roleId) });
  }

  protected addMember(): void {
    this.members.push(this.memberForm('', ''));
  }

  protected removeMember(index: number): void {
    this.members.removeAt(index);
  }

  protected rowError(index: number): string | null {
    // Blocking rules show once the admin tried to save; the preview already explains skipped rows live.
    return this.submitted() ? (this.rowErrors().get(index) ?? null) : null;
  }

  protected toggleType(id: string, checked: boolean): void {
    this.allowed.update((ids) => (checked ? [...ids.filter((i) => i !== id), id] : ids.filter((i) => i !== id)));
  }

  protected toggleRole(id: string, checked: boolean): void {
    this.roleIds.update((ids) => (checked ? [...ids.filter((i) => i !== id), id] : ids.filter((i) => i !== id)));
  }

  protected save(): void {
    this.touched.set(true);
    this.submitted.set(true);
    if (this.form.invalid || !this.allowed().length || !this.defaultValid() || this.rowErrors().size) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload = {
      name: v.name.trim(),
      description: v.description.trim(),
      active: v.active,
      allowedTypeIds: this.allowed(),
      defaultTypeId: v.defaultTypeId,
      initialStatusId: v.initialStatusId,
      suggestedRoleIds: this.roleIds(),
      durationDays: Number(v.durationDays),
      suggestedMembers: this.memberRows().map((r) => ({ ...(r.userId ? { userId: r.userId } : {}), roleId: r.roleId })),
    };
    const request$ = this.editing ? this.api.update(this.editing.id, { ...payload, version: this.editing.version }) : this.api.create(payload);
    this.saving.set(true);
    this.serverDetails.set({});
    request$.subscribe({
      next: (saved) => {
        this.lookup.reload();
        this.toast.success('تم حفظ قالب المشروع');
        this.ref.close(saved);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (this.editing && isApiError(e) && e.status === 409) {
          this.ref.close();
          return;
        }
        this.serverDetails.set(fieldErrors(e));
      },
    });
  }
}

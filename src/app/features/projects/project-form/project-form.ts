import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ValidationErrors, Validators, ReactiveFormsModule } from '@angular/forms';
import { isApiError } from '@core/models/api-error.model';
import { ProjectLookup, ProjectsApi } from '@domain/projects/project.api';
import { ProjectSummary } from '@domain/projects/project.models';
import { UserLookup } from '@domain/users/user.api';
import { ProjectTemplate, ProjectTemplateLookup } from '@domain/projects/project-template';
import { TypeChip } from '@shared/domain-ui/domain-ui';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { projectChanges } from './project-form-diff';

export interface ProjectFormData {
  /** Present when editing. */
  readonly project?: ProjectSummary;
}

const FIELD_KEYS: readonly string[] = ['code', 'name', 'description', 'ownerId', 'templateId', 'startDate', 'endDate'];

function endAfterStart(group: AbstractControl): ValidationErrors | null {
  const start = group.get('startDate')?.value as string;
  const end = group.get('endDate')?.value as string;
  return start && end && end < start ? { dateRange: true } : null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let nextId = 0;

@Component({
  selector: 'app-project-form',
  imports: [ReactiveFormsModule, DialogShell, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-form.html',
  styles: `
    .tpl p { margin: 0 0 var(--s-2); }
    .tpl-types { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
    .alert { margin-block-end: var(--s-4); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--c-danger-bg); color: var(--c-danger); }
    .alert ul { margin: var(--s-2) 0 0; padding-inline-start: var(--s-5); }
    .diff { margin-block-start: var(--s-4); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--c-surface-2); font-size: var(--fs-sm); }
    .diff ul { margin: var(--s-2) 0 0; padding-inline-start: var(--s-5); }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    .diff, .alert { overflow-wrap: anywhere; }
    .form-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
    .form-grid .span-2 { grid-column: 1 / -1; }
  `,
})
export class ProjectForm {
  protected readonly uid = `pf${++nextId}`;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(ProjectsApi);
  private readonly projectLookup = inject(ProjectLookup);
  protected readonly ref = inject(DialogRef<ProjectSummary>);
  private readonly users = inject(UserLookup);
  private readonly templateLookup = inject(ProjectTemplateLookup);
  protected readonly data = (inject(DIALOG_DATA, { optional: true }) as ProjectFormData | null) ?? {};

  protected readonly project = this.data.project;
  protected readonly isEdit = !!this.project;
  protected readonly saving = signal(false);
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  /** Server message for rule violations that are not tied to one field (shown in an alert above the form). */
  protected readonly formError = signal<string | null>(null);
  /** Details whose key is not a form field (e.g. a new server-side rule): listed under the alert. */
  protected readonly extraErrors = computed(() =>
    Object.entries(this.serverErrors()).filter(([key]) => !FIELD_KEYS.includes(key)).map(([key, message]) => ({ key, message })),
  );

  protected readonly activeUsers = computed(() => this.users.items().filter((u) => u.active || u.id === this.project?.ownerId));
  protected readonly templates = computed(() => this.templateLookup.items().filter((t) => t.active));
  protected readonly template = signal<ProjectTemplate | undefined>(undefined);

  protected readonly form = this.fb.group(
    {
      code: this.fb.control(this.project?.code ?? '', this.isEdit ? [] : [Validators.required, Validators.pattern(/^[A-Z][A-Z0-9]{1,9}$/)]),
      name: this.fb.control(this.project?.name ?? '', [Validators.required, Validators.maxLength(120)]),
      description: this.fb.control(this.project?.description ?? ''),
      ownerId: this.fb.control(this.project?.ownerId ?? '', Validators.required),
      templateId: this.fb.control(''),
      startDate: this.fb.control(this.project?.startDate?.slice(0, 10) ?? '', Validators.required),
      endDate: this.fb.control(this.project?.endDate?.slice(0, 10) ?? '', Validators.required),
    },
    { validators: endAfterStart },
  );

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** Edit mode: before/after of what will be saved (labels, owner by name). */
  protected readonly changes = computed(() => {
    const original = this.project;
    if (!original) return [];
    const v = { ...this.form.getRawValue(), ...this.value() };
    return projectChanges(original, { name: v.name ?? '', description: v.description ?? '', ownerId: v.ownerId ?? '', startDate: v.startDate ?? '', endDate: v.endDate ?? '' }, (id) => this.users.nameOf(id));
  });

  /** Members the chosen template will add (inactive users are skipped by the server). */
  protected readonly suggestedMembers = computed(() => {
    const list = this.template()?.suggestedMembers ?? [];
    const active = list.filter((m) => !m.userId || this.users.get(m.userId)?.active).length;
    return { total: list.length, active };
  });

  constructor() {
    if (this.isEdit) this.form.controls.code.disable();
  }

  protected onTemplate(event: Event): void {
    const t = this.templateLookup.get((event.target as HTMLSelectElement).value);
    this.template.set(t);
    const start = this.form.controls.startDate.value;
    if (t && start) this.form.controls.endDate.setValue(addDays(start, t.durationDays));
  }

  protected onStart(): void {
    const t = this.template();
    const start = this.form.controls.startDate.value;
    if (t && start && !this.form.controls.endDate.dirty) this.form.controls.endDate.setValue(addDays(start, t.durationDays));
  }

  protected upperCode(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.form.controls.code.setValue(input.value.toUpperCase());
  }

  protected showError(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return (c.invalid && c.touched) || !!this.serverErrors()[name];
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.serverErrors.set({});
    this.formError.set(null);
    const { code, templateId, ...rest } = this.form.getRawValue();
    const request$ = this.project
      ? this.api.update(this.project.id, { ...rest, version: this.project.version })
      : this.api.create({ code, ...rest, ...(templateId ? { templateId } : {}) });
    request$.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.ref.close(saved);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (!isApiError(err)) return;
        this.serverErrors.set(err.details ?? {});
        const unmapped = Object.keys(err.details ?? {}).some((k) => !FIELD_KEYS.includes(k));
        if (unmapped || !err.details || err.status === 422) this.formError.set(err.message);
        if (err.status === 409 && this.isEdit) {
          // The interceptor already toasted the message; reload fresh data and close so the retry uses the new version.
          this.projectLookup.reload();
          this.ref.close();
        }
      },
    });
  }
}

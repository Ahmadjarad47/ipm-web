import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { isApiError } from '@core/models/api-error.model';
import { ALL_PERMISSIONS, PermissionScope } from '@core/auth/permissions';
import { ToastService } from '@core/notifications/toast.service';
import { RoleLookup, RolesApi } from '@domain/users/user.api';
import { Role } from '@domain/users/user.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { AdminNotice } from '../shared/admin-notice';
import { errorDetails } from '../shared/api-errors';
import { PermissionMatrix, PermissionStates } from './permission-matrix';

export interface RoleDialogData {
  /** `null` creates a role. */
  readonly role: Role | null;
}

function statesOf(role: Role | null): PermissionStates {
  const states: Partial<Record<(typeof ALL_PERMISSIONS)[number], 'grant' | 'deny'>> = {};
  for (const k of role?.permissions ?? []) states[k] = 'grant';
  for (const k of role?.denied ?? []) states[k] = 'deny'; // deny wins over a grant
  return states;
}

@Component({
  selector: 'app-role-dialog',
  imports: [ReactiveFormsModule, DialogShell, AdminNotice, PermissionMatrix],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="editing ? 'تعديل دور: ' + editing.name : 'دور جديد'">
      <form id="role-form" [formGroup]="form" (ngSubmit)="save()" class="stack">
        <div class="form-grid">
          <div class="field">
            <label for="ro-key">المفتاح <span class="req">*</span></label>
            <input id="ro-key" class="input ltr" formControlName="key" autocomplete="off" />
            <span class="hint">{{ editing ? 'ثابت ولا يتغير.' : 'يُحدَّد عند الإنشاء ولا يتغير لاحقًا.' }}</span>
          </div>
          <div class="field">
            <label for="ro-scope">النطاق</label>
            <select id="ro-scope" class="select" formControlName="scope">
              <option value="system">نظام</option>
              <option value="project">مشروع</option>
            </select>
            @if (editing) {
              <span class="hint">لا يتغير بعد الإنشاء.</span>
            }
          </div>
          <div class="field">
            <label for="ro-name">الاسم <span class="req">*</span></label>
            <input id="ro-name" class="input" formControlName="name" />
          </div>
          <div class="field">
            <label for="ro-desc">الوصف</label>
            <input id="ro-desc" class="input" formControlName="description" />
          </div>
        </div>

        <app-admin-notice>المنع الصريح يتغلّب دائمًا على أي منح. أدوار المشروع تسري فقط داخل المشاريع التي أُسندت فيها.</app-admin-notice>
        <p class="muted">الصلاحيات الممنوحة: <strong>{{ grantedCount() }}</strong> · الممنوعة صراحة: <strong>{{ deniedCount() }}</strong></p>
        <app-permission-matrix [(states)]="states" />

        @for (d of details(); track d) {
          <p class="error" role="alert">{{ d }}</p>
        }
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="role-form" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : editing ? 'حفظ' : 'إنشاء الدور' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `.error { font-size: var(--fs-xs); color: var(--c-danger); }`,
})
export class RoleDialog {
  protected readonly ref = inject<DialogRef<Role>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as RoleDialogData;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(RolesApi);
  private readonly lookup = inject(RoleLookup);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly editing = this.data.role;
  protected readonly saving = signal(false);
  protected readonly details = signal<readonly string[]>([]);
  protected readonly states = signal<PermissionStates>(statesOf(this.editing));
  protected readonly grantedCount = computed(() => ALL_PERMISSIONS.filter((k) => this.states()[k] === 'grant').length);
  protected readonly deniedCount = computed(() => ALL_PERMISSIONS.filter((k) => this.states()[k] === 'deny').length);

  protected readonly form = this.fb.group({
    key: this.fb.control({ value: this.editing?.key ?? '', disabled: !!this.editing }, [
      Validators.required,
      Validators.pattern(/^[a-z][a-z0-9_.-]{1,40}$/),
    ]),
    scope: this.fb.control<PermissionScope>({ value: this.editing?.scope ?? 'system', disabled: !!this.editing }),
    name: this.fb.control(this.editing?.name ?? '', Validators.required),
    description: this.fb.control(this.editing?.description ?? ''),
  });

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const states = this.states();
    const common = {
      name: v.name.trim(),
      description: v.description.trim(),
      permissions: ALL_PERMISSIONS.filter((k) => states[k] === 'grant'),
      denied: ALL_PERMISSIONS.filter((k) => states[k] === 'deny'),
    };
    const request$ = this.editing
      ? this.api.update(this.editing.id, { ...common, version: this.editing.version })
      : this.api.create({ ...common, key: v.key, scope: v.scope, builtIn: false });

    this.saving.set(true);
    this.details.set([]);
    request$.subscribe({
      next: (saved) => {
        this.lookup.reload();
        this.auth.refreshSession().subscribe();
        this.toast.success('تم حفظ الدور');
        this.ref.close(saved);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (this.editing && isApiError(e) && e.status === 409) {
          this.lookup.reload();
          this.ref.close();
          return;
        }
        this.details.set(errorDetails(e));
      },
    });
  }
}

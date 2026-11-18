import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { RoleLookup, UserCreate, UserLookup, UsersApi } from '@domain/users/user.api';
import { User } from '@domain/users/user.models';
import { DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { AdminNotice } from '../shared/admin-notice';

/** Create an internal account (FR-AUTH-02). */
@Component({
  selector: 'app-user-create-dialog',
  imports: [ReactiveFormsModule, DialogShell, AdminNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .roles { display: flex; flex-direction: column; gap: var(--s-2); margin: 0; padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); }
    legend { padding-inline: var(--s-2); font-size: var(--fs-sm); font-weight: 600; color: var(--c-text-2); }
  `,
  template: `
    <app-dialog-shell title="مستخدم جديد">
      <form id="uc-form" [formGroup]="form" (ngSubmit)="save()" class="stack">
        <app-admin-notice>سيصل للمستخدم رابط تعيين كلمة المرور عبر مزوّد الهوية.</app-admin-notice>
        @if (formError(); as msg) {
          <p class="error" role="alert">{{ msg }}</p>
        }
        <div class="field">
          <label for="uc-username">اسم المستخدم <span class="req">*</span></label>
          <input id="uc-username" class="input ltr" formControlName="username" autocomplete="off" [attr.aria-invalid]="bad('username')" />
          <span class="hint">أحرف إنجليزية صغيرة، تبدأ بحرف، من 3 إلى 31 خانة (أرقام و . _ - مسموحة).</span>
          @if (bad('username')) { <span class="error" role="alert">{{ serverErrors()['username'] ?? 'صيغة اسم المستخدم غير صحيحة.' }}</span> }
        </div>
        <div class="field">
          <label for="uc-name">الاسم <span class="req">*</span></label>
          <input id="uc-name" class="input" formControlName="name" [attr.aria-invalid]="bad('name')" />
          @if (bad('name')) { <span class="error" role="alert">{{ serverErrors()['name'] ?? 'الاسم مطلوب.' }}</span> }
        </div>
        <div class="field">
          <label for="uc-email">البريد الإلكتروني <span class="req">*</span></label>
          <input id="uc-email" class="input ltr" type="email" formControlName="email" [attr.aria-invalid]="bad('email')" />
          @if (bad('email')) { <span class="error" role="alert">{{ serverErrors()['email'] ?? 'أدخل بريدًا إلكترونيًا صحيحًا.' }}</span> }
        </div>
        <div class="field">
          <label for="uc-title">المسمى الوظيفي</label>
          <input id="uc-title" class="input" formControlName="title" />
          @if (serverErrors()['title']; as e) { <span class="error" role="alert">{{ e }}</span> }
        </div>
        <fieldset class="roles">
          <legend>أدوار النظام</legend>
          @for (r of systemRoles(); track r.id) {
            <label class="checkbox">
              <input type="checkbox" [checked]="roleIds().includes(r.id)" (change)="toggleRole(r.id, $any($event.target).checked)" />
              {{ r.name }} <span class="ltr muted">{{ r.key }}</span>
            </label>
          } @empty {
            <span class="muted">لا توجد أدوار نظام.</span>
          }
          @if (serverErrors()['systemRoleIds']; as e) { <span class="error" role="alert">{{ e }}</span> }
        </fieldset>
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="uc-form" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الإنشاء…' : 'إنشاء المستخدم' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class UserCreateDialog {
  protected readonly ref = inject<DialogRef<User>>(DialogRef);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(UsersApi);
  private readonly userLookup = inject(UserLookup);
  private readonly roles = inject(RoleLookup);
  private readonly toast = inject(ToastService);

  protected readonly systemRoles = computed(() => this.roles.items().filter((r) => r.scope === 'system'));
  protected readonly roleIds = signal<readonly string[]>([]);
  protected readonly saving = signal(false);
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  /** Non-field failures, e.g. 403 «لا تملك حق تفويض الدور …» when granting a role beyond your own rights. */
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.fb.group({
    username: this.fb.control('', [Validators.required, Validators.pattern(/^[a-z][a-z0-9._-]{2,30}$/)]),
    name: this.fb.control('', Validators.required),
    email: this.fb.control('', [Validators.required, Validators.email]),
    title: this.fb.control(''),
  });

  protected bad(key: 'username' | 'name' | 'email'): boolean {
    const c = this.form.controls[key];
    return (c.invalid && c.touched) || !!this.serverErrors()[key];
  }

  protected toggleRole(id: string, checked: boolean): void {
    this.roleIds.update((ids) => (checked ? [...ids.filter((i) => i !== id), id] : ids.filter((i) => i !== id)));
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload: UserCreate = {
      username: v.username.trim(),
      name: v.name.trim(),
      email: v.email.trim(),
      title: v.title.trim(),
      systemRoleIds: this.roleIds(),
    };
    this.saving.set(true);
    this.serverErrors.set({});
    this.formError.set(null);
    this.api.create(payload).subscribe({
      next: (created) => {
        this.userLookup.reload();
        this.toast.success('تم إنشاء المستخدم');
        this.ref.close(created);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (!isApiError(e)) return;
        this.serverErrors.set(e.details ?? {});
        if (e.status === 403 || !e.details) this.formError.set(e.message);
      },
    });
  }
}

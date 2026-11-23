import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { RoleLookup, UserLookup, UsersApi } from '@domain/users/user.api';
import { User } from '@domain/users/user.models';
import { AppDatePipe } from '@shared/pipes/pipes';
import { Avatar } from '@shared/ui/avatar/avatar';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { Icon } from '@shared/ui/icon/icon';
import { ActiveToggle } from '../shared/active-toggle';
import { AdminNotice } from '../shared/admin-notice';

const FIELD_KEYS: readonly string[] = ['name', 'email', 'title', 'managerId', 'systemRoleIds', 'active'];

/** Edit profile, manager, activation and system roles of a user; reset password (FR-AUTH-02). Own roles/activation are locked (§2.3). */
@Component({
  selector: 'app-user-dialog',
  imports: [ReactiveFormsModule, DialogShell, Avatar, ActiveToggle, AdminNotice, Icon, AppDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="user.name" [subtitle]="'@' + user.username">
      <div class="stack">
        <div class="row">
          <app-avatar [name]="user.name" [size]="44" />
          <span class="muted">اسم المستخدم لا يتغيّر: <span class="ltr">{{ user.username }}</span></span>
        </div>

        @if (isSelf()) {
          <app-admin-notice tone="warning">لا يمكنك تعديل أدوارك أو تعطيل حسابك بنفسك؛ اطلب ذلك من مدير آخر (يرفضه الخادم أيضًا).</app-admin-notice>
        }

        @if (formError(); as msg) {
          <div class="alert" role="alert">
            <app-icon name="alert" [size]="18" />
            <div>
              <strong>{{ msg }}</strong>
              @for (e of extraErrors(); track e.key) {
                <p>{{ e.message }}</p>
              }
            </div>
          </div>
        }

        <form id="ud-form" [formGroup]="form" (ngSubmit)="save()" class="stack" novalidate>
          <div class="field">
            <label for="ud-name">الاسم <span class="req">*</span></label>
            <input id="ud-name" class="input" formControlName="name" [attr.aria-invalid]="bad('name')" />
            @if (bad('name')) { <span class="error" role="alert">{{ serverErrors()['name'] ?? 'الاسم مطلوب.' }}</span> }
          </div>
          <div class="field">
            <label for="ud-email">البريد الإلكتروني <span class="req">*</span></label>
            <input id="ud-email" class="input ltr" type="email" formControlName="email" [attr.aria-invalid]="bad('email')" />
            @if (bad('email')) { <span class="error" role="alert">{{ serverErrors()['email'] ?? 'أدخل بريدًا إلكترونيًا صحيحًا.' }}</span> }
          </div>
          <div class="field">
            <label for="ud-title">المسمى الوظيفي</label>
            <input id="ud-title" class="input" formControlName="title" [attr.aria-invalid]="bad('title')" />
            @if (bad('title')) { <span class="error" role="alert">{{ serverErrors()['title'] ?? 'الحد الأقصى 100 حرف.' }}</span> }
          </div>
          <div class="field">
            <label for="ud-manager">المدير المباشر</label>
            <select id="ud-manager" class="select" formControlName="managerId">
              <option value="">بدون مدير</option>
              @for (m of managers(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
            <span class="hint">يُستخدم لتحديد «المدير المباشر» في مسارات الموافقة.</span>
            @if (serverErrors()['managerId']; as e) { <span class="error" role="alert">{{ e }}</span> }
          </div>
        </form>

        <div class="row">
          <app-active-toggle [checked]="active()" [disabled]="locked()" label="الحساب نشط" (toggled)="active.set($event)" />
          <span>{{ active() ? 'الحساب نشط' : 'الحساب معطّل' }}</span>
        </div>
        @if (deactivationWarning(); as w) {
          <app-admin-notice tone="warning">{{ w }}</app-admin-notice>
        }

        <fieldset class="roles">
          <legend>أدوار النظام</legend>
          @for (r of systemRoles(); track r.id) {
            <label class="checkbox">
              <input type="checkbox" [checked]="roleIds().includes(r.id)" [disabled]="locked()" (change)="toggleRole(r.id, $any($event.target).checked)" />
              {{ r.name }} <span class="ltr muted">{{ r.key }}</span>
            </label>
          } @empty {
            <span class="muted">لا توجد أدوار نظام.</span>
          }
          @if (serverErrors()['systemRoleIds']; as e) { <span class="error" role="alert">{{ e }}</span> }
        </fieldset>

        @if (canAssign()) {
          <section class="reset" aria-labelledby="ud-reset-title">
            <strong id="ud-reset-title">كلمة المرور</strong>
            <p class="muted">تحدّد كلمة مرور مؤقتة وتُنهى جلسات المستخدم الحالية فورًا، ويُطلب منه تغييرها عند أول دخول.</p>
            @if (resetDone()) {
              <app-admin-notice tone="warning">تم تعيين كلمة المرور وإنهاء جميع جلسات هذا المستخدم. أرسلها له عبر قناة آمنة.</app-admin-notice>
            } @else {
              <div class="link-box">
                <input class="input ltr" type="password" autocomplete="new-password" aria-label="كلمة المرور المؤقتة" placeholder="كلمة المرور المؤقتة" [value]="newPassword()" (input)="newPassword.set($any($event.target).value)" />
                <button type="button" class="btn btn--outline" [disabled]="resetting() || newPassword().length < 8" (click)="reset()">
                  <app-icon name="lock" [size]="16" /> {{ resetting() ? 'جارٍ التعيين…' : 'تعيين كلمة المرور' }}
                </button>
              </div>
            }
            @if (resetError(); as e) { <p class="error" role="alert">{{ e }}</p> }
          </section>
        }
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إغلاق</button>
        <button type="submit" form="ud-form" class="btn btn--primary" [disabled]="!canAssign() || saving()">{{ saving() ? 'جارٍ الحفظ…' : 'حفظ' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .roles { display: flex; flex-direction: column; gap: var(--s-2); margin: 0; padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); }
    legend { padding-inline: var(--s-2); font-size: var(--fs-sm); font-weight: 600; color: var(--c-text-2); }
    .alert { display: flex; gap: var(--s-3); align-items: flex-start; padding: var(--s-3) var(--s-4); border-radius: var(--r-sm); background: var(--c-danger-bg); color: var(--c-danger); font-size: var(--fs-sm); }
    .alert p { margin: var(--s-1) 0 0; }
    .reset { display: grid; gap: var(--s-2); padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); }
    .reset p { margin: 0; font-size: var(--fs-sm); }
    .link-box { display: flex; gap: var(--s-2); flex-wrap: wrap; }
    .link-box .input { flex: 1; min-width: min(100%, 220px); }
    .error { color: var(--c-danger); font-size: var(--fs-sm); }
  `,
})
export class UserDialog {
  protected readonly ref = inject<DialogRef<User>>(DialogRef);
  protected readonly user = inject(DIALOG_DATA) as User;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(UsersApi);
  private readonly userLookup = inject(UserLookup);
  private readonly projects = inject(ProjectLookup);
  private readonly roles = inject(RoleLookup);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly isSelf = computed(() => this.auth.user()?.id === this.user.id);
  protected readonly canAssign = computed(() => this.auth.can('permissions.assign'));
  /** Roles and activation are locked for yourself and without the permission (the server re-checks). */
  protected readonly locked = computed(() => this.isSelf() || !this.canAssign());
  protected readonly systemRoles = computed(() => this.roles.items().filter((r) => r.scope === 'system'));
  protected readonly managers = computed(() => this.userLookup.items().filter((u) => u.active && u.id !== this.user.id));

  protected readonly active = signal(this.user.active);
  protected readonly roleIds = signal<readonly string[]>(this.user.systemRoleIds);
  protected readonly saving = signal(false);
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly formError = signal<string | null>(null);
  protected readonly extraErrors = computed(() =>
    Object.entries(this.serverErrors()).filter(([key]) => !FIELD_KEYS.includes(key)).map(([key, message]) => ({ key, message })),
  );

  protected readonly resetDone = signal(false);
  protected readonly newPassword = signal('');
  protected readonly resetting = signal(false);
  protected readonly resetError = signal<string | null>(null);

  protected readonly form = this.fb.group({
    name: this.fb.control(this.user.name, Validators.required),
    email: this.fb.control(this.user.email, [Validators.required, Validators.email]),
    title: this.fb.control(this.user.title, Validators.maxLength(100)),
    managerId: this.fb.control(this.user.managerId ?? ''),
  });

  constructor() {
    if (!this.canAssign()) this.form.disable();
  }

  /** Impact of deactivating, computed from the cached project list. */
  protected readonly deactivationWarning = computed(() => {
    if (this.active() || !this.user.active) return null;
    const live = this.projects.items().filter((p) => !p.archived);
    const owned = live.filter((p) => p.ownerId === this.user.id);
    const memberOf = live.filter((p) => p.members.some((m) => m.userId === this.user.id)).length;
    if (!owned.length && !memberOf) return 'تعطيل الحساب يُنهي جلسات المستخدم فورًا. تبقى بياناته وسجلّه كما هي.';
    const parts: string[] = [];
    if (owned.length) parts.push(`مالك لـ ${owned.length} مشروع (${owned.map((p) => p.name).join('، ')})`);
    if (memberOf) parts.push(`عضو في ${memberOf} مشروع`);
    return `هذا المستخدم ${parts.join(' و')}. التعطيل يُنهي جلساته فورًا، وتبقى العناصر المفتوحة المكلَّف بها كما هي ويجب إعادة تكليفها. أعد تعيين مالك المشروع قبل التعطيل.`;
  });

  protected bad(key: 'name' | 'email' | 'title'): boolean {
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
    const rolesChanged = this.roleIds().length !== this.user.systemRoleIds.length || this.roleIds().some((id) => !this.user.systemRoleIds.includes(id));
    // Only send what changed: self-edits must not include roles/activation (the server rejects them).
    this.saving.set(true);
    this.serverErrors.set({});
    this.formError.set(null);
    this.api
      .update(this.user.id, {
        name: v.name.trim(),
        email: v.email.trim(),
        title: v.title.trim(),
        ...(v.managerId || this.user.managerId ? { managerId: v.managerId || undefined } : {}),
        ...(this.active() !== this.user.active ? { active: this.active() } : {}),
        ...(rolesChanged ? { systemRoleIds: this.roleIds() } : {}),
        version: this.user.version,
      })
      .subscribe({
        next: (saved) => {
          this.userLookup.reload();
          this.auth.refreshSession().subscribe();
          this.toast.success('تم حفظ المستخدم');
          this.ref.close(saved);
        },
        error: (e: unknown) => {
          this.saving.set(false);
          if (!isApiError(e)) return;
          if (e.status === 409) {
            // Stale version: reload and close so the next edit starts fresh.
            this.userLookup.reload();
            this.ref.close();
            return;
          }
          this.serverErrors.set(e.details ?? {});
          // 422 covers "last administrator" and "cannot deactivate yourself"; 403 covers role grants beyond your own rights.
          if (e.status === 422 || e.status === 403 || !e.details) this.formError.set(e.message);
        },
      });
  }

  protected reset(): void {
    this.confirm
      .confirm({
        title: 'إعادة تعيين كلمة المرور',
        message: `ستُعيَّن كلمة مرور مؤقتة لـ «${this.user.name}» وتُنهى جلساته الحالية. هل تريد المتابعة؟`,
        confirmText: 'تعيين كلمة المرور',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.resetting.set(true);
        this.resetError.set(null);
        this.api.resetPassword(this.user.id, this.newPassword()).subscribe({
          next: () => {
            this.resetting.set(false);
            this.resetDone.set(true);
            this.newPassword.set('');
          },
          error: (e: unknown) => {
            this.resetting.set(false);
            if (isApiError(e)) this.resetError.set(e.message);
          },
        });
      });
  }

}

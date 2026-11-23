import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { API_BASE_URL } from '@core/api/api.config';
import { AuthService } from '@core/auth/auth.service';
import { ApiError } from '@core/models/api-error.model';
import { PreferencesStore } from '@core/preferences/preferences.store';

/**
 * The first password was set by an administrator, so the server refuses everything else until the user chooses their own
 * (spec 01). Also reachable on purpose later; the server checks the current password.
 */
@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <form class="card form" [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="submitting()">
        <h1>اختر كلمة مرور جديدة</h1>
        <p class="muted">كلمة المرور الحالية أعطاك إياها مدير النظام. اختر كلمة مرور خاصة بك للمتابعة.</p>

        @if (error()) {
          <div class="alert" role="alert">{{ error() }}</div>
        }

        <div class="field">
          <label for="current">كلمة المرور الحالية</label>
          <input id="current" class="input" type="password" formControlName="currentPassword" autocomplete="current-password" dir="ltr" />
        </div>
        <div class="field">
          <label for="next">كلمة المرور الجديدة</label>
          <input id="next" class="input" type="password" formControlName="newPassword" autocomplete="new-password" dir="ltr" />
          <span class="hint">8 أحرف على الأقل وفيها رقم.</span>
        </div>
        <div class="field">
          <label for="confirm">تأكيد كلمة المرور</label>
          <input id="confirm" class="input" type="password" formControlName="confirm" autocomplete="new-password" dir="ltr" />
          @if (form.controls.confirm.touched && mismatch()) {
            <span class="error" role="alert">كلمتا المرور غير متطابقتين</span>
          }
        </div>

        <div class="actions">
          <button type="submit" class="btn btn--primary" [disabled]="submitting()">حفظ ومتابعة</button>
          <button type="button" class="btn btn--ghost" (click)="auth.logout()">تسجيل الخروج</button>
        </div>
      </form>
    </main>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: var(--s-6); }
    .form { width: min(440px, 100%); display: grid; gap: var(--s-4); }
    .actions { display: flex; gap: var(--s-3); justify-content: space-between; }
    .hint { color: var(--c-text-muted); font-size: var(--fs-sm); }
  `,
})
export class ChangePassword {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly router = inject(Router);
  private readonly preferences = inject(PreferencesStore);

  protected readonly form = inject(NonNullableFormBuilder).group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirm: ['', Validators.required],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected mismatch(): boolean {
    const { newPassword, confirm } = this.form.getRawValue();
    return newPassword !== confirm;
  }

  protected submit(): void {
    if (this.form.invalid || this.mismatch()) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);
    this.http.post(`${this.baseUrl}/auth/password`, { currentPassword, newPassword }, { headers: { 'X-Silent-Error': '1' } }).subscribe({
      next: () => {
        this.auth.passwordChanged();
        void this.router.navigateByUrl(this.preferences.prefs().landingPage);
      },
      error: (e: ApiError) => {
        this.error.set(e.details?.['newPassword'] ?? e.message);
        this.submitting.set(false);
      },
    });
  }
}

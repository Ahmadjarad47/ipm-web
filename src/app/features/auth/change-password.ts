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
    <div class="login">
      <section class="hero on-dark" aria-hidden="true">
        <span class="logo">م</span>
        <h2>نظام إدارة المشاريع الداخلي</h2>
        <p>خطوة أخيرة قبل البدء: اختر كلمة مرور خاصة بك لحماية حسابك.</p>
        <ul>
          <li>8 أحرف على الأقل</li>
          <li>تحتوي على رقم واحد على الأقل</li>
          <li>لا تشاركها مع أحد</li>
        </ul>
      </section>

      <section class="panel">
        <form class="card form" [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="submitting()">
          <h1>اختر كلمة مرور جديدة</h1>
          <p class="muted">كلمة المرور الحالية أعطاك إياها مدير النظام. اختر كلمة مرور خاصة بك للمتابعة.</p>

          @if (error()) {
            <div class="alert" role="alert">{{ error() }}</div>
          }

          <div class="field">
            <label for="current">كلمة المرور الحالية</label>
            <div class="pw">
              <input id="current" class="input" [type]="show() ? 'text' : 'password'" formControlName="currentPassword" autocomplete="current-password" dir="ltr" />
              <button type="button" class="btn btn--ghost pw-toggle" (click)="show.set(!show())" [attr.aria-pressed]="show()"
                [attr.aria-label]="show() ? 'إخفاء كلمات المرور' : 'إظهار كلمات المرور'">
                {{ show() ? 'إخفاء' : 'إظهار' }}
              </button>
            </div>
          </div>
          <div class="field">
            <label for="next">كلمة المرور الجديدة</label>
            <input id="next" class="input" [type]="show() ? 'text' : 'password'" formControlName="newPassword" autocomplete="new-password" dir="ltr" />
            <span class="hint">8 أحرف على الأقل وفيها رقم.</span>
          </div>
          <div class="field">
            <label for="confirm">تأكيد كلمة المرور</label>
            <input id="confirm" class="input" [type]="show() ? 'text' : 'password'" formControlName="confirm" autocomplete="new-password" dir="ltr" />
            @if (form.controls.confirm.touched && mismatch()) {
              <span class="error" role="alert">كلمتا المرور غير متطابقتين</span>
            }
          </div>

          <button type="submit" class="btn btn--primary submit" [disabled]="submitting()">
            @if (submitting()) {
              <span class="spinner" aria-hidden="true"></span>
            }
            {{ submitting() ? 'جارٍ الحفظ…' : 'حفظ ومتابعة' }}
          </button>
          <button type="button" class="btn btn--ghost" (click)="auth.logout()">تسجيل الخروج</button>
        </form>
      </section>
    </div>
  `,
  styles: `
    .login { display: grid; grid-template-columns: 1.1fr 1fr; min-height: 100vh; }
    .hero {
      display: flex; flex-direction: column; justify-content: center; gap: var(--s-4); padding: var(--s-8) 8%;
      background: radial-gradient(circle at 20% 20%, rgb(201 162 74 / 18%), transparent 45%), linear-gradient(160deg, var(--c-ink-1), var(--c-ink-2));
      color: #e8f2ec;
    }
    .hero h2 { font-size: 32px; color: #fff; }
    .hero p { max-width: 440px; font-size: var(--fs-lg); opacity: 0.85; }
    .hero ul { margin: var(--s-4) 0 0; padding: 0; list-style: none; display: grid; gap: var(--s-3); }
    .hero li { display: flex; align-items: center; gap: var(--s-3); }
    .hero li::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--c-gold-500); }
    .logo {
      display: grid; place-items: center; width: 56px; height: 56px; border-radius: var(--r-lg);
      background: var(--c-gold-500); color: var(--c-on-gold); font-size: 28px; font-weight: 700;
    }
    .panel { display: grid; place-items: center; padding: var(--s-6); }
    .form { display: flex; flex-direction: column; gap: var(--s-4); width: min(420px, 100%); padding: var(--s-8) var(--s-6); }
    .form h1 { font-size: var(--fs-2xl); color: var(--c-emerald-900); }
    .alert {
      padding: var(--s-3) var(--s-4); border-radius: var(--r-sm); background: var(--c-danger-bg);
      color: var(--c-danger); font-size: var(--fs-sm); overflow-wrap: anywhere;
    }
    .hint { color: var(--c-text-muted); font-size: var(--fs-sm); }
    .pw { display: flex; gap: var(--s-2); }
    .pw .input { flex: 1; }
    .pw-toggle { min-width: 64px; border-color: var(--c-border-strong); }
    .submit { height: 44px; }
    .spinner {
      width: 16px; height: 16px; border: 2px solid rgb(255 255 255 / 40%); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s !important; } }
    @media (max-width: 860px) { .login { grid-template-columns: 1fr; } .hero { display: none; } }
    @media (max-width: 480px) { .panel { padding: var(--s-3); } .form { padding: var(--s-6) var(--s-4); } }
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
  protected readonly show = signal(false);
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

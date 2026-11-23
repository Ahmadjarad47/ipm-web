import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { ApiError } from '@core/models/api-error.model';
import { PreferencesStore } from '@core/preferences/preferences.store';

interface DemoAccount {
  readonly username: string;
  readonly label: string;
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly preferences = inject(PreferencesStore);
  private readonly usernameInput = viewChild.required<ElementRef<HTMLInputElement>>('username');

  protected readonly form = inject(NonNullableFormBuilder).group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isDemo = false;
  protected readonly showPassword = signal(false);
  protected readonly capsLock = signal(false);
  protected readonly forgotOpen = signal(false);
  /** Why the previous session ended (expired / disabled), if the app ended it. */
  protected readonly logoutReason = this.auth.lastLogoutReason;

  /** Demo accounts of the in-app mock backend; one per typical role (SRS §2.1). */
  protected readonly demoAccounts: readonly DemoAccount[] = [
    { username: 'admin', label: 'مدير النظام' },
    { username: 'khaled', label: 'مدير مشروع' },
    { username: 'noura', label: 'مشرفة / معتمدة' },
    { username: 'fahad', label: 'عضو فريق' },
    { username: 'abdullah', label: 'قارئ' },
  ];

  constructor() {
    afterNextRender(() => this.usernameInput().nativeElement.focus());
  }

  protected onPasswordKey(event: KeyboardEvent): void {
    this.capsLock.set(event.getModifierState('CapsLock'));
  }

  protected useDemo(account: DemoAccount): void {
    this.form.setValue({ username: account.username, password: 'demo' });
    this.submit();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.auth.login(this.form.getRawValue()).subscribe({
      next: (session) => void this.router.navigateByUrl(session.mustChangePassword ? '/change-password' : this.preferences.prefs().landingPage),
      error: (e: ApiError) => {
        this.error.set(e.message);
        this.submitting.set(false);
      },
    });
  }
}

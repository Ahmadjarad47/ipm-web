import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { Icon } from '@shared/ui/icon/icon';
import { GIT_CONNECTORS } from '@domain/git/git-connector';
import { providerLabel, webhookSteps } from './git-logic';
import { ProjectsApi } from '@domain/projects/project.api';
import { ProjectSummary, Repository } from '@domain/projects/project.models';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';

let nextId = 0;

export interface RepositoryConnectData {
  readonly projectId: string;
}

@Component({
  selector: 'app-repository-connect-dialog',
  imports: [ReactiveFormsModule, DialogShell, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `.secret-row { display: flex; gap: var(--s-2); align-items: center; } .secret-row .input { flex: 1; min-width: 0; } .setup { margin-block-start: var(--s-4); } .setup summary { cursor: pointer; font-weight: 600; } .steps { margin: var(--s-2) 0; padding-inline-start: var(--s-5); display: grid; gap: var(--s-2); } .code { background: var(--c-surface-2); padding: 2px 6px; border-radius: 4px; word-break: break-all; }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    .input, .code { overflow-wrap: anywhere; }
    @media (max-width: 640px) { .secret-row { flex-wrap: wrap; } .secret-row .input { flex-basis: 100%; } }
    @media (pointer: coarse), (max-width: 768px) { .setup summary { display: flex; align-items: center; min-block-size: 44px; } }`,
  template: `
    <app-dialog-shell title="ربط مستودع">
      <form [id]="uid" [formGroup]="form" (ngSubmit)="submit()" novalidate class="form-grid">
        <div class="field">
          <label [attr.for]="uid + '-provider'">المزوّد <span class="req">*</span></label>
          <select [id]="uid + '-provider'" class="select" formControlName="provider">
            @for (p of providers; track p.value) {
              <option [value]="p.value">{{ p.label }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-name'">اسم المستودع <span class="req">*</span></label>
          <input [id]="uid + '-name'" class="input ltr" formControlName="name" placeholder="owner/repository" autocomplete="off" />
          @if (showError('name')) {
            <span class="error" role="alert">{{ serverErrors()['name'] || 'الصيغة: owner/repository' }}</span>
          }
        </div>
        <div class="field span-2">
          <label [attr.for]="uid + '-url'">الرابط <span class="req">*</span></label>
          <input [id]="uid + '-url'" class="input ltr" formControlName="url" placeholder="https://git.example.com/owner/repository" autocomplete="off" />
          @if (showError('url')) {
            <span class="error" role="alert">{{ serverErrors()['url'] || 'أدخل رابط https صالحًا' }}</span>
          }
        </div>
        <div class="field">
          <label [attr.for]="uid + '-branch'">الفرع الافتراضي <span class="req">*</span></label>
          <input [id]="uid + '-branch'" class="input ltr" formControlName="defaultBranch" autocomplete="off" />
          @if (showError('defaultBranch')) {
            <span class="error" role="alert">{{ serverErrors()['defaultBranch'] || 'الفرع مطلوب' }}</span>
          }
        </div>
        <div class="field">
          <label [attr.for]="uid + '-token'">رمز الوصول <span class="req">*</span></label>
          <input [id]="uid + '-token'" class="input ltr" type="password" formControlName="accessToken" autocomplete="off" />
          @if (showError('accessToken')) {
            <span class="error" role="alert">{{ serverErrors()['accessToken'] || 'رمز الوصول مطلوب' }}</span>
          } @else {
            <span class="hint">يُحفظ في مخزن الأسرار ولا يُعرض مرة أخرى</span>
          }
        </div>
        <div class="field span-2">
          <label [attr.for]="uid + '-secret'">سر توقيع Webhook <span class="req">*</span></label>
          <div class="secret-row">
            <input [id]="uid + '-secret'" class="input ltr" type="password" formControlName="webhookSecret" autocomplete="off" />
            <button type="button" class="btn btn--outline btn--sm" (click)="generate()">توليد</button>
            <button type="button" class="btn btn--ghost btn--sm" [disabled]="!form.controls.webhookSecret.value" (click)="copySecret()">
              <app-icon name="link" [size]="14" /> نسخ
            </button>
          </div>
          @if (showError('webhookSecret')) {
            <span class="error" role="alert">{{ serverErrors()['webhookSecret'] || 'السر مطلوب (16 حرفًا على الأقل)' }}</span>
          } @else {
            <span class="hint">أدخله نفسه في إعدادات Webhook لدى مزوّد Git؛ لن يُعرض مرة أخرى</span>
          }
        </div>
      </form>
      <details class="setup">
        <summary>خطوات إعداد Webhook في {{ providerName() }}</summary>
        <ol class="steps">
          @for (s of steps(); track $index) {
            <li>{{ s.text }} @if (s.code) { <span class="ltr code">{{ s.code }}</span> }</li>
          }
        </ol>
        <p class="muted">رابط الحمولة يظهر في تبويب Git بعد الربط. السر يُعرض لك الآن فقط ولا يمكن استرجاعه؛ يمكن تدويره لاحقًا.</p>
      </details>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" [attr.form]="uid" class="btn btn--primary" [disabled]="saving()">ربط</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class RepositoryConnectDialog {
  protected readonly uid = `repo-form-${++nextId}`;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(ProjectsApi);
  private readonly data = inject(DIALOG_DATA) as RepositoryConnectData;
  protected readonly ref = inject(DialogRef<ProjectSummary>);
  private readonly toast = inject(ToastService);

  protected readonly providers = (Object.keys(GIT_CONNECTORS) as Repository['provider'][]).map((value) => ({ value, label: providerLabel(value) }));
  protected readonly saving = signal(false);
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});

  protected readonly form = this.fb.group({
    provider: this.fb.control<Repository['provider']>('gitea', Validators.required),
    name: this.fb.control('', [Validators.required, Validators.pattern(/^[\w.-]+\/[\w.-]+$/)]),
    url: this.fb.control('', [Validators.required, Validators.pattern(/^https:\/\/\S+$/)]),
    defaultBranch: this.fb.control('main', Validators.required),
    accessToken: this.fb.control('', Validators.required),
    webhookSecret: this.fb.control('', [Validators.required, Validators.minLength(16)]),
  });

  private readonly provider = toSignal(this.form.controls.provider.valueChanges, { initialValue: this.form.controls.provider.value });
  /** Helper text comes from the provider's connector, never hard-coded per provider. */
  protected readonly steps = computed(() => webhookSteps(this.provider()));
  protected readonly providerName = computed(() => providerLabel(this.provider()));

  protected generate(): void {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    this.form.controls.webhookSecret.setValue(secret);
    this.form.controls.webhookSecret.markAsTouched();
  }

  protected copySecret(): void {
    void navigator.clipboard.writeText(this.form.controls.webhookSecret.value).then(() => this.toast.success('نُسخ السر'));
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
    this.api.connectRepository(this.data.projectId, this.form.getRawValue()).subscribe({
      next: (saved) => {
        this.clearToken();
        this.saving.set(false);
        this.ref.close(saved);
      },
      error: (err: unknown) => {
        this.clearToken();
        this.saving.set(false);
        if (isApiError(err)) this.serverErrors.set(err.details ?? {});
      },
    });
  }

  private clearToken(): void {
    this.form.controls.accessToken.reset('');
    this.form.controls.webhookSecret.reset('');
  }
}

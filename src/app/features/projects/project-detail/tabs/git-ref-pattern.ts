import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectsApi } from '@domain/projects/project.api';
import { ProjectSummary } from '@domain/projects/project.models';
import { defaultRefPattern } from '@domain/git/ref-pattern';
import { effectivePattern, testRefPattern } from './git-logic';

let nextId = 0;

/** FR-GIT-03: the project's work item reference pattern with a live tester. Shown to `git.manage` holders. */
@Component({
  selector: 'app-git-ref-pattern',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-body" [attr.aria-labelledby]="uid + '-title'">
      <h3 class="section-title" [id]="uid + '-title'">نمط رمز العمل في Git</h3>
      <p class="muted">يُربط كل إيداع أو فرع أو طلب دمج برمز العمل الذي يطابق هذا النمط (مجموعة التقاط واحدة).</p>
      <div class="field">
        <label [attr.for]="uid + '-pattern'">النمط (تعبير نمطي)</label>
        <input [id]="uid + '-pattern'" class="input ltr" dir="ltr" autocomplete="off" spellcheck="false" [ngModel]="draft()" (ngModelChange)="draft.set($event); serverError.set('')" [attr.aria-invalid]="!!shownError()" [attr.aria-describedby]="uid + '-hint'" />
        <span [id]="uid + '-hint'" class="hint">الافتراضي: <span class="ltr">{{ defaultPattern() }}</span></span>
        @if (shownError(); as e) {
          <span class="error" role="alert">{{ e }}</span>
        }
      </div>
      <div class="field">
        <label [attr.for]="uid + '-sample'">اختبار — الصق رسالة إيداع أو اسم فرع</label>
        <textarea [id]="uid + '-sample'" class="textarea ltr" dir="ltr" rows="2" [ngModel]="sample()" (ngModelChange)="sample.set($event)" placeholder="feat: login page (ERP-104)"></textarea>
      </div>
      @if (sample().trim()) {
        <div class="result" role="status" aria-live="polite">
          @if (test().error) {
            <span class="error">لا يمكن الاختبار: {{ test().error }}</span>
          } @else {
            <p class="ltr preview" dir="ltr">
              @for (s of test().segments; track $index) {
                @if (s.match) {
                  <mark>{{ s.text }}</mark>
                } @else {
                  <span>{{ s.text }}</span>
                }
              }
            </p>
            <strong>{{ test().refs.length ? 'الرموز المكتشفة:' : 'لم يُكتشف أي رمز عمل.' }}</strong>
            @for (r of test().refs; track r) {
              <span class="ltr ref">{{ r }}</span>
            }
          }
        </div>
      }
      <div class="actions">
        <button type="button" class="btn btn--primary" [disabled]="saving() || !dirty() || !!clientError()" (click)="save()">{{ saving() ? 'جارٍ الحفظ…' : 'حفظ النمط' }}</button>
        <button type="button" class="btn btn--outline" [disabled]="saving() || draft() === defaultPattern()" (click)="reset()">استعادة الافتراضي</button>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; margin-block-start: var(--s-6); }
    .error { color: var(--c-danger); font-size: var(--fs-xs); }
    .result { display: grid; gap: var(--s-2); padding: var(--s-3); border-radius: var(--r-md); background: var(--c-surface-2); margin-block: var(--s-3); }
    .preview { margin: 0; white-space: pre-wrap; word-break: break-all; }
    mark { background: var(--c-gold-100); color: var(--c-text); padding: 0 2px; border-radius: 3px; font-weight: 700; }
    .ref { color: var(--c-primary); font-weight: 700; }
    .actions { display: flex; gap: var(--s-2); flex-wrap: wrap; margin-block-start: var(--s-3); }
    .result { overflow-wrap: anywhere; min-inline-size: 0; }
    .ref { overflow-wrap: anywhere; }
    @media (max-width: 768px) {
      .actions .btn { flex: 1 1 100%; }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .actions .btn { min-block-size: 44px; }
    }
  `,
})
export class GitRefPattern {
  readonly project = input.required<ProjectSummary>();
  readonly changed = output<void>();
  protected readonly uid = `rp${++nextId}`;

  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);

  protected readonly defaultPattern = computed(() => defaultRefPattern(this.project().code));
  private readonly saved = computed(() => effectivePattern(this.project().refPattern, this.project().code));
  protected readonly draft = linkedSignal(() => this.saved());
  protected readonly sample = signal('');
  protected readonly saving = signal(false);
  protected readonly serverError = signal('');

  protected readonly dirty = computed(() => this.draft().trim() !== this.saved());
  protected readonly test = computed(() => testRefPattern(this.draft().trim(), this.project().code, this.sample()));
  /** Validation of the pattern itself (same rules as the server), even before anything is pasted. */
  protected readonly clientError = computed(() => testRefPattern(this.draft().trim(), this.project().code, '').error);
  protected readonly shownError = computed(() => this.serverError() || (this.draft().trim() ? this.clientError() : 'النمط فارغ.'));

  protected save(): void {
    if (this.clientError()) return;
    this.persist(this.draft().trim() === this.defaultPattern() ? null : this.draft().trim(), 'حُفظ النمط');
  }

  protected reset(): void {
    this.draft.set(this.defaultPattern());
    this.persist(null, 'استُعيد النمط الافتراضي');
  }

  private persist(pattern: string | null, message: string): void {
    this.saving.set(true);
    this.serverError.set('');
    this.api.setRefPattern(this.project().id, pattern).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(message);
        this.changed.emit();
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (isApiError(e)) this.serverError.set(e.details?.['refPattern'] ?? e.message);
      },
    });
  }
}

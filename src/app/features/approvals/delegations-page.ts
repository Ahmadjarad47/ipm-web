import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { rxResource } from '@core/state/safe-resource';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { DelegationsApi } from '@domain/approvals/approval.api';
import { Delegation } from '@domain/approvals/approval.models';
import { UserLookup } from '@domain/users/user.api';
import { UserNamePipe } from '@shared/pipes/pipes';
import { Badge } from '@shared/ui/badge/badge';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { HELP } from '@shared/help/help-texts';
import { isInForce, MAX_DELEGATION_DAYS, toDelegationCreate, validateDelegation } from './approval-logic';

const DELEGATE_NEEDS_DECIDE = 'المفوَّض إليه يجب أن يملك صلاحية «اتخاذ قرارات الموافقة» (approvals.decide) ليتمكن من القرار؛ وإلا يُسجَّل التفويض دون أثر.';

/** FR-APR-11: my delegations (admins see everyone's). */
@Component({
  selector: 'app-delegations-page',
  imports: [ReactiveFormsModule, RouterLink, PageHeader, Badge, EmptyState, ErrorState, Skeleton, HelpTip, UserNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './delegations-page.scss',
  template: `
    <app-page-header title="تفويضاتي" subtitle="فوّض قرارات الموافقة لزميل خلال فترة غيابك">
      <a class="btn btn--outline" routerLink="/approvals">العودة إلى مركز الموافقات</a>
    </app-page-header>

    <div class="layout">
      <section class="card card-body" aria-labelledby="dg-new">
        <h2 class="section-title" id="dg-new">
          تفويض جديد
          <app-help-tip [text]="help.delegation" />
          <app-help-tip [text]="delegateNeedsDecide" label="شرط المفوَّض إليه" />
        </h2>
        <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          @if (isAdmin()) {
            <div class="field">
              <label for="dg-from">المفوِّض (بصفتك مدير الموافقات)</label>
              <select id="dg-from" class="select" formControlName="fromUserId">
                @for (u of activeUsers(); track u.id) {
                  <option [value]="u.id">{{ u.name }}</option>
                }
              </select>
            </div>
          }
          <div class="field">
            <label for="dg-to">المفوَّض إليه <span class="req">*</span></label>
            <select id="dg-to" class="select" formControlName="toUserId" [attr.aria-invalid]="!!fieldError('toUserId')">
              <option value="">— اختر مستخدمًا —</option>
              @for (u of candidates(); track u.id) {
                <option [value]="u.id">{{ u.name }}</option>
              }
            </select>
            @if (fieldError('toUserId'); as e) {
              <span class="error" role="alert">{{ e }}</span>
            }
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="dg-start">من <span class="req">*</span></label>
              <input id="dg-start" type="date" class="input ltr" formControlName="from" [attr.aria-invalid]="!!fieldError('from')" />
              @if (fieldError('from'); as e) {
                <span class="error" role="alert">{{ e }}</span>
              }
            </div>
            <div class="field">
              <label for="dg-end">إلى <span class="req">*</span></label>
              <input id="dg-end" type="date" class="input ltr" formControlName="to" [attr.aria-invalid]="!!fieldError('to')" />
              @if (fieldError('to'); as e) {
                <span class="error" role="alert">{{ e }}</span>
              } @else {
                <span class="hint">بحد أقصى {{ maxDays }} يومًا.</span>
              }
            </div>
          </div>
          <div class="field">
            <label for="dg-reason">السبب <span class="req">*</span></label>
            <textarea id="dg-reason" class="textarea" rows="2" formControlName="reason" [attr.aria-invalid]="!!fieldError('reason')"></textarea>
            @if (fieldError('reason'); as e) {
              <span class="error" role="alert">{{ e }}</span>
            }
          </div>
          @if (serverMessage(); as m) {
            <p class="error" role="alert">{{ m }}</p>
          }
          <div>
            <button type="submit" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : 'إنشاء التفويض' }}</button>
          </div>
        </form>
      </section>

      <section class="card" aria-labelledby="dg-list">
        <h2 class="section-title pad" id="dg-list">{{ isAdmin() ? 'كل التفويضات' : 'تفويضاتي والمفوَّضة إليّ' }}</h2>
        @if (list.isLoading() && !list.hasValue()) {
          <app-skeleton variant="table" [count]="4" />
        } @else if (list.error()) {
          <app-error-state title="تعذّر تحميل التفويضات" (retry)="list.reload()" />
        } @else if (!list.value().length) {
          <app-empty-state icon="approval" title="لا توجد تفويضات" text="أنشئ تفويضًا من النموذج لتمرير قراراتك خلال غيابك." />
        } @else {
          <div class="scroll">
            <table class="dtable">
              <caption class="sr-only">التفويضات</caption>
              <thead>
                <tr>
                  <th scope="col">المفوِّض</th>
                  <th scope="col">المفوَّض إليه</th>
                  <th scope="col">الفترة</th>
                  <th scope="col">السبب</th>
                  <th scope="col">الحالة</th>
                  <th scope="col"><span class="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody>
                @for (d of list.value(); track d.id) {
                  <tr>
                    <td>{{ d.fromUserId | userName }}</td>
                    <td>{{ d.toUserId | userName }}</td>
                    <td class="ltr">{{ d.from }} → {{ d.to }}</td>
                    <td>{{ d.reason }}</td>
                    <td>
                      @if (!d.active) {
                        <app-badge tone="neutral">ملغى</app-badge>
                      } @else if (inForce(d)) {
                        <app-badge tone="success">سارٍ</app-badge>
                      } @else if (d.from > today) {
                        <app-badge tone="info">مجدول</app-badge>
                      } @else {
                        <app-badge tone="neutral">منتهٍ</app-badge>
                      }
                    </td>
                    <td>
                      @if (d.active && canRevoke(d)) {
                        <button type="button" class="btn btn--ghost btn--sm" [disabled]="revoking() === d.id" (click)="revoke(d)">إلغاء التفويض</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
})
export class DelegationsPage {
  private readonly api = inject(DelegationsApi);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly auth = inject(AuthService);
  private readonly users = inject(UserLookup);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly help = HELP;
  protected readonly delegateNeedsDecide = DELEGATE_NEEDS_DECIDE;
  protected readonly maxDays = MAX_DELEGATION_DAYS;
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly isAdmin = computed(() => this.auth.can('approvals.configure'));
  private readonly meId = computed(() => this.auth.user()?.id ?? '');

  protected readonly form = this.fb.group({
    fromUserId: this.fb.control(''),
    toUserId: this.fb.control(''),
    from: this.fb.control(this.today),
    to: this.fb.control(''),
    reason: this.fb.control(''),
  });

  protected readonly saving = signal(false);
  protected readonly revoking = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly serverMessage = signal('');
  private readonly clientErrors = signal<Readonly<Record<string, string>>>({});

  protected readonly activeUsers = computed(() => this.users.items().filter((u) => u.active));
  private readonly pickedFrom = toSignal(this.form.controls.fromUserId.valueChanges, { initialValue: '' });
  private readonly effectiveFrom = computed(() => (this.isAdmin() && this.pickedFrom()) || this.meId());
  protected readonly candidates = computed(() => this.activeUsers().filter((u) => u.id !== this.effectiveFrom() && u.id !== this.meId()));

  protected readonly list = rxResource<readonly Delegation[], true>({
    params: () => true,
    stream: () => this.api.list(),
    defaultValue: [],
  });

  protected fieldError(name: string): string {
    return this.serverErrors()[name] || this.clientErrors()[name] || '';
  }

  protected inForce(d: Delegation): boolean {
    return isInForce(d, this.today);
  }

  protected canRevoke(d: Delegation): boolean {
    return d.fromUserId === this.meId() || this.isAdmin();
  }

  protected submit(): void {
    this.serverErrors.set({});
    this.serverMessage.set('');
    const v = this.form.getRawValue();
    const fromUserId = (this.isAdmin() && v.fromUserId) || this.meId();
    const input = { fromUserId, toUserId: v.toUserId, from: v.from, to: v.to, reason: v.reason };
    const errors = validateDelegation(input);
    this.clientErrors.set(errors);
    if (Object.keys(errors).length) return;
    this.saving.set(true);
    this.api.create(toDelegationCreate(input, fromUserId !== this.meId())).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('تم إنشاء التفويض');
        this.form.patchValue({ toUserId: '', to: '', reason: '' });
        this.clientErrors.set({});
        this.list.reload();
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (isApiError(e)) {
          this.serverErrors.set(e.details ?? {});
          this.serverMessage.set(e.message);
        }
      },
    });
  }

  protected revoke(d: Delegation): void {
    this.confirm
      .confirm({ title: 'إلغاء التفويض', message: 'ستعود صلاحية القرار إلى أصحابها فورًا. هل تريد المتابعة؟', confirmText: 'إلغاء التفويض', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.revoking.set(d.id);
        this.api.revoke(d.id).subscribe({
          next: () => {
            this.revoking.set(null);
            this.toast.success('أُلغي التفويض');
            this.list.reload();
          },
          error: () => this.revoking.set(null),
        });
      });
  }
}

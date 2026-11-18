import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalRequest } from '@domain/approvals/approval.models';
import { UserLookup } from '@domain/users/user.api';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';

export interface ReassignData {
  readonly request: ApprovalRequest;
  readonly stageName: string;
}

let nextId = 0;

/** FR-APR-11: substitute the active stage approver with a mandatory reason. */
@Component({
  selector: 'app-reassign-dialog',
  imports: [FormsModule, DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="إعادة تعيين المعتمد" [subtitle]="data.stageName">
      <div class="field">
        <label [attr.for]="uid + '-ra-user'">المعتمد البديل <span class="req">*</span></label>
        <select [id]="uid + '-ra-user'" class="select" [ngModel]="approverId()" (ngModelChange)="approverId.set($event)">
          <option value="" disabled>اختر مستخدمًا</option>
          @for (u of candidates(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label [attr.for]="uid + '-ra-reason'">السبب <span class="req">*</span></label>
        <textarea [id]="uid + '-ra-reason'" class="textarea" [ngModel]="reason()" (ngModelChange)="reason.set($event)"></textarea>
        @if (touched() && !reason().trim()) {
          <span class="error" role="alert">السبب إلزامي</span>
        }
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn btn--primary" [disabled]="saving()" (click)="submit()">إعادة التعيين</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `:host { display: block; max-inline-size: calc(100vw - 32px); }`,
})
export class ReassignDialog {
  protected readonly uid = `reassign${++nextId}`;
  protected readonly data = inject(DIALOG_DATA) as ReassignData;
  protected readonly ref = inject(DialogRef<boolean>);
  private readonly api = inject(ApprovalRequestsApi);
  private readonly users = inject(UserLookup);

  protected readonly approverId = signal('');
  protected readonly reason = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);

  protected readonly candidates = computed(() => this.users.items().filter((u) => u.active && u.id !== this.data.request.requesterId));

  protected submit(): void {
    this.touched.set(true);
    if (!this.approverId() || !this.reason().trim()) return;
    this.saving.set(true);
    this.api.reassign(this.data.request.id, this.approverId(), this.reason().trim()).subscribe({
      next: () => this.ref.close(true),
      error: () => this.saving.set(false),
    });
  }
}

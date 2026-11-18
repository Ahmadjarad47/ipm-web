import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalRequest, ApprovalTemplate } from '@domain/approvals/approval.models';
import { isApiError } from '@core/models/api-error.model';
import { ApprovalTemplatePicker } from '@shared/domain-ui/approval-template-picker';
import { ProposedChangesEditor, ProposedValues } from '@shared/domain-ui/proposed-changes-editor';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { ltr } from './work-item-utils';

export interface RequestApprovalData {
  readonly itemId: string;
  readonly ref: string;
}

/**
 * Submits an approval request for a work item with the template the server resolves (FR-APR-01/13).
 * A `sensitive.change` template also needs the proposed values. Closes with the created request.
 */
@Component({
  selector: 'app-request-approval-dialog',
  imports: [DialogShell, ApprovalTemplatePicker, ProposedChangesEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="طلب موافقة" [subtitle]="ltr(data.ref)">
      <app-approval-template-picker subjectType="workItem" [subjectId]="data.itemId" preferredAction="close" [(selected)]="selected" />
      @if (sensitive(); as t) {
        <app-proposed-changes-editor [fields]="t.protectedFields" subjectType="workItem" [subjectId]="data.itemId" [errors]="fieldErrors()" [(value)]="proposed" />
      }
      @if (serverError(); as e) {
        <p class="err" role="alert">{{ e }}</p>
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn btn--primary" [disabled]="!canSubmit()" (click)="submit()">إرسال الطلب</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    .err { color: var(--c-danger); margin: var(--s-3) 0 0; overflow-wrap: anywhere; }
    app-proposed-changes-editor { margin-block-start: var(--s-4); }
  `,
})
export class RequestApprovalDialog {
  protected readonly data = inject(DIALOG_DATA) as RequestApprovalData;
  protected readonly ref = inject(DialogRef<ApprovalRequest>);
  private readonly requests = inject(ApprovalRequestsApi);
  protected readonly ltr = ltr;

  protected readonly selected = signal<ApprovalTemplate | null>(null);
  protected readonly proposed = signal<ProposedValues>({});
  protected readonly busy = signal(false);
  protected readonly serverError = signal('');
  protected readonly fieldErrors = signal<Readonly<Record<string, string>>>({});

  protected readonly sensitive = computed(() => (this.selected()?.event === 'sensitive.change' ? this.selected() : null));
  protected readonly canSubmit = computed(() => !!this.selected() && !this.busy() && (!this.sensitive() || Object.keys(this.proposed()).length > 0));

  protected submit(): void {
    const template = this.selected();
    if (!template || !this.canSubmit()) return;
    this.busy.set(true);
    this.serverError.set('');
    this.fieldErrors.set({});
    const proposedChanges = this.sensitive() ? this.proposed() : undefined;
    this.requests.create({ templateId: template.id, subjectType: 'workItem', subjectId: this.data.itemId, ...(proposedChanges ? { proposedChanges } : {}) }).subscribe({
      next: (r) => this.ref.close(r),
      error: (e: unknown) => {
        this.busy.set(false);
        if (isApiError(e)) {
          this.serverError.set(e.message);
          this.fieldErrors.set(e.details ?? {});
        }
      },
    });
  }
}

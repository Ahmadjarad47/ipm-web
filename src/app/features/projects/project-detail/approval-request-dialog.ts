import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalTemplate } from '@domain/approvals/approval.models';
import { isApiError } from '@core/models/api-error.model';
import { ApprovalTemplatePicker } from '@shared/domain-ui/approval-template-picker';
import { ProposedChangesEditor, ProposedValues } from '@shared/domain-ui/proposed-changes-editor';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';

export interface ApprovalRequestData {
  readonly projectId: string;
  readonly projectName: string;
}

/** Submits a project approval request with the template the server resolves for the project (FR-APR-01/13). */
@Component({
  selector: 'app-approval-request-dialog',
  imports: [DialogShell, ApprovalTemplatePicker, ProposedChangesEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="طلب موافقة" [subtitle]="data.projectName">
      <app-approval-template-picker subjectType="project" [subjectId]="data.projectId" preferredAction="activate" [(selected)]="selected" />
      @if (sensitive(); as t) {
        <app-proposed-changes-editor [fields]="t.protectedFields" subjectType="project" [subjectId]="data.projectId" [errors]="fieldErrors()" [(value)]="proposed" />
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
  styles: `:host { display: block; max-inline-size: calc(100vw - 32px); } .err { color: var(--c-danger); margin: var(--s-3) 0 0; overflow-wrap: anywhere; } app-proposed-changes-editor { margin-block-start: var(--s-4); display: block; min-inline-size: 0; }`,
})
export class ApprovalRequestDialog {
  protected readonly data = inject(DIALOG_DATA) as ApprovalRequestData;
  protected readonly ref = inject(DialogRef<boolean>);
  private readonly requests = inject(ApprovalRequestsApi);

  protected readonly selected = signal<ApprovalTemplate | null>(null);
  protected readonly saving = signal(false);
  protected readonly serverError = signal('');
  protected readonly proposed = signal<ProposedValues>({});
  protected readonly fieldErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly sensitive = computed(() => (this.selected()?.event === 'sensitive-change' ? this.selected() : null));
  protected readonly canSubmit = computed(() => !!this.selected() && !this.saving() && (!this.sensitive() || Object.keys(this.proposed()).length > 0));

  protected submit(): void {
    const template = this.selected();
    if (!template) return;
    this.saving.set(true);
    this.serverError.set('');
    this.fieldErrors.set({});
    const proposedChanges = this.sensitive() ? this.proposed() : undefined;
    this.requests.create({ templateId: template.id, subjectType: 'project', subjectId: this.data.projectId, ...(proposedChanges ? { proposedChanges } : {}) }).subscribe({
      next: () => this.ref.close(true),
      error: (e: unknown) => {
        this.saving.set(false);
        if (isApiError(e)) {
          this.serverError.set(e.message);
          this.fieldErrors.set(e.details ?? {});
        }
      },
    });
  }
}

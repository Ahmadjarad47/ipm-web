import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { PERMISSION_LABELS } from '@core/auth/permission-labels';
import { ALL_PERMISSIONS, PermissionKey } from '@core/auth/permissions';
import { HELP } from '@shared/help/help-texts';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { ADMIN_HELP } from '../shared/admin-help';
import { Transition } from '@domain/workflow/workflow.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';

export interface TransitionRuleData {
  readonly fromName: string;
  readonly toName: string;
  readonly transition: Transition;
}

/** Rule flags of one allowed transition (FR-WF-09, FR-REL-08). */
@Component({
  selector: 'app-transition-rule-dialog',
  imports: [ReactiveFormsModule, DialogShell, HelpTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `.opt { display: flex; align-items: center; gap: var(--s-1); }`,
  template: `
    <app-dialog-shell title="قواعد الانتقال" [subtitle]="data.fromName + ' ← ' + data.toName">
      <form id="rule-form" [formGroup]="form" (ngSubmit)="apply()" class="stack">
        <div class="field">
          <label for="rule-perm">صلاحية إضافية (اختياري) <app-help-tip [text]="help.transitionPermission" /></label>
          <select id="rule-perm" class="select ltr" formControlName="permission">
            <option value="">— بدون —</option>
            @for (p of permissions; track p) {
              <option [value]="p">{{ p }} — {{ labels[p] }}</option>
            }
          </select>
          <span class="hint">تُطلب فوق صلاحية <span class="ltr">workflow.transition</span>.</span>
        </div>
        <div class="opt"><label class="checkbox"><input type="checkbox" formControlName="requiresAssignee" /> يتطلب وجود مكلَّف بالعنصر</label><app-help-tip [text]="help.requiresAssignee" /></div>
        <div class="opt"><label class="checkbox"><input type="checkbox" formControlName="requiresApproval" /> يتطلب موافقة معتمدة</label><app-help-tip [text]="help.requiresApproval" /></div>
        <div class="opt"><label class="checkbox"><input type="checkbox" formControlName="blockedByOpenDependencies" /> يُرفض عند وجود اعتماديات «تحجب» مفتوحة</label><app-help-tip [text]="blockedHelp" /></div>
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="rule-form" class="btn btn--primary">تطبيق</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class TransitionRuleDialog {
  protected readonly ref = inject<DialogRef<Transition>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as TransitionRuleData;
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly permissions = ALL_PERMISSIONS;
  protected readonly labels = PERMISSION_LABELS;
  protected readonly help = ADMIN_HELP;
  protected readonly blockedHelp = HELP.blockedByOpenDependencies;
  protected readonly form = this.fb.group({
    permission: this.fb.control<PermissionKey | ''>(this.data.transition.permission ?? ''),
    requiresAssignee: this.fb.control(this.data.transition.requiresAssignee ?? false),
    requiresApproval: this.fb.control(this.data.transition.requiresApproval ?? false),
    blockedByOpenDependencies: this.fb.control(this.data.transition.blockedByOpenDependencies ?? false),
  });

  protected apply(): void {
    const v = this.form.getRawValue();
    const { fromStatusId, toStatusId } = this.data.transition;
    this.ref.close({
      fromStatusId,
      toStatusId,
      ...(v.permission ? { permission: v.permission } : {}),
      ...(v.requiresAssignee ? { requiresAssignee: true } : {}),
      ...(v.requiresApproval ? { requiresApproval: true } : {}),
      ...(v.blockedByOpenDependencies ? { blockedByOpenDependencies: true } : {}),
    });
  }
}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MemberWarning } from '@domain/projects/project.models';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';

export interface MemberWarningsData {
  readonly projectId: string;
  readonly warnings: readonly MemberWarning[];
}

/** Open work still assigned to removed members (FR-PRJ-05): data is kept, the caller must re-assign it. */
@Component({
  selector: 'app-member-warnings-dialog',
  imports: [DialogShell, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="عناصر مفتوحة لأعضاء أُزيلوا" subtitle="أُزيل الأعضاء، لكن العناصر التالية ما زالت مُسندة إليهم. أعد إسنادها لتفادي بقائها بلا متابعة.">
      <ul class="warnings">
        @for (w of data.warnings; track w.userId) {
          <li>
            <strong>{{ w.userName }}</strong>
            <p class="muted">{{ w.message }}</p>
            <ul class="refs">
              @for (r of w.refs; track r) {
                <li>
                  <a class="ltr" [routerLink]="['/work-items']" [queryParams]="{ projectId: data.projectId }" (click)="ref.close()" [attr.aria-label]="'فتح عناصر المشروع للعنصر ' + r">{{ r }}</a>
                </li>
              }
            </ul>
          </li>
        }
      </ul>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--primary" (click)="ref.close()">حسنًا</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .warnings { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
    .warnings p { margin: var(--s-1) 0 var(--s-2); font-size: var(--fs-sm); }
    .refs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .refs a { display: inline-flex; align-items: center; min-height: 28px; overflow-wrap: anywhere; padding: 0 var(--s-3); border-radius: var(--r-pill); background: var(--c-warning-bg); color: var(--c-warning); font-weight: 600; text-decoration: none; }
    .refs a:hover { text-decoration: underline; }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    @media (pointer: coarse), (max-width: 768px) { .refs a { min-height: 44px; } }
  `,
})
export class MemberWarningsDialog {
  protected readonly ref = inject(DialogRef);
  protected readonly data = inject<MemberWarningsData>(DIALOG_DATA);
}

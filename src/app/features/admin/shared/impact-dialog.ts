import { ChangeDetectionStrategy, Component, inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, switchMap } from 'rxjs';
import { ImpactInfo } from '@domain/work-items/work-item.models';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { Icon } from '@shared/ui/icon/icon';
import { hasImpact, impactSummary, ImpactKind } from './impact';

export interface ImpactDialogData {
  readonly title: string;
  readonly intro: string;
  readonly kind: ImpactKind;
  /** Shown as the «سيتأثر…» summary when present. */
  readonly impact: ImpactInfo | null;
  /** Server 422 conflicts as `[name, count-or-reason]`; turns the dialog into an informational one. */
  readonly conflicts: readonly (readonly [string, string])[];
  readonly guidance: string;
  /** Empty = informational dialog with a single «فهمت» button. */
  readonly confirmText: string;
}

/** Confirm dialog with the server-computed impact, or the list of conflicts that block the change. */
@Component({
  selector: 'app-impact-dialog',
  imports: [DialogShell, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .sum { display: flex; gap: var(--s-3); align-items: flex-start; margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--c-warning-bg); color: var(--c-warning); font-weight: 600; line-height: 1.7; }
    .sum.ok { background: var(--c-info-bg); color: var(--c-info); }
    .list { margin: 0; padding-inline-start: var(--s-5); display: flex; flex-direction: column; gap: var(--s-1); }
    .guide { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--c-surface-2); font-size: var(--fs-sm); }
  `,
  template: `
    <app-dialog-shell [title]="data.title">
      <div class="stack">
        <p>{{ data.intro }}</p>
        @if (data.impact; as imp) {
          <p class="sum" [class.ok]="!hasImpact(imp)" role="status">
            <app-icon [name]="hasImpact(imp) ? 'alert' : 'info'" [size]="18" />
            <span>{{ summary(imp) }}</span>
          </p>
        }
        @if (data.conflicts.length) {
          <ul class="list" aria-label="التعارضات">
            @for (c of data.conflicts; track c[0]) {
              <li><strong>{{ c[0] }}</strong>: {{ c[1] }}</li>
            }
          </ul>
        }
        @if (data.guidance) {
          <p class="guide">{{ data.guidance }}</p>
        }
      </div>
      <ng-container dialog-actions>
        @if (data.confirmText) {
          <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
          <button type="button" class="btn btn--danger" (click)="ref.close(true)">{{ data.confirmText }}</button>
        } @else {
          <button type="button" class="btn btn--primary" (click)="ref.close()">فهمت</button>
        }
      </ng-container>
    </app-dialog-shell>
  `,
})
export class ImpactDialog {
  protected readonly ref = inject<DialogRef<true>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as ImpactDialogData;
  protected readonly hasImpact = hasImpact;

  protected summary(impact: ImpactInfo): string {
    return impactSummary(impact, this.data.kind);
  }
}

export interface ImpactConfirmOptions {
  readonly title: string;
  readonly intro: string;
  readonly kind: ImpactKind;
  readonly load: Observable<ImpactInfo>;
  readonly guidance?: string;
  readonly confirmText: string;
}

export interface ConflictOptions {
  readonly title: string;
  readonly intro: string;
  readonly entries: readonly (readonly [string, string])[];
  readonly guidance: string;
}

/** Opens the impact / conflict dialogs; `confirm` emits `true` only when the admin confirms. */
@Injectable({ providedIn: 'root' })
export class ImpactPrompt {
  private readonly dialog = inject(DialogService);

  confirm(options: ImpactConfirmOptions): Observable<boolean> {
    return options.load.pipe(
      switchMap((impact) =>
        this.dialog
          .open<ImpactDialog, ImpactDialogData, true>(ImpactDialog, {
            data: {
              title: options.title,
              intro: options.intro,
              kind: options.kind,
              impact,
              conflicts: [],
              guidance: options.guidance ?? '',
              confirmText: options.confirmText,
            },
            width: 'min(520px, calc(100vw - 32px))',
          })
          .afterClosed.pipe(map((r) => r === true)),
      ),
      // The interceptor already toasted the failure; never proceed without knowing the impact.
      catchError(() => of(false)),
    );
  }

  conflicts(options: ConflictOptions): void {
    this.dialog.open<ImpactDialog, ImpactDialogData, true>(ImpactDialog, {
      data: { title: options.title, intro: options.intro, kind: 'type', impact: null, conflicts: options.entries, guidance: options.guidance, confirmText: '' },
      width: 'min(520px, calc(100vw - 32px))',
    });
  }
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BulkAction, BulkResult } from '@domain/work-items/work-item.api';
import { Priority } from '@domain/work-items/work-item.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { PRIORITY_OPTIONS } from './work-item-utils';

export interface NamedOption {
  readonly id: string;
  readonly name: string;
}

export interface BulkActionData {
  readonly kind: BulkAction['kind'];
  readonly count: number;
  /** Candidate assignees (members of the selected items' projects). */
  readonly users: readonly NamedOption[];
  /** Statuses present in every selected item's workflow. */
  readonly statuses: readonly NamedOption[];
}

const TITLES: Readonly<Record<BulkAction['kind'], string>> = {
  assign: 'تكليف',
  priority: 'تغيير الأولوية',
  transition: 'نقل الحالة',
  dueDate: 'تاريخ الاستحقاق',
};

let nextId = 0;

/** Collects the parameters of one bulk action. Closes with the `BulkAction` to run. */
@Component({
  selector: 'app-bulk-action-dialog',
  imports: [FormsModule, DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="title" [subtitle]="'سيُطبَّق على ' + data.count + ' عمل'">
      @switch (data.kind) {
        @case ('assign') {
          <fieldset class="opts">
            <legend>المكلّفون (يستبدلون المكلّفين الحاليين)</legend>
            @for (u of data.users; track u.id) {
              <label class="opt"><input type="checkbox" [checked]="users().includes(u.id)" (change)="toggleUser(u.id)" /> {{ u.name }}</label>
            } @empty {
              <span class="muted">لا يوجد أعضاء.</span>
            }
          </fieldset>
        }
        @case ('priority') {
          <div class="field">
            <label [attr.for]="uid + '-bk-priority'">الأولوية</label>
            <select [id]="uid + '-bk-priority'" class="select" [(ngModel)]="priority">
              @for (o of priorities; track o.value) {
                <option [value]="o.value">{{ o.label }}</option>
              }
            </select>
          </div>
        }
        @case ('transition') {
          <div class="field">
            <label [attr.for]="uid + '-bk-status'">الحالة الجديدة</label>
            <select [id]="uid + '-bk-status'" class="select" [(ngModel)]="statusId">
              <option value="">اختر…</option>
              @for (s of data.statuses; track s.id) {
                <option [value]="s.id">{{ s.name }}</option>
              }
            </select>
            @if (!data.statuses.length) {
              <span class="muted">لا توجد حالة مشتركة بين سير عمل الأعمال المحددة.</span>
            }
          </div>
        }
        @case ('dueDate') {
          <div class="field">
            <label [attr.for]="uid + '-bk-due'">تاريخ الاستحقاق</label>
            <input [id]="uid + '-bk-due'" class="input" type="date" [(ngModel)]="dueDate" />
            <span class="muted">اتركه فارغًا لإزالة التاريخ.</span>
          </div>
        }
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn btn--primary" [disabled]="!valid()" (click)="confirm()">تطبيق</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .opts { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); max-height: 280px; overflow-y: auto; }
    .opts legend { margin-bottom: var(--s-2); font-weight: 600; }
    .opt { display: flex; align-items: center; gap: var(--s-2); }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    @media (pointer: coarse), (max-width: 768px) {
      .opt { min-block-size: 44px; }
      .opt input { inline-size: 20px; block-size: 20px; }
    }
  `,
})
export class BulkActionDialog {
  protected readonly uid = `bulk${++nextId}`;
  protected readonly data = inject(DIALOG_DATA) as BulkActionData;
  protected readonly ref = inject(DialogRef<BulkAction>);
  protected readonly title = TITLES[this.data.kind];
  protected readonly priorities = PRIORITY_OPTIONS;

  protected readonly users = signal<readonly string[]>([]);
  protected priority: Priority = 'medium';
  protected statusId = '';
  protected dueDate = '';

  protected valid(): boolean {
    return this.data.kind !== 'transition' || !!this.statusId;
  }

  protected toggleUser(id: string): void {
    this.users.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  protected confirm(): void {
    switch (this.data.kind) {
      case 'assign':
        this.ref.close({ kind: 'assign', assigneeIds: this.users() });
        break;
      case 'priority':
        this.ref.close({ kind: 'priority', priority: this.priority });
        break;
      case 'transition':
        if (this.statusId) this.ref.close({ kind: 'transition', toStatusId: this.statusId });
        break;
      case 'dueDate':
        this.ref.close({ kind: 'dueDate', dueDate: this.dueDate || null });
        break;
    }
  }
}

/** Per-item outcome of a bulk action: successes and rejection reasons (never all-or-nothing silently). */
@Component({
  selector: 'app-bulk-result-dialog',
  imports: [DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="نتيجة الإجراء الجماعي" [subtitle]="okCount + ' نجح · ' + failed.length + ' مرفوض'">
      <div aria-live="polite">
      @if (failed.length) {
        <h3 class="sub">مرفوضة</h3>
        <ul class="res">
          @for (r of failed; track r.id) {
            <li><span class="ltr">{{ r.ref }}</span> <span class="muted">{{ r.message || 'تعذّر التنفيذ' }}</span></li>
          }
        </ul>
      }
      @if (okCount) {
        <h3 class="sub">نجحت</h3>
        <p>
          @for (r of succeeded; track r.id) {
            <span class="ltr ok">{{ r.ref }}</span>{{ $last ? '' : ' ' }}
          }
        </p>
      }
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--primary" (click)="ref.close()">إغلاق</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .sub { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .res { margin: 0 0 var(--s-4); padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--s-1); }
    .ok { margin-inline-end: var(--s-2); color: var(--c-success); }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    .res li { overflow-wrap: anywhere; }
  `,
})
export class BulkResultDialog {
  protected readonly results = inject(DIALOG_DATA) as readonly BulkResult[];
  protected readonly ref = inject(DialogRef);
  protected readonly succeeded = this.results.filter((r) => r.ok);
  protected readonly failed = this.results.filter((r) => !r.ok);
  protected readonly okCount = this.succeeded.length;
}

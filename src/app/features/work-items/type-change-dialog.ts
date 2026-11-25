import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { ltr } from './work-item-utils';

export interface TypeChangeData {
  readonly item: WorkItem;
}

let nextId = 0;

/** FR-TYP-08 / AT-21: dry-run the conversion, list every conflict, enable it only when there are none. */
@Component({
  selector: 'app-type-change-dialog',
  imports: [DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="تحويل نوع العمل" [subtitle]="ltr(item.ref)">
      <div class="field">
        <label [attr.for]="uid + '-tc-type'">النوع الجديد</label>
        <select [id]="uid + '-tc-type'" class="select" (change)="pick($event)">
          <option value="">— اختر نوعًا —</option>
          @for (t of targets(); track t.id) {
            <option [value]="t.id">{{ t.name }}</option>
          }
        </select>
      </div>
      @if (targetId()) {
        <div class="result" aria-live="polite">
          @if (check.isLoading()) {
            <p class="muted">جارٍ فحص التوافق…</p>
          } @else if (check.error()) {
            <p class="error" role="alert">تعذّر فحص التوافق.</p>
          } @else if (conflicts().length) {
            <p class="error"><strong>لا يمكن التحويل بسبب التعارضات التالية:</strong></p>
            <ul>
              @for (c of conflicts(); track $index) {
                <li>{{ c.reason }}</li>
              }
            </ul>
          } @else {
            <p class="ok">لا توجد تعارضات، يمكن التحويل.</p>
          }
        </div>
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn btn--primary" [disabled]="!canConvert()" (click)="convert()">تحويل</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .result { margin-top: var(--s-4); }
    ul { margin: var(--s-2) 0 0; padding-inline-start: var(--s-5); color: var(--c-danger); }
    .ok { color: var(--c-success); font-weight: 600; }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    li { overflow-wrap: anywhere; }
  `,
})
export class TypeChangeDialog {
  protected readonly uid = `type${++nextId}`;
  protected readonly item = (inject(DIALOG_DATA) as TypeChangeData).item;
  protected readonly ref = inject(DialogRef<WorkItem>);
  protected readonly ltr = ltr;
  private readonly api = inject(WorkItemsApi);
  private readonly toast = inject(ToastService);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly projects = inject(ProjectLookup);

  protected readonly targetId = signal('');
  private readonly saving = signal(false);

  protected readonly targets = computed(() => {
    const allowed = this.projects.get(this.item.projectId)?.allowedTypeIds ?? [];
    return this.types.items().filter((t) => t.active && t.id !== this.item.typeId && allowed.includes(t.id));
  });

  protected readonly check = rxResource({
    params: () => this.targetId() || undefined,
    stream: ({ params }) => this.api.checkTypeChange(this.item.id, params),
  });
  protected readonly conflicts = computed(() => this.check.value() ?? []);
  protected readonly canConvert = computed(
    () => !!this.targetId() && !this.check.isLoading() && !this.check.error() && this.check.hasValue() && !this.conflicts().length && !this.saving(),
  );

  protected pick(event: Event): void {
    this.targetId.set((event.target as HTMLSelectElement).value);
  }

  protected convert(): void {
    if (!this.canConvert()) return;
    this.saving.set(true);
    this.api.changeType(this.item.id, this.targetId(), this.item.version).subscribe({
      next: (updated) => {
        this.toast.success('تم تحويل النوع');
        this.ref.close(updated);
      },
      error: () => this.saving.set(false),
    });
  }
}

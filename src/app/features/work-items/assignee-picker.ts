import { ChangeDetectionStrategy, Component, inject, input, model } from '@angular/core';
import { UserLookup } from '@domain/users/user.api';

/** Checkbox list to pick assignees among `userIds` (project members). */
@Component({
  selector: 'app-assignee-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="list" role="group" [attr.aria-label]="label()">
      @for (id of userIds(); track id) {
        <label class="checkbox">
          <input type="checkbox" [checked]="value().includes(id)" [disabled]="disabled()" (change)="toggle(id)" />
          {{ users.nameOf(id) }}
        </label>
      } @empty {
        <span class="muted">لا يوجد أعضاء في المشروع.</span>
      }
    </div>
  `,
  styles: `
    .list { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); }
    @media (pointer: coarse), (max-width: 768px) {
      .checkbox { min-block-size: 44px; }
      .checkbox input { inline-size: 20px; block-size: 20px; }
    }
  `,
})
export class AssigneePicker {
  protected readonly users = inject(UserLookup);
  readonly userIds = input.required<readonly string[]>();
  readonly value = model<readonly string[]>([]);
  readonly disabled = input(false);
  readonly label = input('المكلّفون');

  protected toggle(id: string): void {
    const current = this.value();
    this.value.set(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }
}

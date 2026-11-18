import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Status, Transition } from '@domain/workflow/workflow.models';

export interface TransitionToggle {
  readonly fromStatusId: string;
  readonly toStatusId: string;
  readonly allowed: boolean;
}

/** From (rows) × To (columns) grid of allowed transitions; allowed cells expose a "rules" button. */
@Component({
  selector: 'app-transition-matrix',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../shared/matrix.scss'],
  template: `
    <div class="mx-scroll" tabindex="0" role="region" aria-label="مصفوفة الانتقالات (قابلة للتمرير)">
      <table class="mx">
        <caption class="sr-only">مصفوفة الانتقالات: الصفوف هي الحالة الحالية والأعمدة هي الحالة التالية</caption>
        <thead>
          <tr>
            <th scope="col" class="corner">من (الصفوف) / إلى (الأعمدة)</th>
            @for (to of statuses(); track to.id) {
              <th scope="col" [style.--sw]="to.color"><span class="dot"></span>{{ to.name }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (from of statuses(); track from.id) {
            <tr>
              <th scope="row" [style.--sw]="from.color"><span class="dot"></span>{{ from.name }}</th>
              @for (to of statuses(); track to.id) {
                @let t = find(from.id, to.id);
                <td [class.self]="from.id === to.id" [class.on]="!!t">
                  @if (from.id === to.id) {
                    <span class="muted" aria-hidden="true">—</span>
                  } @else {
                    <div class="cell">
                      <label class="hit">
                        <input type="checkbox" [checked]="!!t" [disabled]="readonly()"
                          [attr.aria-label]="'السماح بالانتقال من ' + from.name + ' إلى ' + to.name"
                          (change)="toggled.emit({ fromStatusId: from.id, toStatusId: to.id, allowed: $any($event.target).checked })" />
                      </label>
                      @if (t) {
                        <button type="button" class="rule" [class.has]="hasRules(t)" (click)="editRule.emit(t)"
                          [attr.aria-label]="'قواعد الانتقال من ' + from.name + ' إلى ' + to.name + (hasRules(t) ? ' (توجد قواعد)' : '')">قواعد</button>
                      }
                    </div>
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
    <ul class="legend" aria-label="دليل المصفوفة">
      <li>☑ انتقال مسموح · [قواعد] لإضافة شروط للانتقال</li>
      <li><span class="rule has">قواعد</span> توجد شروط (صلاحية، مكلَّف، موافقة، اعتماديات)</li>
      <li>— الحالة نفسها (غير مسموح)</li>
    </ul>
  `,
  styles: `
    .cell { display: inline-flex; align-items: center; gap: 6px; }
    .rule { min-block-size: 28px; padding: 1px 10px; border: 1px solid var(--c-border-strong); border-radius: var(--r-pill); background: var(--c-surface); font-size: var(--fs-xs); cursor: pointer; }
    .rule.has { border-color: var(--c-gold-500); background: var(--c-gold-100); color: var(--c-gold-600); font-weight: 700; }
    .legend { margin-block-start: var(--s-3); }
  `,
})
export class TransitionMatrix {
  readonly statuses = input.required<readonly Status[]>();
  readonly transitions = input.required<readonly Transition[]>();
  readonly readonly = input(false);

  readonly toggled = output<TransitionToggle>();
  readonly editRule = output<Transition>();

  protected find(from: string, to: string): Transition | undefined {
    return this.transitions().find((t) => t.fromStatusId === from && t.toStatusId === to);
  }

  protected hasRules(t: Transition): boolean {
    return !!(t.permission || t.requiresAssignee || t.requiresApproval || t.blockedByOpenDependencies);
  }
}

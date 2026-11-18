import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ProgressInfo } from '@domain/projects/project.models';

/** Progress bar per SRS §4.4: a null percent means "no data", never 0%. */
@Component({
  selector: 'app-project-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (progress().percent === null) {
      <span class="muted">لا توجد بيانات</span>
    } @else {
      <div class="wrap">
        <div
          class="progress"
          role="progressbar"
          aria-label="نسبة الإنجاز"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="progress().percent"
        >
          <span [style.width.%]="progress().percent"></span>
        </div>
        <strong>{{ progress().percent }}%</strong>
      </div>
    }
  `,
  styles: `
    .wrap { display: flex; align-items: center; gap: var(--s-2); }
    .progress { flex: 1; min-width: 60px; }
    strong { font-size: var(--fs-sm); min-width: 36px; }
  `,
})
export class ProjectProgress {
  readonly progress = input.required<ProgressInfo>();
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DevIndicator } from '@domain/work-items/work-item.models';
import { Icon } from '@shared/ui/icon/icon';

/** Compact development counters (commits, open PRs, merged PRs). Renders nothing when `dev` is absent. */
@Component({
  selector: 'app-dev-indicator',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dev(); as d) {
      <span class="dev">
        <span class="ind" [attr.aria-label]="'عدد الـ Commits: ' + d.commits" [title]="'عدد الـ Commits: ' + d.commits"><app-icon name="git" [size]="13" />{{ d.commits }}</span>
        <span class="ind info" [attr.aria-label]="'طلبات دمج مفتوحة: ' + d.openPrs" [title]="'طلبات دمج مفتوحة: ' + d.openPrs"><app-icon name="flow" [size]="13" />{{ d.openPrs }}</span>
        <span class="ind ok" [attr.aria-label]="'طلبات دمج مدموجة: ' + d.mergedPrs" [title]="'طلبات دمج مدموجة: ' + d.mergedPrs"><app-icon name="checkCircle" [size]="13" />{{ d.mergedPrs }}</span>
      </span>
    }
  `,
  styles: `
    .dev { display: inline-flex; gap: var(--s-2); font-size: var(--fs-xs); color: var(--c-muted); }
    .ind { display: inline-flex; align-items: center; gap: 2px; }
    .info { color: var(--c-info); }
    .ok { color: var(--c-success); }
  `,
})
export class DevIndicatorView {
  readonly dev = input<DevIndicator | undefined>();
}

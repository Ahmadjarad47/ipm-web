import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Badge } from '@shared/ui/badge/badge';
import { Icon } from '@shared/ui/icon/icon';
import { ApprovalStatus, APPROVAL_STATUS_LABELS } from '@domain/approvals/approval.models';
import { Priority, PRIORITY_LABELS } from '@domain/work-items/work-item.models';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { BadgeTone } from '@shared/ui/badge/badge';

/** Status pill coloured from the admin-configured status (never hard-coded). */
@Component({
  selector: 'app-status-badge',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-badge [color]="status()?.color ?? 'var(--c-neutral)'" [dot]="true">{{ status()?.name ?? '—' }}</app-badge>`,
})
export class StatusBadge {
  private readonly statuses = inject(StatusLookup);
  readonly statusId = input.required<string>();
  protected readonly status = computed(() => this.statuses.get(this.statusId()));
}

/** Work item type icon + name, from the admin-configured type. */
@Component({
  selector: 'app-type-chip',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--type-color]': 'type()?.color ?? "var(--c-neutral)"', '[attr.title]': 'type()?.name' },
  template: `
    <span class="ico"><app-icon [name]="type()?.icon ?? 'task'" [size]="iconOnly() ? 14 : 13" /></span>
    @if (!iconOnly()) {
      <span class="name">{{ type()?.name ?? '—' }}</span>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); font-weight: 600; color: color-mix(in srgb, var(--type-color) 78%, var(--c-text)); white-space: nowrap; }
    .ico { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: color-mix(in srgb, var(--type-color) 20%, var(--c-surface)); border: 1px solid color-mix(in srgb, var(--type-color) 40%, transparent); }
  `,
})
export class TypeChip {
  private readonly types = inject(WorkItemTypeLookup);
  readonly typeId = input.required<string>();
  readonly iconOnly = input(false);
  protected readonly type = computed(() => this.types.get(this.typeId()));
}

const PRIORITY_TONES: Record<Priority, BadgeTone> = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger-solid' };

@Component({
  selector: 'app-priority-badge',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-badge [tone]="tone()">{{ label() }}</app-badge>`,
})
export class PriorityBadge {
  readonly priority = input.required<Priority>();
  protected readonly tone = computed(() => PRIORITY_TONES[this.priority()]);
  protected readonly label = computed(() => PRIORITY_LABELS[this.priority()]);
}

const APPROVAL_TONES: Record<ApprovalStatus, BadgeTone> = {
  'pending-approval': 'gold',
  approved: 'success',
  rejected: 'danger',
  returned: 'warning',
  superseded: 'neutral',
};

@Component({
  selector: 'app-approval-status',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-badge [tone]="tone()" [dot]="true">{{ label() }}</app-badge>`,
})
export class ApprovalStatusBadge {
  readonly status = input.required<ApprovalStatus>();
  protected readonly tone = computed(() => APPROVAL_TONES[this.status()]);
  protected readonly label = computed(() => APPROVAL_STATUS_LABELS[this.status()]);
}

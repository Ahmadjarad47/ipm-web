import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { map } from 'rxjs';
import { AuditApi } from '@domain/activity/activity.api';
import { AUDIT_ACTION_LABELS, AuditEvent } from '@domain/activity/activity.models';
import { Filters } from '@core/models/entity.model';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Avatar } from '@shared/ui/avatar/avatar';
import { AuditFormatter } from '@shared/util/audit-format';
import { EmptyState } from '@shared/ui/empty-state/empty-state';

/**
 * Change history for one subject or project (FR-PRJ-04, FR-TSK-09, FR-WF-08).
 *   <app-activity-log [projectId]="p.id" />            — everything in a project
 *   <app-activity-log [subjectId]="item.id" />          — one entity
 */
@Component({
  selector: 'app-activity-log',
  imports: [Avatar, EmptyState, AppDatePipe, UserNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="log">
      @for (e of events.value(); track e.id) {
        <li>
          <app-avatar [name]="e.actorId | userName" [size]="28" />
          <div>
            <p><strong>{{ e.actorId | userName }}</strong> {{ label(e) }} <span class="subject">{{ e.subjectLabel }}</span></p>
            @if (e.changes.length) {
              <ul class="changes">
                @for (c of e.changes; track c.field) {
                  <li><span class="muted">{{ format.field(c.field) }}:</span> <del>{{ format.value(c, 'from') }}</del> ← <ins>{{ format.value(c, 'to') }}</ins></li>
                }
              </ul>
            }
            <small class="muted">{{ e.at | appDate: true }}</small>
          </div>
        </li>
      } @empty {
        @if (!events.isLoading()) {
          <app-empty-state icon="history" title="لا يوجد سجل بعد" />
        }
      }
    </ol>
  `,
  styles: `
    .log { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
    .log > li { display: flex; gap: var(--s-3); }
    .subject { font-weight: 600; color: var(--c-emerald-800); }
    .changes { margin: 4px 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
    del { color: var(--c-danger); text-decoration: line-through; }
    ins { color: var(--c-success); text-decoration: none; }
    small { font-size: var(--fs-xs); }
  `,
})
export class ActivityLog {
  private readonly api = inject(AuditApi);
  protected readonly format = inject(AuditFormatter);
  readonly projectId = input<string | null>(null);
  readonly subjectId = input<string | null>(null);
  readonly limit = input(30);

  private readonly filters = computed<Filters<AuditEvent>>(() => ({
    ...(this.projectId() ? { projectId: this.projectId() } : {}),
    ...(this.subjectId() ? { subjectId: this.subjectId() } : {}),
  }));

  protected readonly events = rxResource({
    params: () => ({ filters: this.filters(), limit: this.limit() }),
    stream: ({ params }) => this.api.list({ page: 1, pageSize: params.limit, filters: params.filters }).pipe(map((p) => p.items)),
    defaultValue: [],
  });

  protected label(e: AuditEvent): string {
    return AUDIT_ACTION_LABELS[e.action] ?? e.action;
  }

  reload(): void {
    this.events.reload();
  }
}

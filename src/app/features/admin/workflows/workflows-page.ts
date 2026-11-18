import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { HasUnsavedChanges, warnBeforeUnload } from '../shared/unsaved-changes';
import { StatusesTab } from './statuses-tab';
import { WorkflowDiagramTab } from './workflow-diagram-tab';
import { WorkflowsTab } from './workflows-tab';

type WorkflowTab = 'statuses' | 'workflows' | 'diagram';

@Component({
  selector: 'app-workflows-page',
  imports: [PageHeader, Tabs, StatusesTab, WorkflowsTab, WorkflowDiagramTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onUnload($event)' },
  template: `
    <app-page-header title="الحالات وسير العمل" subtitle="فئات الحالات مستقرة، وأسماؤها وألوانها قابلة للتعديل دون تغيير التقارير." />
    <app-tabs [tabs]="tabs()" [(active)]="tab" />
    <div class="panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
      @if (tab() === 'statuses') {
        <app-statuses-tab />
      }
      <!-- Kept alive (hidden) so an unsaved workflow draft survives a tab switch; the route guard covers leaving the page. -->
      @if (canWorkflows()) {
        <div [hidden]="tab() !== 'workflows'"><app-workflows-tab /></div>
      }
      @if (tab() === 'diagram') {
        <app-workflow-diagram-tab />
      }
    </div>
  `,
  styles: `.panel { padding-top: var(--s-5); }`,
})
export class WorkflowsPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthService);

  protected readonly canWorkflows = computed(() => this.auth.can('workflows.manage'));
  private readonly workflowsTab = viewChild(WorkflowsTab);

  protected readonly tabs = computed<readonly TabItem<WorkflowTab>[]>(() => [
    ...(this.auth.can('statuses.manage') ? [{ key: 'statuses' as const, label: 'الحالات' }] : []),
    ...(this.canWorkflows() ? [{ key: 'workflows' as const, label: 'سير العمل' }] : []),
    { key: 'diagram' as const, label: 'المخطط' },
  ]);

  protected readonly tab = signal<WorkflowTab>(this.auth.can('statuses.manage') ? 'statuses' : 'workflows');

  hasUnsavedChanges(): boolean {
    return this.workflowsTab()?.hasUnsavedChanges() ?? false;
  }

  protected onUnload(event: BeforeUnloadEvent): void {
    warnBeforeUnload(event, this.hasUnsavedChanges());
  }
}

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { RolesTab } from './roles-tab';
import { UsersTab } from './users-tab';

type AccessTab = 'users' | 'roles';

@Component({
  selector: 'app-access-page',
  imports: [PageHeader, Tabs, UsersTab, RolesTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="المستخدمون والأدوار" subtitle="إدارة الحسابات والأدوار وصلاحيات كل دور." />
    <app-tabs [tabs]="tabs" [(active)]="tab" />
    <div class="panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
      @switch (tab()) {
        @case ('users') {
          <app-users-tab />
        }
        @case ('roles') {
          <app-roles-tab />
        }
      }
    </div>
  `,
  styles: `.panel { padding-top: var(--s-5); }`,
})
export class AccessPage {
  protected readonly tabs: readonly TabItem<AccessTab>[] = [
    { key: 'users', label: 'المستخدمون' },
    { key: 'roles', label: 'الأدوار' },
  ];
  protected readonly tab = signal<AccessTab>('users');
}

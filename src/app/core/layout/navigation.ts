import { PermissionKey } from '@core/auth/permissions';

export interface NavItem {
  readonly label: string;
  readonly icon: string;
  readonly link: string;
  /** Shown when the user holds any of these in any scope. Empty = always. */
  readonly permissions: readonly PermissionKey[];
  readonly exact?: boolean;
}

export interface NavSection {
  readonly title?: string;
  readonly items: readonly NavItem[];
}

/** Single source of truth for the sidebar; routes declare the same permissions in `data`. */
export const NAVIGATION: readonly NavSection[] = [
  {
    items: [
      { label: 'لوحة القيادة', icon: 'dashboard', link: '/dashboard', permissions: ['dashboard.view'], exact: true },
      { label: 'المشاريع', icon: 'folder', link: '/projects', permissions: ['projects.view'] },
      { label: 'الأعمال', icon: 'list', link: '/work-items', permissions: ['tasks.view'] },
      { label: 'مركز الموافقات', icon: 'approval', link: '/approvals', permissions: ['approvals.view', 'approvals.decide'] },
      { label: 'التقارير والخط الزمني', icon: 'calendar', link: '/reports', permissions: ['reports.view'] },
    ],
  },
  {
    title: 'الإدارة',
    items: [
      { label: 'أنواع الأعمال', icon: 'layers', link: '/admin/types', permissions: ['workitem.types.manage'] },
      { label: 'الحالات وسير العمل', icon: 'flow', link: '/admin/workflows', permissions: ['statuses.manage', 'workflows.manage'] },
      { label: 'قوالب الموافقات', icon: 'checkCircle', link: '/admin/approval-templates', permissions: ['approvals.configure'] },
      { label: 'المستخدمون والأدوار', icon: 'shield', link: '/admin/access', permissions: ['roles.manage'] },
      { label: 'قوالب المشاريع', icon: 'folder', link: '/admin/project-templates', permissions: ['settings.manage'] },
      { label: 'إعدادات النظام', icon: 'settings', link: '/admin/settings', permissions: ['settings.manage'] },
      { label: 'تكامل Git', icon: 'git', link: '/admin/git', permissions: ['git.manage', 'git.view'] },
      { label: 'سجل التدقيق', icon: 'history', link: '/audit', permissions: ['audit.view'] },
    ],
  },
];

import { Routes } from '@angular/router';
import { permissionGuard, ROUTE_PERMISSIONS } from '@core/auth/auth.guards';
import { ROUTE_CRUMBS } from '@core/layout/route-crumbs';
import { unsavedChangesGuard } from './shared/unsaved-changes';

/** Full breadcrumb trail (home + section + page); the last crumb is the current page and has no link. */
const crumbs = (page: string) => ({
  [ROUTE_CRUMBS]: [{ label: 'الرئيسية', link: '/dashboard' }, { label: 'الإدارة', link: '/admin' }, { label: page }],
});

export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'types' },
  {
    path: 'types',
    title: 'أنواع الأعمال',
    canActivate: [permissionGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { [ROUTE_PERMISSIONS]: ['workitem.types.manage'], ...crumbs('أنواع الأعمال') },
    loadComponent: () => import('./types/types-page').then((m) => m.TypesPage),
  },
  {
    path: 'workflows',
    title: 'الحالات وسير العمل',
    canActivate: [permissionGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { [ROUTE_PERMISSIONS]: ['statuses.manage', 'workflows.manage'], ...crumbs('الحالات وسير العمل') },
    loadComponent: () => import('./workflows/workflows-page').then((m) => m.WorkflowsPage),
  },
  {
    path: 'approval-templates',
    title: 'قوالب الموافقات',
    canActivate: [permissionGuard],
    data: { [ROUTE_PERMISSIONS]: ['approvals.configure'], ...crumbs('قوالب الموافقات') },
    loadComponent: () => import('./approval-templates/approval-templates-page').then((m) => m.ApprovalTemplatesPage),
  },
  {
    path: 'git',
    title: 'تكامل Git',
    canActivate: [permissionGuard],
    data: { [ROUTE_PERMISSIONS]: ['git.manage', 'git.view'], ...crumbs('تكامل Git') },
    loadComponent: () => import('./git-admin/git-admin-page').then((m) => m.GitAdminPage),
  },
  {
    path: 'access',
    title: 'المستخدمون والأدوار',
    canActivate: [permissionGuard],
    data: { [ROUTE_PERMISSIONS]: ['roles.manage'], ...crumbs('المستخدمون والأدوار') },
    loadComponent: () => import('./access/access-page').then((m) => m.AccessPage),
  },
  {
    path: 'project-templates',
    title: 'قوالب المشاريع',
    canActivate: [permissionGuard],
    data: { [ROUTE_PERMISSIONS]: ['settings.manage'], ...crumbs('قوالب المشاريع') },
    loadComponent: () => import('./project-templates/project-templates-page').then((m) => m.ProjectTemplatesPage),
  },
  {
    path: 'settings',
    title: 'إعدادات النظام',
    canActivate: [permissionGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { [ROUTE_PERMISSIONS]: ['settings.manage'], ...crumbs('إعدادات النظام') },
    loadComponent: () => import('./settings/settings-page').then((m) => m.SettingsPage),
  },
];

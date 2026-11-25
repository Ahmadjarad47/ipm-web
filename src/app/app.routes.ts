import { Routes } from '@angular/router';
import { authGuard, guestGuard, passwordChangeGuard, permissionGuard, ROUTE_PERMISSIONS } from '@core/auth/auth.guards';
import { PermissionKey } from '@core/auth/permissions';
import { ROUTE_CRUMBS } from '@core/layout/route-crumbs';
import { Shell } from '@core/layout/shell';

const needs = (...permissions: PermissionKey[]) => ({ [ROUTE_PERMISSIONS]: permissions });

/**
 * Breadcrumb contract: `data.crumbs` is the FULL trail of a route (see `RouteCrumbs`): the home crumb is added
 * here, the last label is the current page (no link). The deepest route in the active chain that defines it wins,
 * so child route files add e.g. `data: { crumbs: [{ label: 'الرئيسية', link: '/dashboard' }, { label: 'المشاريع',
 * link: '/projects' }, { label: 'تفاصيل المشروع' }] }`; dynamic names can call `RouteCrumbs.set([...])`.
 */
const crumbs = (...trail: readonly (string | { label: string; link: string })[]) => ({
  [ROUTE_CRUMBS]: [
    { label: 'الرئيسية', link: '/dashboard' },
    ...trail.map((c) => (typeof c === 'string' ? { label: c } : c)),
  ],
});

/** Every feature is lazy-loaded and guarded; screens re-check project-scoped permissions themselves. */
export const routes: Routes = [
  {
    path: 'change-password',
    canMatch: [passwordChangeGuard],
    title: 'كلمة المرور',
    loadComponent: () => import('@features/auth/change-password').then((m) => m.ChangePassword),
  },
  {
    path: 'login',
    canMatch: [guestGuard],
    title: 'تسجيل الدخول',
    loadComponent: () => import('@features/auth/login').then((m) => m.Login),
  },
  {
    path: '',
    component: Shell,
    canMatch: [authGuard],
    canActivateChild: [permissionGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'لوحة القيادة',
        data: { ...needs('dashboard.view'), ...crumbs('لوحة القيادة') },
        loadChildren: () => import('@features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        path: 'projects',
        data: { ...needs('projects.view'), ...crumbs('المشاريع') },
        loadChildren: () => import('@features/projects/projects.routes').then((m) => m.PROJECT_ROUTES),
      },
      {
        path: 'work-items',
        data: { ...needs('tasks.view'), ...crumbs('الأعمال') },
        loadChildren: () => import('@features/work-items/work-items.routes').then((m) => m.WORK_ITEM_ROUTES),
      },
      {
        path: 'approvals',
        data: { ...needs('approvals.view', 'approvals.decide'), ...crumbs('مركز الموافقات') },
        loadChildren: () => import('@features/approvals/approvals.routes').then((m) => m.APPROVAL_ROUTES),
      },
      {
        path: 'reports',
        title: 'التقارير والخط الزمني',
        data: { ...needs('reports.view'), ...crumbs('التقارير والخط الزمني') },
        loadChildren: () => import('@features/reports/reports.routes').then((m) => m.REPORT_ROUTES),
      },
      {
        // Children (features/admin/admin.routes.ts) should declare their own `data.crumbs`, e.g.
        // crumbs('الإدارة', 'أنواع الأعمال'); this is the fallback for the whole section.
        path: 'admin',
        data: crumbs('الإدارة'),
        loadChildren: () => import('@features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      {
        path: 'audit',
        title: 'سجل التدقيق',
        data: { ...needs('audit.view'), ...crumbs('سجل التدقيق') },
        loadChildren: () => import('@features/audit/audit.routes').then((m) => m.AUDIT_ROUTES),
      },
      {
        path: 'notifications',
        title: 'الإشعارات',
        data: crumbs('الإشعارات'),
        loadChildren: () => import('@features/notifications/notifications.routes').then((m) => m.NOTIFICATION_ROUTES),
      },
      {
        path: 'profile',
        title: 'الملف الشخصي',
        data: crumbs('الملف الشخصي'),
        loadChildren: () => import('@features/profile/profile.routes').then((m) => m.PROFILE_ROUTES),
      },
      {
        path: 'forbidden',
        title: 'غير مصرّح',
        data: crumbs('غير مصرّح'),
        loadComponent: () => import('@features/errors/error-page').then((m) => m.ForbiddenPage),
      },
      {
        path: 'error',
        title: 'خطأ في الخادم',
        data: crumbs('خطأ'),
        loadComponent: () => import('@features/errors/error-page').then((m) => m.ServerErrorPage),
      },
      {
        path: 'offline',
        title: 'لا يوجد اتصال',
        data: crumbs('غير متصل'),
        loadComponent: () => import('@features/errors/error-page').then((m) => m.OfflinePage),
      },
      {
        path: '**',
        title: 'الصفحة غير موجودة',
        data: crumbs('الصفحة غير موجودة'),
        loadComponent: () => import('@features/errors/error-page').then((m) => m.NotFoundPage),
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];

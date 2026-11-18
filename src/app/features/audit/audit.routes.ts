import { Routes } from '@angular/router';
import { ROUTE_CRUMBS } from '@core/layout/route-crumbs';

export const AUDIT_ROUTES: Routes = [
  {
    path: '',
    data: { [ROUTE_CRUMBS]: [{ label: 'الرئيسية', link: '/dashboard' }, { label: 'سجل التدقيق' }] },
    loadComponent: () => import('./audit-page').then((m) => m.AuditPage),
  },
];

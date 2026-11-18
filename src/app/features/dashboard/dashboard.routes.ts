import { Routes } from '@angular/router';
import { ROUTE_CRUMBS } from '@core/layout/route-crumbs';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    title: 'لوحة القيادة',
    data: { [ROUTE_CRUMBS]: [{ label: 'الرئيسية', link: '/dashboard' }, { label: 'لوحة القيادة' }] },
    loadComponent: () => import('./dashboard-page').then((m) => m.DashboardPage),
  },
];

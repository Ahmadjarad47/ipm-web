import { Routes } from '@angular/router';
import { ROUTE_CRUMBS } from '@core/layout/route-crumbs';

export const REPORT_ROUTES: Routes = [
  {
    path: '',
    data: { [ROUTE_CRUMBS]: [{ label: 'الرئيسية', link: '/dashboard' }, { label: 'التقارير' }] },
    loadComponent: () => import('./reports-page').then((m) => m.ReportsPage),
  },
];

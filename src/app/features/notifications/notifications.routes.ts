import { Routes } from '@angular/router';
import { ROUTE_CRUMBS } from '@core/layout/route-crumbs';

export const NOTIFICATION_ROUTES: Routes = [
  {
    path: '',
    title: 'الإشعارات',
    data: { [ROUTE_CRUMBS]: [{ label: 'الرئيسية', link: '/dashboard' }, { label: 'الإشعارات' }] },
    loadComponent: () => import('./notifications-page').then((m) => m.NotificationsPage),
  },
];

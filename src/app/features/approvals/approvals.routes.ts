import { Routes } from '@angular/router';

const CENTRE = { label: 'مركز الموافقات', link: '/approvals' };

export const APPROVAL_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./approvals-page').then((m) => m.ApprovalsPage) },
  {
    path: 'delegations',
    title: 'تفويضاتي',
    data: { crumbs: [{ label: 'الرئيسية', link: '/dashboard' }, CENTRE, { label: 'تفويضاتي' }] },
    loadComponent: () => import('./delegations-page').then((m) => m.DelegationsPage),
  },
  {
    path: ':id',
    data: { crumbs: [{ label: 'الرئيسية', link: '/dashboard' }, CENTRE, { label: 'تفاصيل الطلب' }] },
    loadComponent: () => import('./approval-detail').then((m) => m.ApprovalDetail),
  },
];

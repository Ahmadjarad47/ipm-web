import { Routes } from '@angular/router';

const HOME = { label: 'الرئيسية', link: '/dashboard' };

export const WORK_ITEM_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./work-items-page').then((m) => m.WorkItemsPage),
    data: { crumbs: [HOME, { label: 'عناصر العمل' }] },
  },
  {
    // The detail page renders its own trail (project and ref) in its page header.
    path: ':id',
    loadComponent: () => import('./work-item-detail').then((m) => m.WorkItemDetail),
    data: { crumbs: [HOME, { label: 'عناصر العمل', link: '/work-items' }, { label: 'عنصر عمل' }] },
  },
];

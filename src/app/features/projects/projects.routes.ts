import { Routes } from '@angular/router';

const HOME = { label: 'الرئيسية', link: '/dashboard' };

/** `data.crumbs` is the full trail (see RouteCrumbs); the detail page refines the last label once the project loads. */
export const PROJECT_ROUTES: Routes = [
  {
    path: '',
    title: 'المشاريع',
    data: { crumbs: [HOME, { label: 'المشاريع' }] },
    loadComponent: () => import('./projects-page').then((m) => m.ProjectsPage),
  },
  {
    path: ':id',
    title: 'تفاصيل المشروع',
    data: { crumbs: [HOME, { label: 'المشاريع', link: '/projects' }, { label: 'تفاصيل المشروع' }] },
    loadComponent: () => import('./project-detail/project-detail').then((m) => m.ProjectDetail),
  },
];

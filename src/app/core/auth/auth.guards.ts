import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { PermissionKey } from './permissions';

/** Route data key: the permissions a route needs (any one of them). */
export const ROUTE_PERMISSIONS = 'permissions';

export const authGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() || inject(Router).createUrlTree(['/login']);
};

export const guestGuard: CanMatchFn = () => {
  return !inject(AuthService).isAuthenticated() || inject(Router).createUrlTree(['/']);
};

/**
 * Blocks direct links to screens the user has no grant for (FR-AUTH-04).
 * Uses `data.permissions`; project-scoped checks happen again inside the screen.
 */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const required = (route.data[ROUTE_PERMISSIONS] ?? []) as readonly PermissionKey[];
  if (!required.length || required.some((p) => auth.canSomewhere(p))) return true;
  return inject(Router).createUrlTree(['/forbidden']);
};

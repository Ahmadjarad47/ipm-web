import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { LookupRegistry } from '@core/state/lookup-registry';
import { AuthService } from '@core/auth/auth.service';
import { ApiError, ApiErrorCode } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { readProblem } from './problem';

export const CORRELATION_HEADER = 'X-Correlation-Id';

/** Calls that must never trigger a silent refresh or a forced logout of their own. */
const AUTH_PATH = /\/auth\/(login|logout|refresh)$/;

/** Tags every request so client errors can be matched with server logs (NFR-11). */
export const correlationIdInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { [CORRELATION_HEADER]: crypto.randomUUID() } }));

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  // An explicit Authorization header (used while a session is being built) wins.
  return next(token && !req.headers.has('Authorization') ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

/**
 * Any successful write tells the lookup cache which resource changed (`/projects/p1/members` → `projects`), so every screen that
 * reads from a lookup shows the change without a reload. Sign-in calls and reads are not writes.
 */
export const invalidationInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || AUTH_PATH.test(req.url)) return next(req);
  const registry = inject(LookupRegistry);
  const base = inject(API_BASE_URL);
  const resource = req.url.startsWith(base) ? req.url.slice(base.length).split('/').find((part) => part.length > 0) : undefined;
  return next(req).pipe(
    tap((event) => {
      if (resource && event instanceof HttpResponse && event.ok) registry.invalidate(resource);
    }),
  );
};

/**
 * One silent refresh and one retry when the access token expired (401). The refresh token travels as an HttpOnly cookie,
 * so no secret is ever kept in script-reachable storage. Sits next to the server, below `errorInterceptor`, so a
 * failed refresh is what that interceptor turns into a logout.
 */
export const refreshInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  if (AUTH_PATH.test(req.url)) return next(req);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !auth.isAuthenticated()) return throwError(() => error);
      return auth.refresh().pipe(
        switchMap((token) => (token ? next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })) : throwError(() => error))),
      );
    }),
  );
};

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  429: 'rate_limited',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'conflict', // stale If-Match: someone else saved first
  422: 'rule_violation',
};

const FALLBACK_MESSAGE: Record<ApiErrorCode, string> = {
  network: 'تعذّر الاتصال بالخادم. تحقّق من الشبكة وأعد المحاولة.',
  validation: 'البيانات المُدخلة غير صالحة.',
  unauthorized: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا.',
  session_expired: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا.',
  account_disabled: 'تم تعطيل حسابك. تواصل مع مدير النظام.',
  rate_limited: 'محاولات كثيرة. حاول لاحقًا.',
  forbidden: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  not_found: 'العمل غير موجود أو لا تملك صلاحية الاطلاع عليه.',
  conflict: 'عدّل مستخدم آخر هذا السجل. أعد التحميل ثم حاول مجددًا.',
  rule_violation: 'الإجراء يخالف قواعد سير العمل.',
  server: 'حدث خطأ غير متوقع. يرجى المحاولة لاحقًا.',
};

/**
 * Maps every failure to `ApiError`, ends the session on 401 and shows a toast.
 * Callers that render the error inline can skip the toast with header `X-Silent-Error: 1`.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const silent = req.headers.has('X-Silent-Error');
  const outgoing = silent ? req.clone({ headers: req.headers.delete('X-Silent-Error') }) : req;
  return next(outgoing).pipe(
    catchError((res: unknown) => {
      if (!(res instanceof HttpErrorResponse)) return throwError(() => res);
      const problem = readProblem(res.error);
      const code: ApiErrorCode = CODE_BY_STATUS[res.status] ?? 'server';
      const error: ApiError = {
        status: res.status,
        code,
        // Server messages are shown only for business-rule errors; never raw server internals.
        message: code === 'server' ? FALLBACK_MESSAGE.server : (problem.message ?? FALLBACK_MESSAGE[code]),
        correlationId: req.headers.get(CORRELATION_HEADER) ?? undefined,
        details: problem.details,
      };
      const authCall = AUTH_PATH.test(req.url);
      // A 401 that survived the silent refresh means the session is over.
      if (code === 'unauthorized' && !authCall) auth.logout(true, { code: 'session_expired', message: FALLBACK_MESSAGE.session_expired });
      if (!silent && !(code === 'unauthorized' && !authCall)) toast.error(error.message);
      return throwError(() => error);
    }),
  );
};

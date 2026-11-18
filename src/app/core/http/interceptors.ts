import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ApiError, ApiErrorCode } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';

export const CORRELATION_HEADER = 'X-Correlation-Id';

/** Tags every request so client errors can be matched with server logs (NFR-11). */
export const correlationIdInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { [CORRELATION_HEADER]: crypto.randomUUID() } }));

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  0: 'network',
  400: 'validation',
  401: 'unauthorized',
  429: 'rate_limited',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
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
  not_found: 'العنصر غير موجود أو لا تملك صلاحية الاطلاع عليه.',
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

      const body = (res.error ?? {}) as Partial<ApiError>;
      const bodyCode = (res.error as { code?: string } | null)?.code;
      // 401 bodies say why the session ended (FR-AUTH-06); everything else maps by status.
      const code: ApiErrorCode =
        res.status === 401 && (bodyCode === 'session_expired' || bodyCode === 'account_disabled')
          ? bodyCode
          : (CODE_BY_STATUS[res.status] ?? 'server');
      const error: ApiError = {
        status: res.status,
        code,
        // Server messages are shown only for business-rule errors; never raw server internals.
        message: code === 'server' ? FALLBACK_MESSAGE.server : (body.message ?? FALLBACK_MESSAGE[code]),
        correlationId: req.headers.get(CORRELATION_HEADER) ?? undefined,
        details: body.details,
      };

      const forced = code === 'session_expired' || code === 'account_disabled';
      const authCall = req.url.endsWith('/auth/login') || req.url.endsWith('/auth/logout');
      if (forced && !authCall) auth.logout(true, { code, message: error.message });
      else if (code === 'unauthorized' && !authCall) auth.logout();
      // The login screen explains a forced logout, so no toast on top of it.
      if (!silent && !(forced && !authCall)) toast.error(error.message);
      return throwError(() => error);
    }),
  );
};

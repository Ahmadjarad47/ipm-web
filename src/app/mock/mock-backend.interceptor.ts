import { HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, defer, delay, dematerialize, from, map, materialize, Observable, throwError } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { environment } from '@env/environment';
import { MockHttpError } from './db/collection';
import { MockDatabase } from './db/database';
import { registerActivityHandlers } from './server/handlers/activity.handlers';
import { registerApprovalHandlers } from './server/handlers/approvals.handlers';
import { registerAttachmentHandlers } from './server/handlers/attachments.handlers';
import { registerAuthUserHandlers } from './server/handlers/auth-users.handlers';
import { registerConfigHandlers } from './server/handlers/config.handlers';
import { registerExtraHandlers } from './server/handlers/extras.handlers';
import { registerGitHandlers } from './server/handlers/git.handlers';
import { registerProjectHandlers } from './server/handlers/projects.handlers';
import { registerWorkItemHandlers } from './server/handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './server/router';

// One in-memory database per browser tab; resets on reload.
const db = new MockDatabase();
db.strictVersions = true; // over HTTP, writes must carry the version they were read at (FR-REL-13)
const router = new MockRouter();
registerAuthUserHandlers(router, db);
registerConfigHandlers(router, db);
registerProjectHandlers(router, db);
registerWorkItemHandlers(router, db);
registerApprovalHandlers(router, db);
registerActivityHandlers(router, db);
registerAttachmentHandlers(router, db);
registerExtraHandlers(router, db);
registerGitHandlers(router, db);

const VERSIONED_POST = /^(projects|work-items)\/[^/]+\/(transition|parent|members|archive|unarchive)$/;

/** True for writes that must carry a numeric `version` when strict versions are on. */
function needsVersion(method: string, path: string): boolean {
  if (method === 'PATCH') return !/^notifications\/[^/]+$/.test(path);
  return method === 'POST' && VERSIONED_POST.test(path);
}

/** Deep-clone JSON-like results so callers can never mutate the "database"; binary bodies pass through. */
function toBody(result: unknown): unknown {
  if (result === undefined) return null;
  if (result instanceof Blob) return result;
  return structuredClone(result);
}

function toHttpError(req: HttpRequest<unknown>, err: unknown): HttpErrorResponse {
  const e = err instanceof MockHttpError ? err : new MockHttpError(500, 'Internal error');
  if (!(err instanceof MockHttpError)) console.error('[mock-backend]', err);
  return new HttpErrorResponse({ status: e.status, url: req.url, error: { message: e.message, details: e.details, code: e.code } });
}

/**
 * Answers `/api/v1/*` requests in-process so the app runs without a backend.
 * It enforces the same rules the real API must (auth, default-deny permissions, workflow,
 * approvals, file policy), so the UI is exercised against realistic 401/403/404/409/422 responses.
 * Remove it from `app.config.ts` (or set `useMockBackend: false`) to call a real server.
 */
export const mockBackendInterceptor: HttpInterceptorFn = (req, next) => {
  const base = inject(API_BASE_URL);
  if (!req.url.startsWith(base)) return next(req);

  const path = req.url.slice(base.length).replace(/^\/|\/$/g, '').split('?')[0];
  const match = router.match(req.method as Method, path);
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? null;
  const resolved = db.resolveSession(token);
  const userId = 'userId' in resolved ? resolved.userId : null;
  // Webhooks are server-to-server; everything else comes from the web client.
  const source = path.startsWith('webhooks/') ? 'webhook' : 'ui';
  const correlationId = req.headers.get('X-Correlation-Id') ?? undefined;

  // Handlers may be sync or async (e.g. scanning an uploaded file); both are normalised here.
  const response$: Observable<HttpResponse<unknown>> = defer(() => {
    if (!match) throw new MockHttpError(404, `No mock route for ${req.method} ${path}`);
    if (!match.route.isPublic && !userId) {
      // FR-AUTH-06: the client learns *why* the session ended so it can say so on the login screen.
      if ('error' in resolved && resolved.error === 'account_disabled') throw new MockHttpError(401, 'تم تعطيل حسابك. تواصل مع مدير النظام.', undefined, 'account_disabled');
      throw new MockHttpError(401, 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا.', undefined, 'session_expired');
    }
    if (db.strictVersions && needsVersion(req.method, path)) {
      const version = (req.body as { version?: unknown } | null)?.version;
      if (typeof version !== 'number' || !Number.isInteger(version)) throw new MockHttpError(428, 'أرسل رقم الإصدار للتحديث الآمن.', { version: 'مطلوب' });
    }
    const clientId = req.headers.get('X-Client-Id') ?? undefined;
    const ctx = new MockContext(db, userId, { source, correlationId, clientId });
    const result = match.route.handler({ method: req.method as Method, path, params: match.params, query: req.params, body: req.body, headers: req.headers }, ctx);
    return from(Promise.resolve(result));
  }).pipe(
    map((result) => new HttpResponse({ status: 200, body: toBody(result) })),
    catchError((err: unknown) => throwError(() => toHttpError(req, err))),
  );

  // materialize/dematerialize so errors are delayed too, like a real network.
  return response$.pipe(materialize(), delay(environment.mockLatencyMs), dematerialize());
};

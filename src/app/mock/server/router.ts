import { HttpHeaders, HttpParams } from '@angular/common/http';
import { PermissionKey } from '@core/auth/permissions';
import { CollectionQuery, MockHttpError } from '../db/collection';
import { MockDatabase, RequestOrigin } from '../db/database';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface MockRequest {
  readonly method: Method;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: HttpParams;
  readonly body: unknown;
  /** Optional so in-process dispatch and tests can omit it. */
  readonly headers?: HttpHeaders;
}

/** Per-request context: the database, the caller and permission helpers. */
export class MockContext {
  readonly source: RequestOrigin['source'];
  readonly correlationId: string;
  /** Opaque per-client identifier (X-Client-Id), used to scope abuse counters such as login lockout. */
  readonly clientId: string | null;

  constructor(
    readonly db: MockDatabase,
    readonly userId: string | null,
    origin: Partial<RequestOrigin> & { clientId?: string } = {},
  ) {
    this.clientId = origin.clientId ? origin.clientId.slice(0, 64) : null;
    this.source = origin.source ?? 'ui';
    this.correlationId = origin.correlationId ?? db.nextCorrelationId();
    this.bind();
  }

  /** Makes this request the origin stamped on audit events (call again after an `await`). */
  bind(): void {
    this.db.origin = { source: this.source, correlationId: this.correlationId };
  }

  get me(): string {
    if (!this.userId) throw new MockHttpError(401, 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا.');
    return this.userId;
  }

  /** Throws 403 unless the caller holds `permission` (system-wide or in `projectId`). */
  require(permission: PermissionKey, projectId?: string | null): void {
    if (!this.db.can(this.me, permission, projectId)) {
      this.db.logPermissionDenied(this.me, permission, projectId);
      throw new MockHttpError(403, 'لا تملك صلاحية تنفيذ هذا الإجراء.');
    }
  }

  can(permission: PermissionKey, projectId?: string | null): boolean {
    return !!this.userId && this.db.can(this.userId, permission, projectId);
  }

  /** 404 (not 403) for unseen projects so the existence of a record is not leaked (AT-01). */
  requireProjectVisible(projectId: string): void {
    if (!this.db.canSeeProject(this.me, projectId)) {
      throw new MockHttpError(404, 'العنصر غير موجود أو لا تملك صلاحية الاطلاع عليه.');
    }
  }
}

export type Handler = (req: MockRequest, ctx: MockContext) => unknown;

interface Route {
  readonly method: Method;
  readonly pattern: RegExp;
  readonly keys: readonly string[];
  readonly handler: Handler;
  readonly isPublic: boolean;
}

/** Tiny path router: `router.get('projects/:id', handler)`. */
export class MockRouter {
  private readonly routes: Route[] = [];

  get(path: string, handler: Handler, isPublic = false): this {
    return this.add('GET', path, handler, isPublic);
  }

  post(path: string, handler: Handler, isPublic = false): this {
    return this.add('POST', path, handler, isPublic);
  }

  put(path: string, handler: Handler): this {
    return this.add('PUT', path, handler, false);
  }

  patch(path: string, handler: Handler): this {
    return this.add('PATCH', path, handler, false);
  }

  delete(path: string, handler: Handler): this {
    return this.add('DELETE', path, handler, false);
  }

  match(method: Method, path: string): { route: Route; params: Record<string, string> } | null {
    // Static segments beat `:param` segments (e.g. `approval-templates/match` over `approval-templates/:id`),
    // regardless of registration order; ties go to the first registered.
    let best: { route: Route; m: RegExpExecArray } | null = null;
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (m && (!best || route.keys.length < best.route.keys.length)) best = { route, m };
    }
    if (!best) return null;
    const params: Record<string, string> = {};
    best.route.keys.forEach((key, i) => (params[key] = decodeURIComponent(best.m[i + 1])));
    return { route: best.route, params };
  }

  private add(method: Method, path: string, handler: Handler, isPublic: boolean): this {
    const keys: string[] = [];
    const source = path.replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, isPublic });
    return this;
  }
}

/** Parses the generic list contract produced by `toHttpParams`. */
export function parseListQuery(params: HttpParams): CollectionQuery {
  const filters: Record<string, string[]> = {};
  for (const key of params.keys()) {
    if (key.startsWith('filter.')) filters[key.slice(7)] = (params.get(key) ?? '').split(',').filter(Boolean);
  }
  const [field, direction] = (params.get('sort') ?? '').split(':');
  return {
    page: Math.max(1, Number(params.get('page') ?? 1)),
    pageSize: Math.min(100, Math.max(1, Number(params.get('pageSize') ?? 10))),
    search: params.get('search') ?? undefined,
    sort: field ? { field, direction: direction === 'desc' ? 'desc' : 'asc' } : undefined,
    filters,
  };
}

export function body<T>(req: MockRequest): T {
  return (req.body ?? {}) as T;
}

export function fail(status: number, message: string, details?: Record<string, string>): never {
  throw new MockHttpError(status, message, details);
}

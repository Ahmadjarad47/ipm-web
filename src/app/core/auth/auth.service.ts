import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { AuthSession, LoginRequest, LogoutReason } from './auth.models';
import { PermissionKey } from './permissions';

const STORAGE_KEY = 'ipm.session';

/**
 * Holds the session and answers "can the user do X (in project P)?".
 *
 * UI checks are a convenience only — the server re-checks every request (FR-AUTH-03).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly baseUrl = inject(API_BASE_URL);

  private readonly _session = signal<AuthSession | null>(this.restore());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _lastLogoutReason = signal<LogoutReason | null>(null);
  /** Set when the server (or the expiry timer) ended the session; cleared on the next successful login. */
  readonly lastLogoutReason = this._lastLogoutReason.asReadonly();

  readonly session = this._session.asReadonly();
  readonly user = computed(() => this._session()?.user ?? null);
  /** Expired sessions are cleared by a timer (see `store`), so this stays accurate without polling the clock. */
  readonly isAuthenticated = computed(() => {
    const session = this._session();
    return !!session && new Date(session.expiresAt).getTime() > Date.now();
  });
  readonly token = computed(() => this._session()?.token ?? null);

  private readonly systemGrants = computed(() => new Set(this._session()?.systemPermissions ?? []));
  private readonly denied = computed(() => new Set(this._session()?.denied ?? []));

  constructor() {
    this.scheduleExpiry(this._session());
  }

  login(request: LoginRequest): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${this.baseUrl}/auth/login`, request)
      .pipe(tap((session) => {
        this._lastLogoutReason.set(null);
        this.store(session);
      }));
  }

  /**
   * Re-reads the caller's effective grants. Call after anything that changes them server-side
   * (creating a project, membership or role changes) — grants are otherwise a login-time snapshot.
   */
  refreshSession(): Observable<AuthSession> {
    return this.http.get<AuthSession>(`${this.baseUrl}/auth/me`).pipe(tap((session) => this.store(session)));
  }

  /**
   * Ends the session. A user-initiated logout tells the server (best effort, so the token is revoked);
   * a forced one passes the `reason` the server gave and does not call back.
   */
  logout(redirect = true, reason?: LogoutReason): void {
    const token = this.token();
    this._lastLogoutReason.set(reason ?? null);
    this.store(null);
    if (token && !reason) {
      this.http
        .post(`${this.baseUrl}/auth/logout`, {}, { headers: { Authorization: `Bearer ${token}`, 'X-Silent-Error': '1' } })
        .subscribe({ error: () => undefined });
    }
    if (redirect) void this.router.navigate(['/login']);
  }

  /**
   * Default deny: true only when granted system-wide or inside `projectId`, and never explicitly denied.
   * A grant in one project never leaks into another (AT-11).
   */
  can(permission: PermissionKey, projectId?: string | null): boolean {
    if (!this.isAuthenticated() || this.denied().has(permission)) return false;
    if (this.systemGrants().has(permission)) return true;
    if (!projectId) return false;
    return this._session()?.projectPermissions[projectId]?.includes(permission) ?? false;
  }

  canAny(permissions: readonly PermissionKey[], projectId?: string | null): boolean {
    return permissions.some((p) => this.can(p, projectId));
  }

  /** True when the user holds the key in at least one scope (used for navigation visibility). */
  canSomewhere(permission: PermissionKey): boolean {
    if (this.can(permission)) return true;
    const perProject = this._session()?.projectPermissions ?? {};
    return !this.denied().has(permission) && Object.values(perProject).some((keys) => keys.includes(permission));
  }

  private scheduleExpiry(session: AuthSession | null): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!session) return;
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    // setTimeout overflows beyond ~24.8 days; sessions are hours long.
    this.expiryTimer = setTimeout(() => this.logout(true, { code: 'session_expired', message: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا.' }), Math.max(0, Math.min(ms, 2_147_000_000)));
  }

  private store(session: AuthSession | null): void {
    this._session.set(session);
    this.scheduleExpiry(session);
    try {
      if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable (private mode) — session stays in memory */
    }
  }

  private restore(): AuthSession | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  }
}

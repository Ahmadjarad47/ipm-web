import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, firstValueFrom, map, Observable, of, shareReplay, switchMap, tap } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { AuthSession, LoginRequest, LogoutReason, SessionUser } from './auth.models';
import { PermissionKey } from './permissions';

/** What `POST /auth/login` and `POST /auth/refresh` answer: the short-lived access token (the refresh token is an HttpOnly cookie). */
interface TokenResponse {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly mustChangePassword: boolean;
}

/** What `GET /auth/me` answers: who the caller is and the effective grants. */
interface MeResponse {
  readonly user: SessionUser;
  readonly systemPermissions: readonly PermissionKey[];
  readonly projectPermissions: Readonly<Record<string, readonly PermissionKey[]>>;
  readonly denied: readonly PermissionKey[];
}

/** The access token is renewed this long before it expires. */
const RENEW_AHEAD_MS = 60_000;
/** A tab shown again re-reads the grants if the last read is older than this. */
const RECHECK_AFTER_MS = 30_000;
const SILENT = { 'X-Silent-Error': '1' };

/**
 * Holds the session and answers "can the user do X (in project P)?".
 *
 * The access token lives in memory only. The refresh token is an HttpOnly cookie the server sets, so reloading the page
 * brings the session back through `initialize()` without any secret in script-reachable storage.
 * UI checks are a convenience only — the server re-checks every request (FR-AUTH-03).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly _session = signal<AuthSession | null>(null);
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Observable<string | null> | null = null;
  private readonly _lastLogoutReason = signal<LogoutReason | null>(null);

  /** Set when the server (or the renewal) ended the session; cleared on the next successful login. */
  readonly lastLogoutReason = this._lastLogoutReason.asReadonly();
  readonly session = this._session.asReadonly();
  readonly user = computed(() => this._session()?.user ?? null);
  /** A session exists; its token is renewed in the background, and a failed renewal ends it. */
  readonly isAuthenticated = computed(() => !!this._session());
  readonly token = computed(() => this._session()?.token ?? null);
  /** The first password was set by an administrator: the user must choose their own before anything else. */
  readonly mustChangePassword = computed(() => this._session()?.mustChangePassword ?? false);
  private readonly systemGrants = computed(() => new Set(this._session()?.systemPermissions ?? []));
  private readonly denied = computed(() => new Set(this._session()?.denied ?? []));

  constructor() {
    // Grants are a snapshot of the last sign-in or renewal: re-read them when the tab comes back, so a role or permission an
    // administrator changed meanwhile shows up without signing out and in again.
    let lastRead = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.isAuthenticated() || Date.now() - lastRead < RECHECK_AFTER_MS) return;
      lastRead = Date.now();
      this.refreshSession().subscribe({ error: () => undefined });
    });
  }

  /** Runs once at start-up: brings back the session of a returning user, quietly. */
  initialize(): Promise<void> {
    return firstValueFrom(this.refresh().pipe(map(() => undefined)));
  }

  login(request: LoginRequest): Observable<AuthSession> {
    return this.http.post<TokenResponse>(`${this.baseUrl}/auth/login`, request).pipe(
      switchMap((tokens) => this.buildSession(tokens)),
      tap((session) => {
        this._lastLogoutReason.set(null);
        this.establish(session);
      }),
    );
  }

  /**
   * Gets a fresh access token with the refresh cookie (one call at a time, shared by everyone waiting).
   * Emits the new token, or null when there is no valid refresh token — in which case the session is over.
   */
  refresh(): Observable<string | null> {
    this.inflight ??= this.http.post<TokenResponse>(`${this.baseUrl}/auth/refresh`, {}, { headers: SILENT }).pipe(
      switchMap((tokens) => this.buildSession(tokens)),
      tap((session) => this.establish(session)),
      map((session) => session.token),
      catchError(() => {
        this.establish(null);
        return of(null);
      }),
      finalize(() => (this.inflight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.inflight;
  }

  /**
   * Re-reads the caller's effective grants. Call after anything that changes them server-side
   * (creating a project, membership or role changes) — grants are otherwise a snapshot of the last sign-in or renewal.
   */
  refreshSession(): Observable<AuthSession> {
    return this.http.get<MeResponse>(`${this.baseUrl}/auth/me`, { headers: SILENT }).pipe(
      map((me) => ({ ...this.requireSession(), ...me })),
      tap((session) => this.establish(session)),
    );
  }

  /** After the user chose their own password: the flag is cleared locally (the server stopped enforcing it). */
  passwordChanged(): void {
    const session = this._session();
    if (session) this.establish({ ...session, mustChangePassword: false });
  }

  /**
   * Ends the session. A user-initiated logout tells the server (best effort, so the refresh token is revoked);
   * a forced one passes the `reason` and does not call back.
   */
  logout(redirect = true, reason?: LogoutReason): void {
    const token = this.token();
    this._lastLogoutReason.set(reason ?? null);
    this.establish(null);
    if (token && !reason) {
      this.http.post(`${this.baseUrl}/auth/logout`, {}, { headers: { Authorization: `Bearer ${token}`, ...SILENT } }).subscribe({ error: () => undefined });
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

  /** Makes `session` the current one (or none) and schedules its renewal. Also the way tests sign a user in. */
  establish(session: AuthSession | null): void {
    this._session.set(session);
    this.scheduleRenewal(session);
  }

  /** The tokens plus who the caller is: what the UI calls a session. The new token is sent explicitly (it is not stored yet). */
  private buildSession(tokens: TokenResponse): Observable<AuthSession> {
    return this.http
      .get<MeResponse>(`${this.baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, ...SILENT } })
      .pipe(map((me) => ({ token: tokens.accessToken, expiresAt: tokens.expiresAt, mustChangePassword: tokens.mustChangePassword, ...me })));
  }

  private requireSession(): AuthSession {
    const session = this._session();
    if (!session) throw new Error('No active session.');
    return session;
  }

  private scheduleRenewal(session: AuthSession | null): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    if (!session) return;
    // setTimeout overflows beyond ~24.8 days; access tokens last minutes.
    const ms = Math.max(0, Math.min(new Date(session.expiresAt).getTime() - Date.now() - RENEW_AHEAD_MS, 2_000_000_000));
    this.renewTimer = setTimeout(() => {
      this.refresh().subscribe((token) => {
        if (!token) this.logout(true, { code: 'session_expired', message: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا.' });
      });
    }, ms);
  }
}

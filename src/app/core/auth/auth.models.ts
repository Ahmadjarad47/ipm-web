import { PermissionKey } from './permissions';

/** Effective grants the server computed for the signed-in user (SRS §2.2). */
export interface AuthSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: SessionUser;
  /** Grants valid everywhere. */
  readonly systemPermissions: readonly PermissionKey[];
  /** Grants valid only inside one project: projectId → keys. Never inferred for other projects. */
  readonly projectPermissions: Readonly<Record<string, readonly PermissionKey[]>>;
  /** Explicit denies always win over grants. */
  readonly denied: readonly PermissionKey[];
}

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly title: string;
}

/** Why the app ended the session on its own (FR-AUTH-06); shown on the login screen. */
export interface LogoutReason {
  readonly code: 'session_expired' | 'account_disabled';
  readonly message: string;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

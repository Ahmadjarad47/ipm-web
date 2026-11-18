/** Normalised error every HTTP failure is mapped to (NFR-11: no server internals leak to the UI). */
export interface ApiError {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly correlationId?: string;
  /** Field-level validation messages, keyed by field name. */
  readonly details?: Readonly<Record<string, string>>;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'session_expired'
  | 'account_disabled'
  | 'rate_limited'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rule_violation'
  | 'network'
  | 'server';

export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'code' in value && 'status' in value;
}

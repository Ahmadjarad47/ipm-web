import { isApiError } from '@core/models/api-error.model';

/** Field-level messages of an `ApiError` (the interceptor already toasts the main message). */
export function errorDetails(error: unknown): readonly string[] {
  return isApiError(error) && error.details ? Object.values(error.details) : [];
}

/** `details` as `[key, message]` pairs (impact conflicts: `[statusName, count]`). */
export function errorEntries(error: unknown): readonly (readonly [string, string])[] {
  return isApiError(error) && error.details ? Object.entries(error.details) : [];
}

/** `details` keyed by field name (empty when the error carries none). */
export function fieldErrors(error: unknown): Readonly<Record<string, string>> {
  return isApiError(error) && error.details ? error.details : {};
}

/** Splits `details` into messages bound to known form controls and the rest (shown as a general list). */
export function splitErrors(
  details: Readonly<Record<string, string>>,
  known: readonly string[],
): { readonly mapped: Readonly<Record<string, string>>; readonly rest: readonly (readonly [string, string])[] } {
  const mapped: Record<string, string> = {};
  const rest: (readonly [string, string])[] = [];
  for (const [key, message] of Object.entries(details)) {
    if (known.includes(key)) mapped[key] = message;
    else rest.push([key, message]);
  }
  return { mapped, rest };
}

/** 422 with a `details` map = business-rule conflicts (`{statusName: count}`, `{projectCode: name}`). */
export function isConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 422 && !!error.details && Object.keys(error.details).length > 0;
}

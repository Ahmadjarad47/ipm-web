/**
 * The error body of the real API is RFC 9457 `application/problem+json`:
 * `{ title, status, detail, code, traceId, errors?: { field: string[] } }`.
 * This reads it (and the older `{ message, details }` shape of the in-app mock) into what the UI shows.
 */
export interface ReadProblem {
  /** Business-rule or validation text written by the server (Arabic), when it sent one. */
  readonly message?: string;
  /** First message per field, keyed by the field path the server used. */
  readonly details?: Readonly<Record<string, string>>;
  /** The server's stable error code, e.g. `Auth.InvalidCredentials`. */
  readonly code?: string;
}

export function readProblem(body: unknown): ReadProblem {
  if (typeof body !== 'object' || body === null) return {};
  const raw = body as Record<string, unknown>;
  const message = typeof raw['detail'] === 'string' ? raw['detail'] : typeof raw['message'] === 'string' ? raw['message'] : undefined;
  const code = typeof raw['code'] === 'string' ? raw['code'] : undefined;
  return { message, code, details: readDetails(raw['errors'] ?? raw['details']) };
}

function readDetails(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(value as Record<string, unknown>)) {
    const first = Array.isArray(messages) ? messages.find((m): m is string => typeof m === 'string') : messages;
    if (typeof first === 'string') result[field] = first;
  }
  return Object.keys(result).length ? result : undefined;
}

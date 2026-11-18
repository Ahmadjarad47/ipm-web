/** Minimal header bag so connectors don't depend on Angular's HttpHeaders. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Demo/simulator switch. The mock backend enables `git/simulate` only while this is true;
 * production builds MUST set it to false (the real server has no simulator and never signs on behalf of a sender).
 */
export const DEMO_MODE = true;

/** Header carrying the delivery time; it is part of the signed material so it cannot be swapped to dodge the replay window. */
export const TIMESTAMP_HEADER = 'X-Delivery-Timestamp';

/** The exact string that is signed: `<timestamp>.<rawBody>`. */
export const signedMaterial = (timestamp: string, raw: string): string => `${timestamp}.${raw}`;

export type GitProvider = 'gitea' | 'github' | 'gitlab';

/**
 * One implementation per Git provider (§7.2): each signs and names its headers differently,
 * so verification, event names and URLs are never handled with a shared shortcut.
 */
export interface GitConnector {
  readonly provider: GitProvider;
  readonly signatureHeader: string;
  readonly eventHeader: string;
  readonly deliveryHeader: string;
  /** Constant-time verification of the delivery (timestamp + body) against the shared secret; a missing timestamp fails. */
  verify(secret: string, raw: string, headers: HeaderReader | undefined): Promise<boolean>;
  /** Provider event name to the internal one (`push` / `pull_request`). */
  normalizeEvent(raw: string): string;
  commitUrl(repoUrl: string, sha: string): string;
  prUrl(repoUrl: string, n: number): string;
  /** Value of the signature header for a timestamped payload (used by the demo simulator and tests). */
  sign(secret: string, raw: string, timestamp: string): Promise<string>;
  /** Provider event name for an internal one (inverse of `normalizeEvent`). */
  providerEvent(event: string): string;
}

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(raw));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison so timing doesn't reveal how much of a forged signature matched. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export const GITEA_CONNECTOR: GitConnector = {
  provider: 'gitea',
  signatureHeader: 'X-Gitea-Signature',
  eventHeader: 'X-Gitea-Event',
  deliveryHeader: 'X-Gitea-Delivery',
  async verify(secret, raw, headers) {
    const value = headers?.get(this.signatureHeader) ?? '';
    const stamp = headers?.get(TIMESTAMP_HEADER) ?? '';
    return !!value && !!stamp && safeEqual(value.replace(/^sha256=/, ''), await hmacSha256Hex(secret, signedMaterial(stamp, raw)));
  },
  normalizeEvent: (raw) => raw,
  providerEvent: (event) => event,
  commitUrl: (repoUrl, sha) => `${trimSlash(repoUrl)}/commit/${sha}`,
  prUrl: (repoUrl, n) => `${trimSlash(repoUrl)}/pulls/${n}`,
  sign: (secret, raw, timestamp) => hmacSha256Hex(secret, signedMaterial(timestamp, raw)),
};

export const GITHUB_CONNECTOR: GitConnector = {
  provider: 'github',
  signatureHeader: 'X-Hub-Signature-256',
  eventHeader: 'X-GitHub-Event',
  deliveryHeader: 'X-GitHub-Delivery',
  async verify(secret, raw, headers) {
    const value = headers?.get(this.signatureHeader) ?? '';
    const stamp = headers?.get(TIMESTAMP_HEADER) ?? '';
    return !!value && !!stamp && safeEqual(value.replace(/^sha256=/, ''), await hmacSha256Hex(secret, signedMaterial(stamp, raw)));
  },
  normalizeEvent: (raw) => raw,
  providerEvent: (event) => event,
  commitUrl: (repoUrl, sha) => `${trimSlash(repoUrl)}/commit/${sha}`,
  prUrl: (repoUrl, n) => `${trimSlash(repoUrl)}/pull/${n}`,
  async sign(secret, raw, timestamp) {
    return `sha256=${await hmacSha256Hex(secret, signedMaterial(timestamp, raw))}`;
  },
};

const GITLAB_EVENTS: Readonly<Record<string, string>> = { 'Push Hook': 'push', 'Merge Request Hook': 'pull_request' };

export const GITLAB_CONNECTOR: GitConnector = {
  provider: 'gitlab',
  signatureHeader: 'X-Gitlab-Token',
  eventHeader: 'X-Gitlab-Event',
  deliveryHeader: 'X-Gitlab-Event-UUID',
  // GitLab sends the shared token itself, not an HMAC; the timestamp is still mandatory (replay window).
  async verify(secret, _raw, headers) {
    const value = headers?.get(this.signatureHeader) ?? '';
    return !!value && !!headers?.get(TIMESTAMP_HEADER) && safeEqual(value, secret);
  },
  normalizeEvent: (raw) => GITLAB_EVENTS[raw] ?? raw,
  providerEvent: (event) => (event === 'push' ? 'Push Hook' : event === 'pull_request' ? 'Merge Request Hook' : event),
  commitUrl: (repoUrl, sha) => `${trimSlash(repoUrl)}/-/commit/${sha}`,
  prUrl: (repoUrl, n) => `${trimSlash(repoUrl)}/-/merge_requests/${n}`,
  async sign(secret) {
    return secret;
  },
};

export const GIT_CONNECTORS: Readonly<Record<GitProvider, GitConnector>> = {
  gitea: GITEA_CONNECTOR,
  github: GITHUB_CONNECTOR,
  gitlab: GITLAB_CONNECTOR,
};

/** Registry lookup; throws for an unsupported provider so nothing falls through to a default. */
export function gitConnector(provider: string): GitConnector {
  const connector = (GIT_CONNECTORS as Record<string, GitConnector | undefined>)[provider];
  if (!connector) throw new Error(`Unsupported Git provider: ${provider}`);
  return connector;
}

import { HttpHeaders } from '@angular/common/http';
import { GitEvent } from '@domain/activity/activity.models';
import { DEMO_MODE, GitConnector, gitConnector, hmacSha256Hex, signedMaterial, TIMESTAMP_HEADER } from '@domain/git/git-connector';
import { SimulateWebhookRequest, WebhookDelivery } from '@domain/git/git.models';
import { defaultRefPattern, extractRefs } from '@domain/git/ref-pattern';
import { Repository, RotatedSecret } from '@domain/projects/project.models';
import { DevIndicator, WorkItem } from '@domain/work-items/work-item.models';
import { MockHttpError } from '../../db/collection';
import { MockDatabase } from '../../db/database';
import { body, fail, MockRouter, parseListQuery } from '../router';
import { summarize } from './projects.handlers';

// ---------- Payload shapes (subset of the Gitea webhook format) ----------

interface PushPayload {
  readonly ref: string;
  readonly commits: readonly { id: string; message: string; url: string; author: { username: string } }[];
}

interface PullRequestPayload {
  readonly action: 'opened' | 'closed' | 'reopened' | 'synchronized' | 'edited';
  readonly pull_request: {
    readonly number: number;
    readonly title: string;
    readonly html_url: string;
    readonly merged: boolean;
    readonly merge_commit_sha: string | null;
    readonly head: { ref: string; sha: string };
    readonly user: { login: string };
  };
}

// ---------- Provider connectors (NFR-05, §7.2) ----------
// Signature check, header and event names, and URL shapes live in `domain/git/git-connector.ts`, one per provider.

/** Replay window: a delivery whose (signed, mandatory) `X-Delivery-Timestamp` is older or later than this is refused. */
const REPLAY_WINDOW_MS = 5 * 60_000;

function connectorFor(provider: string): GitConnector {
  try {
    return gitConnector(provider);
  } catch {
    throw new MockHttpError(400, 'مزوّد Git غير مدعوم.');
  }
}

/** ISO date, epoch seconds or epoch milliseconds; null when unreadable. */
function parseTimestamp(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

// ---------- Linking ----------

/** Refs matching the declared pattern that belong to the repository's project and exist (FR-GIT-03). */
function detectRefs(db: MockDatabase, projectId: string, ...texts: string[]): string[] {
  const project = db.projects.get(projectId);
  let found: string[];
  try {
    found = extractRefs(project.refPattern ?? defaultRefPattern(project.code), ...texts);
  } catch {
    found = extractRefs(defaultRefPattern(project.code), ...texts); // a stored pattern that no longer compiles must not stop ingestion
  }
  const existing = new Set(db.workItems.where((w) => w.projectId === projectId).map((w) => w.ref));
  return found.filter((r) => existing.has(r));
}

export function devIndicator(db: MockDatabase, item: WorkItem): DevIndicator {
  const events = db.gitEvents.where((g) => g.projectId === item.projectId && g.workItemRefs.includes(item.ref));
  return {
    commits: events.filter((e) => e.kind === 'push').length,
    openPrs: events.filter((e) => e.kind === 'pull_request' && e.prState === 'open').length,
    mergedPrs: events.filter((e) => e.prState === 'merged').length,
  };
}

/** Applies a verified payload; returns the refs it linked. Idempotent per commit sha / PR number. */
function processPayload(db: MockDatabase, repo: Repository, projectId: string, event: string, payload: unknown, deliveryId: string): string[] {
  const linked = new Set<string>();
  if (!repo.connected) throw new MockHttpError(422, 'المستودع مفصول؛ لا تُعالج أحداثه.');

  if (event === 'push') {
    const p = payload as PushPayload;
    const branch = p.ref.replace('refs/heads/', '');
    for (const c of p.commits) {
      const sha = c.id.slice(0, 7);
      if (db.gitEvents.where((g) => g.repositoryId === repo.id && g.sha === sha && g.kind === 'push').length) continue;
      const refs = detectRefs(db, projectId, c.message, branch);
      refs.forEach((r) => linked.add(r));
      db.gitEvents.insert({ projectId, repositoryId: repo.id, kind: 'push', title: c.message.split('\n')[0], branch, sha, author: c.author.username, url: c.url, workItemRefs: refs, manualRefs: [], deliveryId });
      db.log('system', 'git.push', { type: 'git', id: repo.id, label: `${repo.name} · ${sha}`, projectId }, refs.length ? [{ field: 'العناصر', from: null, to: refs.join('، ') }] : []);
    }
  } else if (event === 'pull_request') {
    const p = payload as PullRequestPayload;
    const pr = p.pull_request;
    const refs = detectRefs(db, projectId, pr.title, pr.head.ref);
    refs.forEach((r) => linked.add(r));
    const state = pr.merged ? 'merged' : p.action === 'closed' ? 'closed' : 'open';
    const existing = db.gitEvents.where((g) => g.repositoryId === repo.id && g.prNumber === pr.number)[0];
    const data = {
      kind: (pr.merged ? 'merge' : 'pull_request') as GitEvent['kind'],
      title: pr.title, branch: pr.head.ref, sha: (pr.merge_commit_sha ?? pr.head.sha).slice(0, 7),
      author: pr.user.login, url: pr.html_url, prState: state as GitEvent['prState'], deliveryId,
    };
    if (existing) {
      // Keep manual links when a PR is updated.
      db.gitEvents.patch(existing.id, { ...data, workItemRefs: [...new Set([...refs, ...(existing.manualRefs ?? [])])] });
    } else {
      db.gitEvents.insert({ projectId, repositoryId: repo.id, prNumber: pr.number, workItemRefs: refs, manualRefs: [], ...data });
    }
    db.log('system', pr.merged ? 'git.merge' : 'git.pr', { type: 'git', id: repo.id, label: `${repo.name} #${pr.number}`, projectId }, [{ field: 'الحالة', from: null, to: state }]);
    if (pr.merged) {
      // FR-GIT-08: merging in Git does NOT complete or approve the work item; it only informs assignees.
      for (const ref of refs) {
        const item = db.workItems.where((w) => w.ref === ref)[0];
        if (item) db.notify(item.assigneeIds, 'دُمج Pull Request مرتبط', `${ref}: ${pr.title}`, `/work-items/${item.id}`);
      }
    }
  }
  return [...linked];
}

function findRepo(db: MockDatabase, repoId: string): { repo: Repository; projectId: string } {
  for (const p of db.projects.all()) {
    const repo = p.repositories.find((r) => r.id === repoId);
    if (repo) return { repo, projectId: p.id };
  }
  throw new MockHttpError(404, 'المستودع غير موجود.');
}

/** Shared by the public webhook route and the simulator: verify → dedupe → process → record. */
async function receive(db: MockDatabase, provider: Repository['provider'], repoId: string, raw: string, headers: HttpHeaders | undefined): Promise<WebhookDelivery> {
  const { repo, projectId } = findRepo(db, repoId);
  const connector = connectorFor(provider);
  // GitLab names events "Push Hook" / "Merge Request Hook"; the connector normalises to push / pull_request.
  const event = connector.normalizeEvent(headers?.get(connector.eventHeader) ?? 'unknown');
  const deliveryId = headers?.get(connector.deliveryHeader);
  if (!deliveryId) throw new MockHttpError(400, 'معرّف التسليم مفقود؛ لا يمكن ضمان عدم التكرار.');
  const base = { projectId, repositoryId: repo.id, provider, deliveryId, event };

  // Replay protection (§7.2): the timestamp is mandatory and part of the signed material.
  const stamp = headers?.get(TIMESTAMP_HEADER);
  if (!stamp) {
    const message = 'الطابع الزمني للتسليم مفقود';
    db.log('system', 'git.webhook_rejected', { type: 'git', id: repo.id, label: repo.name, projectId }, [{ field: 'التسليم', from: null, to: deliveryId }, { field: 'السبب', from: null, to: message }], true);
    db.webhookDeliveries.insert({ ...base, signatureValid: false, outcome: 'rejected', message, linkedRefs: [] });
    throw new MockHttpError(400, `${message} (${TIMESTAMP_HEADER}).`);
  }

  const secret = db.webhookSecrets.get(repo.id);
  const signatureValid = !!secret && (await connector.verify(secret, raw, headers));
  if (!signatureValid) {
    db.log('system', 'git.webhook_rejected', { type: 'git', id: repo.id, label: repo.name, projectId }, [{ field: 'التسليم', from: null, to: deliveryId }], true);
    db.webhookDeliveries.insert({ ...base, signatureValid: false, outcome: 'rejected', message: 'توقيع غير صالح', linkedRefs: [] });
    throw new MockHttpError(401, 'توقيع Webhook غير صالح.');
  }

  {
    const at = parseTimestamp(stamp);
    if (at === null || Math.abs(Date.now() - at) > REPLAY_WINDOW_MS) {
      const message = at === null ? 'طابع زمني غير صالح' : 'تسليم قديم خارج نافذة 5 دقائق (حماية من إعادة الإرسال)';
      db.log('system', 'git.webhook_rejected', { type: 'git', id: repo.id, label: repo.name, projectId }, [{ field: 'التسليم', from: null, to: deliveryId }, { field: 'السبب', from: null, to: message }], true);
      db.webhookDeliveries.insert({ ...base, signatureValid: true, outcome: 'rejected', message, linkedRefs: [] });
      throw new MockHttpError(401, `رُفض التسليم: ${message}.`);
    }
  }

  // FR-GIT-05: the same delivery is never counted twice, whatever its earlier outcome (a failed one is retried only through
  // the explicit redeliver endpoint). Rejected ones are excluded so a forged call cannot burn a legitimate delivery id.
  if (db.webhookDeliveries.where((d) => d.repositoryId === repo.id && d.deliveryId === deliveryId && d.outcome !== 'rejected').length) {
    return db.webhookDeliveries.insert({ ...base, signatureValid: true, outcome: 'duplicate', message: 'تسليم مكرر؛ لم يُعالج مجددًا', linkedRefs: [] });
  }

  try {
    const linkedRefs = processPayload(db, repo, projectId, event, JSON.parse(raw), deliveryId);
    const delivery = db.webhookDeliveries.insert({ ...base, signatureValid: true, outcome: 'processed', message: null, linkedRefs });
    const project = db.projects.get(projectId);
    db.projects.patch(projectId, { repositories: project.repositories.map((r) => (r.id === repo.id ? { ...r, lastSyncAt: new Date().toISOString(), lastSyncError: null } : r)) });
    return delivery;
  } catch (e) {
    const message = e instanceof MockHttpError ? e.message : 'تعذّرت معالجة الحمولة';
    const delivery = db.webhookDeliveries.insert({ ...base, signatureValid: true, outcome: 'failed', message, linkedRefs: [] });
    db.webhookPayloads.set(delivery.id, { raw, event });
    return delivery;
  }
}

function buildPayload(req: SimulateWebhookRequest, prNumber: number, repo: Repository): { event: string; payload: PushPayload | PullRequestPayload } {
  const connector = connectorFor(repo.provider);
  const sha = crypto.randomUUID().replace(/-/g, '').slice(0, 40);
  const url = connector.commitUrl(repo.url, sha.slice(0, 7));
  if (req.event === 'push') {
    return { event: 'push', payload: { ref: `refs/heads/${req.branch}`, commits: [{ id: sha, message: req.message, url, author: { username: req.author } }] } };
  }
  const merged = req.event === 'pr_merge';
  return {
    event: 'pull_request',
    payload: {
      action: merged ? 'closed' : 'opened',
      pull_request: {
        number: prNumber, title: req.message, html_url: connector.prUrl(repo.url, prNumber), merged,
        merge_commit_sha: merged ? sha : null, head: { ref: req.branch, sha }, user: { login: req.author },
      },
    },
  };
}

export function registerGitHandlers(router: MockRouter, db: MockDatabase): void {
  // Public endpoint called by the Git provider. Authenticated by signature, not by user session.
  router.post(
    'webhooks/:provider/:repoId',
    (req) => receive(db, req.params['provider'] as Repository['provider'], req.params['repoId'], typeof req.body === 'string' ? req.body : JSON.stringify(req.body), req.headers),
    true,
  );

  router
    .get('git/deliveries', (req, ctx) => {
      const query = parseListQuery(req.query);
      // Exactly one project, checked for visibility: an any-of filter could otherwise include hidden projects.
      const ids = query.filters['projectId'] ?? [];
      if (ids.length !== 1) fail(400, 'حدّد مشروعًا واحدًا.');
      const projectId = ids[0];
      ctx.requireProjectVisible(projectId);
      ctx.require('git.view', projectId);
      return db.webhookDeliveries.query({ ...query, sort: query.sort ?? { field: 'createdAt', direction: 'desc' } });
    })
    .post('git/deliveries/:id/redeliver', async (req, ctx) => {
      const delivery = db.webhookDeliveries.get(req.params['id']);
      ctx.require('git.manage', delivery.projectId);
      const stored = db.webhookPayloads.get(delivery.id);
      if (delivery.outcome !== 'failed' || !stored) fail(422, 'إعادة المعالجة متاحة للتسليمات الفاشلة فقط.');
      const { repo } = findRepo(db, delivery.repositoryId);
      // FR-GIT-06: re-run processing on the stored, already-verified payload.
      try {
        const linkedRefs = processPayload(db, repo, delivery.projectId, stored.event, JSON.parse(stored.raw), delivery.deliveryId);
        db.webhookPayloads.delete(delivery.id);
        return db.webhookDeliveries.patch(delivery.id, { outcome: 'processed', message: 'أُعيدت المعالجة يدويًا', linkedRefs });
      } catch (e) {
        return db.webhookDeliveries.patch(delivery.id, { message: e instanceof MockHttpError ? e.message : 'فشلت إعادة المعالجة' });
      }
    })
    .post('projects/:id/git-sync', (req, ctx) => {
      const current = db.projects.get(req.params['id']);
      ctx.requireProjectVisible(current.id);
      ctx.require('git.sync', current.id);
      const { repositoryId } = body<{ repositoryId: string }>(req);
      const repo = current.repositories.find((r) => r.id === repositoryId);
      if (!repo) fail(404, 'المستودع غير موجود.');
      const setState = (state: Partial<Repository>): void => {
        const project = db.projects.get(current.id);
        db.projects.patch(current.id, { repositories: project.repositories.map((r) => (r.id === repo.id ? { ...r, ...state } : r)) });
      };
      // FR-GIT-06: every attempt is audited with its counts, successful or not.
      const audit = (fetched: number, ingested: number, linked: number, error: string | null): void =>
        db.log(ctx.me, 'git.synced', { type: 'git', id: repo.id, label: repo.name, projectId: current.id }, [
          { field: 'الإيداعات على الخادم', from: null, to: String(fetched) },
          { field: 'الإيداعات الجديدة', from: null, to: String(ingested) },
          { field: 'العناصر المرتبطة', from: null, to: String(linked) },
          ...(error ? [{ field: 'الخطأ', from: null, to: error }] : []),
        ]);
      if (!repo.connected) {
        const error = 'المستودع مفصول؛ لا توجد بيانات اعتماد للمزامنة.';
        setState({ lastSyncError: error });
        audit(0, 0, 0, error);
        fail(422, 'المستودع مفصول؛ أعد ربطه قبل المزامنة.');
      }
      if (repo.simulateOutage) {
        // Simulated outage of the Git server (seeded repository flag, never inferred from the name).
        const error = 'تعذّر الاتصال بخادم Git: انتهت المهلة (504 Gateway Timeout).';
        setState({ lastSyncError: error });
        audit(0, 0, 0, error);
        fail(502, error);
      }
      const remote = db.remoteCommits.get(repo.id) ?? [];
      const linked = new Set<string>();
      let ingested = 0;
      for (const commit of remote) {
        const sha = commit.sha.slice(0, 7);
        // Same path as a webhook push; processPayload is idempotent per commit sha, so a repeat sync adds nothing.
        if (db.gitEvents.where((g) => g.repositoryId === repo.id && g.sha === sha && g.kind === 'push').length) continue;
        const payload: PushPayload = { ref: `refs/heads/${commit.branch}`, commits: [{ id: commit.sha, message: commit.message, url: commit.url, author: { username: commit.author } }] };
        processPayload(db, repo, current.id, 'push', payload, `sync-${repo.id}-${sha}`).forEach((r) => linked.add(r));
        ingested++;
      }
      setState({ lastSyncAt: new Date().toISOString(), lastSyncError: null });
      audit(remote.length, ingested, linked.size, null);
      return summarize(db, db.projects.get(current.id));
    })
    .post('projects/:id/repositories/:repoId/rotate-secret', (req, ctx) => {
      const current = db.projects.get(req.params['id']);
      ctx.requireProjectVisible(current.id);
      ctx.require('git.manage', current.id);
      const repo = current.repositories.find((r) => r.id === req.params['repoId']);
      if (!repo) fail(404, 'المستودع غير موجود.');
      if (!repo.connected) fail(422, 'المستودع مفصول؛ لا يمكن تدوير سرّه.');
      const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      db.webhookSecrets.set(repo.id, secret);
      // The new secret is returned this once; the audit records the rotation, never the value (NFR-04).
      db.log(ctx.me, 'git.secretRotated', { type: 'git', id: repo.id, label: repo.name, projectId: current.id }, [{ field: 'سرّ Webhook', from: 'سرّ سابق', to: 'سرّ جديد (غير معروض)' }], true);
      const result: RotatedSecret = { repositoryId: repo.id, secret };
      return result;
    })
    .post('git/simulate', async (req, ctx) => {
      if (!DEMO_MODE) fail(404, 'المحاكي غير متاح.');
      const dto = body<SimulateWebhookRequest>(req);
      const { repo, projectId } = findRepo(db, dto.repositoryId);
      ctx.requireProjectVisible(projectId);
      ctx.require('git.sync', projectId);
      const prNumber = 100 + db.gitEvents.where((g) => g.repositoryId === repo.id && !!g.prNumber).length + (dto.event === 'pr_open' ? 1 : 0);
      const { event, payload } = buildPayload(dto, dto.event === 'pr_merge' ? Math.max(101, prNumber) : prNumber, repo);
      const raw = JSON.stringify(payload);
      const last = db.webhookDeliveries.where((d) => d.repositoryId === repo.id && d.outcome === 'processed').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const deliveryId = dto.replayLast && last ? last.deliveryId : crypto.randomUUID();
      const secret = db.webhookSecrets.get(repo.id) ?? '';
      const connector = connectorFor(repo.provider);
      const stamp = new Date().toISOString();
      const signed = dto.unsigned ? 'invalid' : await connector.sign(secret, raw, stamp);
      const headers = new HttpHeaders({
        [connector.eventHeader]: connector.providerEvent(event), [connector.deliveryHeader]: deliveryId, [connector.signatureHeader]: signed,
        [TIMESTAMP_HEADER]: stamp,
      });
      try {
        return await receive(db, repo.provider, repo.id, raw, headers);
      } catch (e) {
        // Surface the rejection as data so the simulator can show it.
        if (e instanceof MockHttpError && e.status === 401) return db.webhookDeliveries.where((d) => d.deliveryId === deliveryId && d.outcome === 'rejected')[0];
        throw e;
      }
    })
    .post('git-events/:id/link', (req, ctx) => {
      const event = db.gitEvents.get(req.params['id']);
      ctx.requireProjectVisible(event.projectId);
      ctx.require('tasks.edit', event.projectId);
      const { ref } = body<{ ref: string }>(req);
      const item = db.workItems.where((w) => w.ref === ref && w.projectId === event.projectId)[0];
      if (!item) fail(404, `لا يوجد عنصر بالرمز ${ref} في هذا المشروع.`);
      if (event.workItemRefs.includes(ref)) fail(409, 'مرتبط مسبقًا.');
      const next = db.gitEvents.patch(event.id, { workItemRefs: [...event.workItemRefs, ref], manualRefs: [...(event.manualRefs ?? []), ref] });
      db.log(ctx.me, 'git.linked', { type: 'workItem', id: item.id, label: item.ref, projectId: item.projectId }, [{ field: 'Commit', from: null, to: event.sha }]);
      return next;
    })
    .post('git-events/:id/unlink', (req, ctx) => {
      const event = db.gitEvents.get(req.params['id']);
      ctx.requireProjectVisible(event.projectId);
      ctx.require('tasks.edit', event.projectId);
      const { ref } = body<{ ref: string }>(req);
      const item = db.workItems.where((w) => w.ref === ref && w.projectId === event.projectId)[0];
      const next = db.gitEvents.patch(event.id, {
        workItemRefs: event.workItemRefs.filter((r) => r !== ref),
        manualRefs: (event.manualRefs ?? []).filter((r) => r !== ref),
      });
      db.log(ctx.me, 'git.unlinked', { type: 'workItem', id: item?.id ?? '-', label: ref, projectId: event.projectId }, [{ field: 'Commit', from: event.sha, to: null }]);
      return next;
    });
}

/** Signed request helper for tests. */
export async function signedHeaders(secret: string, raw: string, event: string, deliveryId: string, timestamp = new Date().toISOString()): Promise<HttpHeaders> {
  return new HttpHeaders({
    'X-Gitea-Event': event, 'X-Gitea-Delivery': deliveryId, [TIMESTAMP_HEADER]: timestamp,
    'X-Gitea-Signature': await hmacSha256Hex(secret, signedMaterial(timestamp, raw)),
  });
}


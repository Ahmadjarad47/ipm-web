import { gitConnector, GitProvider } from '@domain/git/git-connector';
import { WebhookDelivery } from '@domain/git/git.models';
import { compileRefPattern, defaultRefPattern, extractRefs, validateRefPattern } from '@domain/git/ref-pattern';

/** Pure helpers for the Git tab: ref-pattern tester, provider-driven webhook steps, delivery explanations. */

export interface RefSegment {
  readonly text: string;
  readonly match: boolean;
}

export interface RefTestResult {
  /** Arabic validation message, or null when the pattern is acceptable. */
  readonly error: string | null;
  readonly refs: readonly string[];
  /** The text split into plain / matched parts, for highlighting. */
  readonly segments: readonly RefSegment[];
}

/** The pattern in force: the project's custom one, else the default derived from its code. */
export function effectivePattern(custom: string | null | undefined, code: string): string {
  const trimmed = custom?.trim();
  return trimmed ? trimmed : defaultRefPattern(code);
}

/**
 * Same detection the server uses, applied to pasted text. The pattern is validated first
 * (catastrophic patterns are never executed), against the project's own sample ref.
 */
export function testRefPattern(pattern: string, code: string, text: string): RefTestResult {
  const error = validateRefPattern(pattern, [`${code}-101`]);
  if (error) return { error, refs: [], segments: [{ text, match: false }] };
  const refs = extractRefs(pattern, text);
  const segments: RefSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(compileRefPattern(pattern))) {
    if (m.index === undefined || m[0] === '') continue;
    if (m.index > cursor) segments.push({ text: text.slice(cursor, m.index), match: false });
    segments.push({ text: m[0], match: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return { error: null, refs, segments: segments.length ? segments : [{ text, match: false }] };
}

export interface WebhookStep {
  readonly text: string;
  /** LTR value to show and copy (URL, header name…). */
  readonly code?: string;
}

const SAMPLE_REPO = 'https://git.example.com/owner/repo';

/** Webhook setup steps for a provider, built from its connector (headers, event names, URL shapes). */
export function webhookSteps(provider: GitProvider, webhookUrl?: string | null): WebhookStep[] {
  const c = gitConnector(provider);
  const steps: WebhookStep[] = [
    webhookUrl ? { text: 'رابط الحمولة (Payload URL):', code: webhookUrl } : { text: 'رابط الحمولة (Payload URL): يظهر هنا بعد ربط المستودع.' },
    { text: 'نوع المحتوى (Content type):', code: 'application/json' },
    provider === 'gitlab'
      ? { text: 'السر (Secret token): أدخل السر نفسه؛ يرسله GitLab كما هو في الترويسة:', code: c.signatureHeader }
      : { text: 'السر (Secret): أدخل السر نفسه؛ يوقّع المزوّد كل حمولة بخوارزمية HMAC-SHA256 في الترويسة:', code: c.signatureHeader },
    { text: 'الأحداث المطلوبة:', code: `${c.providerEvent('push')} ، ${c.providerEvent('pull_request')}` },
    { text: 'ترويسة نوع الحدث:', code: c.eventHeader },
    { text: 'ترويسة معرّف التسليم (تمنع المعالجة المكررة):', code: c.deliveryHeader },
    { text: 'شكل روابط الإيداعات وطلبات الدمج لدى هذا المزوّد:', code: `${c.commitUrl(SAMPLE_REPO, 'abc1234')}  |  ${c.prUrl(SAMPLE_REPO, 12)}` },
  ];
  return steps;
}

export function providerLabel(provider: GitProvider): string {
  return provider === 'gitea' ? 'Gitea' : provider === 'github' ? 'GitHub' : 'GitLab';
}

/** Plain-Arabic reading of a delivery row (why it was rejected / ignored / failed). */
export function explainDelivery(d: Pick<WebhookDelivery, 'outcome' | 'signatureValid' | 'message' | 'linkedRefs'>): string {
  switch (d.outcome) {
    case 'processed':
      return d.linkedRefs.length ? `عولج وربط ${d.linkedRefs.length} عمل.` : 'عولج دون ربط أي عمل (لا يوجد رمز عمل في الرسالة أو الفرع).';
    case 'duplicate':
      return 'وصل هذا التسليم من قبل وعولج؛ تجاهله النظام عمدًا لمنع تكرار الروابط. لا يلزم أي إجراء.';
    case 'rejected':
      if (!d.signatureValid) return 'رُفض لأن التوقيع لا يطابق السر المحفوظ. تأكد من إدخال السر نفسه في إعدادات Webhook لدى المزوّد، أو دوّر السر وحدّثه هناك.';
      if (d.message && /نافذة|طابع|قديم/.test(d.message)) return 'رُفض لأن التسليم قديم أو بطابع زمني غير صالح (نافذة الحماية 5 دقائق). أعد إرساله من المزوّد.';
      return d.message ? `رُفض: ${d.message}` : 'رُفض التسليم.';
    case 'failed':
      return `وصل سليمًا لكن فشلت معالجته${d.message ? `: ${d.message}` : ''}. يمكنك «إعادة المعالجة» بعد زوال السبب.`;
  }
}

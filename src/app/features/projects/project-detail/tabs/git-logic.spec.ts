import { describe, expect, it } from 'vitest';
import { effectivePattern, explainDelivery, testRefPattern, webhookSteps } from './git-logic';

describe('git-logic', () => {
  it('detects refs with the default pattern and highlights them', () => {
    const p = effectivePattern(undefined, 'ERP');
    const r = testRefPattern(p, 'ERP', 'fix ERP-104 and (ERP-7) but not OTHER-1 or erp-3');
    expect(r.error).toBeNull();
    expect(r.refs).toEqual(['ERP-104', 'ERP-7']);
    expect(r.segments.filter((s) => s.match).map((s) => s.text)).toEqual(['ERP-104', 'ERP-7']);
    expect(r.segments.map((s) => s.text).join('')).toBe('fix ERP-104 and (ERP-7) but not OTHER-1 or erp-3');
  });

  it('finds nothing in a branch without a ref', () => {
    const r = testRefPattern(effectivePattern('', 'ERP'), 'ERP', 'feature/login-page');
    expect(r.refs).toEqual([]);
  });

  it('rejects invalid, group-less and catastrophic patterns without running them', () => {
    expect(testRefPattern('(', 'ERP', 'x').error).toBeTruthy();
    expect(testRefPattern('ERP-\\d+', 'ERP', 'ERP-1').error).toContain('مجموعة التقاط');
    expect(testRefPattern('(a+)+', 'ERP', 'aaaa').error).toBeTruthy();
    expect(testRefPattern('(OTHER-\\d+)', 'ERP', 'ERP-1').error).toContain('ERP-101');
  });

  it('accepts a custom pattern that still recognises the project refs', () => {
    const r = testRefPattern('\\[(ERP-\\d+)\\]', 'ERP', 'ERP-5 [ERP-9]');
    expect(r.error).toBeNull();
    expect(r.refs).toEqual(['ERP-9']);
  });

  it('builds provider specific webhook steps', () => {
    const gitlab = webhookSteps('gitlab', 'https://x/webhooks/gitlab/1');
    expect(gitlab.some((s) => s.code === 'X-Gitlab-Token')).toBe(true);
    expect(gitlab.some((s) => s.code?.includes('Push Hook'))).toBe(true);
    const github = webhookSteps('github');
    expect(github.some((s) => s.code === 'X-Hub-Signature-256')).toBe(true);
    expect(github[0].code).toBeUndefined();
  });

  it('explains deliveries in plain Arabic', () => {
    expect(explainDelivery({ outcome: 'rejected', signatureValid: false, message: 'توقيع غير صالح', linkedRefs: [] })).toContain('السر');
    expect(explainDelivery({ outcome: 'rejected', signatureValid: true, message: 'تسليم قديم خارج نافذة 5 دقائق', linkedRefs: [] })).toContain('5 دقائق');
    expect(explainDelivery({ outcome: 'duplicate', signatureValid: true, message: null, linkedRefs: [] })).toContain('لا يلزم');
    expect(explainDelivery({ outcome: 'failed', signatureValid: true, message: 'x', linkedRefs: [] })).toContain('إعادة المعالجة');
    expect(explainDelivery({ outcome: 'processed', signatureValid: true, message: null, linkedRefs: ['ERP-1'] })).toContain('1');
  });
});

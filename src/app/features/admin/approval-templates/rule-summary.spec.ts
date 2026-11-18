import { describe, expect, it } from 'vitest';
import { conditionValueText, joinAr, parseConditionValue, summarizeRule, RuleSummaryContext } from './rule-summary';

const ctx = (event: RuleSummaryContext['event']): RuleSummaryContext => ({
  event,
  typeName: (id) => ({ t1: 'المهام', t2: 'الأخطاء' })[id] ?? id,
  projectName: (id) => ({ p1: 'ERP', p2: 'CRM' })[id] ?? id,
  priorityLabel: (p) => ({ low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة' })[p],
});

describe('rule summary', () => {
  it('describes a typical work item rule', () => {
    const text = summarizeRule({ workItemTypeIds: ['t1', 't2'], priorities: ['high'], projectIds: ['p1'], actions: ['close'] }, ctx('workItem.approve'));
    expect(text).toBe('يُطبَّق على: المهام والأخطاء عالية الأولوية في مشروع ERP عند الإغلاق');
  });

  it('handles an empty rule and a rule priority', () => {
    expect(summarizeRule(undefined, ctx('project.close'))).toContain('كل الحالات');
    expect(summarizeRule({ priority: 5 }, ctx('workItem.approve'))).toContain('أولوية القاعدة: 5');
  });

  it('joins several projects, priorities and actions', () => {
    const text = summarizeRule({ projectIds: ['p1', 'p2'], priorities: ['high', 'critical'], actions: ['close', 'reopen'] }, ctx('workItem.approve'));
    expect(text).toContain('في المشاريع ERP وCRM');
    expect(text).toContain('عالية أو حرجة');
    expect(text).toContain('عند الإغلاق أو إعادة الفتح');
  });

  it('ignores work item only filters for project events', () => {
    expect(summarizeRule({ priorities: ['high'] }, ctx('project.approve'))).not.toContain('عالية');
  });

  it('joins lists and parses condition values', () => {
    expect(joinAr(['أ', 'ب', 'ج'])).toBe('أ، ب وج');
    expect(parseConditionValue('in', 'a, b،c')).toEqual(['a', 'b', 'c']);
    expect(parseConditionValue('gt', '5')).toBe(5);
    expect(parseConditionValue('eq', ' x ')).toBe('x');
    expect(conditionValueText(['a', 'b'])).toBe('a, b');
  });
});

import { describe, expect, it } from 'vitest';
import { readProblem } from './problem';

describe('readProblem', () => {
  it('reads the server problem+json: detail, code and the first message per field', () => {
    const problem = readProblem({ title: 't', status: 400, detail: 'بيانات غير صالحة', code: 'Validation.Failed', errors: { name: ['مطلوب', 'ثانية'], 'proposedChanges.title': ['طويل'] } });

    expect(problem.message).toBe('بيانات غير صالحة');
    expect(problem.code).toBe('Validation.Failed');
    expect(problem.details).toEqual({ name: 'مطلوب', 'proposedChanges.title': 'طويل' });
  });

  it('still reads the older message/details shape', () => {
    expect(readProblem({ message: 'رسالة', details: { a: 'b' } })).toEqual({ message: 'رسالة', code: undefined, details: { a: 'b' } });
  });

  it('gives nothing for a body that is not an object', () => {
    expect(readProblem(null)).toEqual({});
    expect(readProblem('<html>')).toEqual({});
  });
});

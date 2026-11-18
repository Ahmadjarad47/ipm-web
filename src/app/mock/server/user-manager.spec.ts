import { HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { registerAuthUserHandlers } from './handlers/auth-users.handlers';
import { Method, MockContext, MockRouter } from './router';

describe('User reporting line (managerId)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerAuthUserHandlers(router, db);
  });

  async function patch(id: string, body: Record<string, unknown>): Promise<unknown> {
    const match = router.match('PATCH' as Method, `users/${id}`);
    if (!match) throw new Error('route');
    return match.route.handler({ method: 'PATCH', path: `users/${id}`, params: match.params, query: new HttpParams(), body }, new MockContext(db, 'u-1'));
  }

  async function status(fn: () => Promise<unknown>): Promise<number> {
    try {
      await fn();
      return 200;
    } catch (e) {
      if (e instanceof MockHttpError) return e.status;
      throw e;
    }
  }

  it('saves a valid manager and audits it', async () => {
    await patch('u-6', { managerId: 'u-2', version: db.users.get('u-6').version });
    expect(db.users.get('u-6').managerId).toBe('u-2');
    expect(db.audit.where((e) => e.action === 'user.updated' && e.changes.some((c) => c.field === 'المدير المباشر')).length).toBe(1);
  });

  it('rejects self, inactive and circular reporting lines', async () => {
    expect(await status(() => patch('u-6', { managerId: 'u-6', version: db.users.get('u-6').version }))).toBe(400);
    expect(await status(() => patch('u-6', { managerId: 'u-7', version: db.users.get('u-6').version }))).toBe(400); // mona is inactive
    // seed chain: fahad(u-4) → noura(u-3) → khaled(u-2) → sara(u-1); making sara report to fahad closes a loop
    expect(await status(() => patch('u-1', { managerId: 'u-4', version: db.users.get('u-1').version }))).toBe(400);
  });

  it('clears the manager with an empty value', async () => {
    await patch('u-4', { managerId: '', version: db.users.get('u-4').version });
    expect(db.users.get('u-4').managerId).toBeUndefined();
  });
});

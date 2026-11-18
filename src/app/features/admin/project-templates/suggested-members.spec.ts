import { describe, expect, it } from 'vitest';
import { memberRowErrors, previewMembers } from './suggested-members';

const users = new Map([
  ['u1', { name: 'سارة', active: true }],
  ['u2', { name: 'خالد', active: false }],
]);
const roles = new Map([
  ['pm', { name: 'مدير مشروع', scope: 'project' as const }],
  ['admin', { name: 'مدير نظام', scope: 'system' as const }],
]);

describe('suggested members', () => {
  it('previews what project creation would do per row', () => {
    const preview = previewMembers(
      [
        { userId: 'u1', roleId: 'pm' },
        { userId: 'u1', roleId: 'pm' },
        { userId: 'u2', roleId: 'pm' },
        { userId: 'u1', roleId: 'admin' },
        { userId: '', roleId: 'pm' },
      ],
      users,
      roles,
    );
    expect(preview.map((p) => p.status)).toEqual(['added', 'duplicate', 'inactive', 'invalid-role', 'role-only']);
  });

  it('flags a system role as invalid for an active user', () => {
    expect(previewMembers([{ userId: 'u1', roleId: 'admin' }], users, roles)[0].status).toBe('invalid-role');
  });

  it('validates role and duplicate users as blocking errors', () => {
    const errors = memberRowErrors(
      [
        { userId: 'u1', roleId: 'pm' },
        { userId: 'u1', roleId: 'pm' },
        { userId: '', roleId: '' },
        { userId: '', roleId: 'admin' },
      ],
      roles,
    );
    expect([...errors.keys()]).toEqual([1, 2, 3]);
  });
});

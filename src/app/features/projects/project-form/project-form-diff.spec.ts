import { describe, expect, it } from 'vitest';
import { projectChanges } from './project-form-diff';

const base = { name: 'ERP', description: 'x', ownerId: 'u1', startDate: '2026-01-01T00:00:00Z', endDate: '2026-06-30' };
const names: Record<string, string> = { u1: 'سارة', u2: 'خالد' };
const nameOf = (id: string): string => names[id] ?? id;

describe('projectChanges', () => {
  it('returns nothing when unchanged (ISO timestamps compared by day)', () => {
    expect(projectChanges(base, { ...base, startDate: '2026-01-01' }, nameOf)).toEqual([]);
  });

  it('shows owner names instead of ids', () => {
    const changes = projectChanges(base, { ...base, ownerId: 'u2', name: 'ERP 2' }, nameOf);
    expect(changes).toEqual([
      { label: 'الاسم', from: 'ERP', to: 'ERP 2' },
      { label: 'المالك', from: 'سارة', to: 'خالد' },
    ]);
  });

  it('renders emptied fields as a dash', () => {
    expect(projectChanges(base, { ...base, description: '' }, nameOf)).toEqual([{ label: 'الوصف', from: 'x', to: '—' }]);
  });
});

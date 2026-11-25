import { inject, Injectable } from '@angular/core';
import { FieldChange, SubjectType } from '@domain/activity/activity.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { UserLookup } from '@domain/users/user.api';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { StatusLookup } from '@domain/workflow/workflow.api';

/** Arabic labels of the field keys that appear in audit `changes`; unknown keys are shown as-is. */
export const AUDIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'العنوان', name: 'الاسم', description: 'الوصف', status: 'الحالة', statusId: 'الحالة', type: 'النوع', typeId: 'النوع',
  priority: 'الأولوية', assigneeIds: 'المكلّفون', assignees: 'المكلّفون', parent: 'العمل الأب', parentId: 'العمل الأب',
  startDate: 'تاريخ البدء', dueDate: 'تاريخ الاستحقاق', endDate: 'تاريخ الانتهاء', archived: 'مؤرشف', progress: 'التقدم',
  children: 'الأعمال الفرعية', reason: 'السبب', approval: 'الموافقة', score: 'التقييم', username: 'اسم المستخدم',
  members: 'الأعضاء', ownerId: 'المالك', managerId: 'المدير', projectId: 'المشروع', body: 'النص', active: 'مفعّل',
  email: 'البريد الإلكتروني', role: 'الدور', roles: 'الأدوار', transitions: 'الانتقالات',
};

/** Summarises a structured (JSON array/object) value so raw JSON never reaches the screen. */
function summarizeStructured(field: string, value: string): string | null {
  const text = value.trim();
  if (text[0] !== '[' && text[0] !== '{') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    const n = parsed.length;
    if (/transition/i.test(field)) return n === 0 ? 'بدون انتقالات' : `${n} انتقالًا`;
    return n === 0 ? '—' : `${n} عملًا`;
  }
  return 'تفاصيل متعددة';
}

export type IdKind = 'status' | 'type' | 'user' | 'project';

export function idKindOf(field: string): IdKind | null {
  if (/status/i.test(field)) return 'status';
  if (/^type|typeid$/i.test(field)) return 'type';
  if (/assignee|owner|manager|member|user|actor|author|approver/i.test(field)) return 'user';
  if (/project/i.test(field)) return 'project';
  return null;
}

export type IdResolver = (kind: IdKind, id: string) => string | undefined;

export function fieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field;
}

/** Display text for one side of a change: ids become names when a resolver knows them. */
export function formatChangeValue(field: string, value: string | null, resolve: IdResolver): string {
  if (value === null || value === '') return '—';
  if (value === 'true') return 'نعم';
  if (value === 'false') return 'لا';
  const structured = summarizeStructured(field, value);
  if (structured !== null) return structured;
  const kind = idKindOf(field);
  if (!kind) return value;
  return value
    .split(',')
    .map((part) => {
      const id = part.trim();
      return resolve(kind, id) ?? id;
    })
    .join('، ');
}

export function subjectLink(type: SubjectType, id: string): string | null {
  switch (type) {
    case 'project': return `/projects/${id}`;
    case 'workItem': return `/work-items/${id}`;
    case 'approval': return `/approvals/${id}`;
    default: return null;
  }
}

/** Formats audit field changes for display (shared by the dashboard feed, the activity log and the audit dialog). */
@Injectable({ providedIn: 'root' })
export class AuditFormatter {
  private readonly statuses = inject(StatusLookup);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly users = inject(UserLookup);
  private readonly projects = inject(ProjectLookup);

  private readonly resolve: IdResolver = (kind, id) => {
    switch (kind) {
      case 'status': return this.statuses.get(id)?.name;
      case 'type': return this.types.get(id)?.name;
      case 'user': return this.users.get(id)?.name;
      case 'project': return this.projects.get(id)?.name;
    }
  };

  field(field: string): string {
    return fieldLabel(field);
  }

  value(change: FieldChange, side: 'from' | 'to'): string {
    return formatChangeValue(change.field, change[side], this.resolve);
  }
}

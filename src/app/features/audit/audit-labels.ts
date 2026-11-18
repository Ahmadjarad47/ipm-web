import { SubjectType } from '@domain/activity/activity.models';

export const SUBJECT_TYPE_LABELS: Readonly<Record<SubjectType, string>> = {
  project: 'مشروع',
  workItem: 'عنصر عمل',
  approval: 'موافقة',
  user: 'مستخدم',
  role: 'دور',
  type: 'نوع عنصر',
  status: 'حالة',
  relation: 'علاقة',
  git: 'Git',
};

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  ui: 'الواجهة',
  api: 'واجهة البرمجة (API)',
  webhook: 'Webhook',
  system: 'النظام',
};

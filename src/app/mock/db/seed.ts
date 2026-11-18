import { ALL_PERMISSIONS, PermissionKey } from '@core/auth/permissions';
import { Entity } from '@core/models/entity.model';
import { AuditEvent, Comment, GitEvent, Notification } from '@domain/activity/activity.models';
import { ApprovalRequest, ApprovalTemplate, Delegation } from '@domain/approvals/approval.models';
import { RemoteCommit } from '@domain/git/git.models';
import { Attachment } from '@domain/attachments/attachment.models';
import { ProjectTemplate } from '@domain/projects/project-template';
import { DEFAULT_SETTINGS, SystemSettings } from '@domain/settings/settings.models';
import { Project } from '@domain/projects/project.models';
import { Role, User } from '@domain/users/user.models';
import { Priority, RelationType, WorkItem, WorkItemRelation, WorkItemType } from '@domain/work-items/work-item.models';
import { Status, Workflow } from '@domain/workflow/workflow.models';

// Demo seed data. Every value here is fictional.

const NOW = Date.now();
const DAY = 86_400_000;
export const daysFromNow = (n: number): string => new Date(NOW + n * DAY).toISOString().slice(0, 10);
const ago = (days: number, hours = 0): string => new Date(NOW - days * DAY - hours * 3_600_000).toISOString();

function meta<T extends object>(id: string, data: T, createdDaysAgo = 30): T & Entity {
  const ts = ago(createdDaysAgo);
  return { id, version: 1, createdAt: ts, updatedAt: ts, ...data };
}

// ---------- Roles & users ----------

const PM_PERMS: PermissionKey[] = [
  'projects.view', 'projects.edit', 'projects.archive', 'projects.members.manage',
  'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.delete', 'workflow.transition',
  'approvals.request', 'approvals.view', 'approvals.decide',
  'comments.create', 'comments.edit_own', 'files.upload', 'files.download', 'files.delete',
  'git.view', 'git.sync', 'dashboard.view', 'reports.view', 'reports.export',
  'workitem.types.view', 'project.workitemtypes.configure',
  'workitem.relations.view', 'workitem.relations.create', 'workitem.relations.delete',
];
const MEMBER_PERMS: PermissionKey[] = [
  'projects.view', 'tasks.view', 'tasks.create', 'tasks.edit', 'workflow.transition',
  'approvals.request', 'approvals.view', 'comments.create', 'comments.edit_own',
  'files.upload', 'files.download', 'git.view', 'dashboard.view', 'workitem.types.view',
  'workitem.relations.view', 'workitem.relations.create',
];
const APPROVER_PERMS: PermissionKey[] = [
  'projects.view', 'tasks.view', 'approvals.view', 'approvals.decide', 'comments.create',
  'files.download', 'git.view', 'dashboard.view', 'reports.view', 'workitem.relations.view',
];
const VIEWER_PERMS: PermissionKey[] = ['projects.view', 'tasks.view', 'dashboard.view', 'workitem.relations.view'];

export const ROLES: Role[] = [
  meta('r-admin', { key: 'system_admin', name: 'مدير النظام', description: 'الإعدادات العامة والأدوار وربط Git والتدقيق.', scope: 'system', permissions: [...ALL_PERMISSIONS], denied: [], builtIn: true }, 200),
  meta('r-pmo', { key: 'pmo', name: 'مكتب إدارة المشاريع', description: 'إنشاء المشاريع ومتابعة لوحة المؤشرات.', scope: 'system', permissions: ['projects.create', 'dashboard.view', 'reports.view', 'workitem.types.view'], denied: [], builtIn: true }, 200),
  meta('r-staff', { key: 'staff', name: 'موظف', description: 'الوصول الأساسي للوحة القيادة.', scope: 'system', permissions: ['dashboard.view'], denied: [], builtIn: true }, 200),
  meta('r-pm', { key: 'project_manager', name: 'مدير مشروع', description: 'إدارة المشروع والأعضاء والمهام ورفع طلبات الموافقة.', scope: 'project', permissions: PM_PERMS, denied: [], builtIn: true }, 200),
  meta('r-approver', { key: 'approver', name: 'مشرف / معتمد', description: 'مراجعة الطلبات في المرحلة المخصصة وإصدار القرار.', scope: 'project', permissions: APPROVER_PERMS, denied: [], builtIn: true }, 200),
  meta('r-member', { key: 'team_member', name: 'عضو فريق', description: 'تنفيذ المهام وتحديث الحقول والتعليق.', scope: 'project', permissions: MEMBER_PERMS, denied: [], builtIn: true }, 200),
  meta('r-viewer', { key: 'viewer', name: 'قارئ', description: 'مشاهدة الموارد المخصصة فقط.', scope: 'project', permissions: VIEWER_PERMS, denied: [], builtIn: true }, 200),
];

export const USERS: User[] = [
  meta('u-1', { username: 'admin', name: 'سارة العتيبي', email: 'sara@example.local', title: 'مدير النظام', active: true, systemRoleIds: ['r-admin'] }, 300),
  meta('u-2', { username: 'khaled', name: 'خالد الحربي', email: 'khaled@example.local', title: 'مدير مشروع أول', active: true, systemRoleIds: ['r-pmo', 'r-staff'], managerId: 'u-1' }, 300),
  meta('u-3', { username: 'noura', name: 'نورة القحطاني', email: 'noura@example.local', title: 'مشرفة تقنية', active: true, systemRoleIds: ['r-staff'], managerId: 'u-2' }, 300),
  meta('u-4', { username: 'fahad', name: 'فهد الدوسري', email: 'fahad@example.local', title: 'مطوّر واجهات', active: true, systemRoleIds: ['r-staff'], managerId: 'u-3' }, 300),
  meta('u-5', { username: 'reem', name: 'ريم الزهراني', email: 'reem@example.local', title: 'محللة أعمال', active: true, systemRoleIds: ['r-staff'], managerId: 'u-3' }, 300),
  meta('u-6', { username: 'abdullah', name: 'عبدالله الشهري', email: 'abdullah@example.local', title: 'مراجع جودة', active: true, systemRoleIds: ['r-staff'], managerId: 'u-3' }, 300),
  meta('u-7', { username: 'mona', name: 'منى السبيعي', email: 'mona@example.local', title: 'مطوّرة خلفية', active: false, systemRoleIds: ['r-staff'] }, 300),
];

// ---------- Statuses & workflows ----------

export const STATUSES: Status[] = [
  meta('ps-pending', { key: 'pending', name: 'قيد الإعداد', description: 'بانتظار الاعتماد والبدء', color: '#8a94a0', category: 'NotStarted', scope: 'project', order: 1, active: true }, 200),
  meta('ps-active', { key: 'active', name: 'نشط', description: 'قيد التنفيذ', color: '#1a7a5c', category: 'Active', scope: 'project', order: 2, active: true }, 200),
  meta('ps-hold', { key: 'on_hold', name: 'متوقف مؤقتًا', description: 'معلّق لسبب موثق', color: '#b7791f', category: 'Blocked', scope: 'project', order: 3, active: true }, 200),
  meta('ps-completed', { key: 'completed', name: 'مكتمل', description: 'أُغلق بعد الاعتماد', color: '#2f6fb5', category: 'Done', scope: 'project', order: 4, active: true }, 200),
  meta('ps-cancelled', { key: 'cancelled', name: 'ملغى', description: '', color: '#c0392b', category: 'Cancelled', scope: 'project', order: 5, active: true }, 200),

  meta('s-pending', { key: 'pending', name: 'جديد', description: 'لم يبدأ العمل', color: '#8a94a0', category: 'NotStarted', scope: 'workItem', order: 1, active: true }, 200),
  meta('s-progress', { key: 'in_progress', name: 'قيد التنفيذ', description: '', color: '#1a7a5c', category: 'Active', scope: 'workItem', order: 2, active: true }, 200),
  meta('s-review', { key: 'in_review', name: 'قيد المراجعة', description: '', color: '#7c5cbf', category: 'Active', scope: 'workItem', order: 3, active: true }, 200),
  meta('s-blocked', { key: 'blocked', name: 'محجوب', description: 'بانتظار اعتمادية', color: '#b7791f', category: 'Blocked', scope: 'workItem', order: 4, active: true }, 200),
  meta('s-completed', { key: 'completed', name: 'مكتمل', description: '', color: '#2f6fb5', category: 'Done', scope: 'workItem', order: 5, active: true }, 200),
  meta('s-rejected', { key: 'rejected', name: 'مرفوض', description: '', color: '#a0522d', category: 'Cancelled', scope: 'workItem', order: 6, active: true }, 200),
  meta('s-cancelled', { key: 'cancelled', name: 'ملغى', description: '', color: '#c0392b', category: 'Cancelled', scope: 'workItem', order: 7, active: true }, 200),
];

export const WORKFLOWS: Workflow[] = [
  meta('wf-project', {
    key: 'project_default', name: 'سير عمل المشاريع', scope: 'project',
    statusIds: ['ps-pending', 'ps-active', 'ps-hold', 'ps-completed', 'ps-cancelled'], initialStatusId: 'ps-pending',
    transitions: [
      { fromStatusId: 'ps-pending', toStatusId: 'ps-active', requiresApproval: true },
      { fromStatusId: 'ps-active', toStatusId: 'ps-hold' },
      { fromStatusId: 'ps-hold', toStatusId: 'ps-active' },
      { fromStatusId: 'ps-active', toStatusId: 'ps-completed', requiresApproval: true },
      { fromStatusId: 'ps-pending', toStatusId: 'ps-cancelled' },
      { fromStatusId: 'ps-hold', toStatusId: 'ps-cancelled' },
    ],
  }, 200),
  meta('wf-standard', {
    key: 'standard', name: 'سير العمل القياسي', scope: 'workItem',
    statusIds: ['s-pending', 's-progress', 's-review', 's-blocked', 's-completed', 's-cancelled'], initialStatusId: 's-pending',
    transitions: [
      { fromStatusId: 's-pending', toStatusId: 's-progress', requiresAssignee: true },
      { fromStatusId: 's-progress', toStatusId: 's-review' },
      { fromStatusId: 's-progress', toStatusId: 's-blocked' },
      { fromStatusId: 's-blocked', toStatusId: 's-progress' },
      { fromStatusId: 's-review', toStatusId: 's-progress' },
      { fromStatusId: 's-review', toStatusId: 's-completed', blockedByOpenDependencies: true },
      { fromStatusId: 's-completed', toStatusId: 's-progress', permission: 'tasks.edit' },
      { fromStatusId: 's-pending', toStatusId: 's-cancelled' },
      { fromStatusId: 's-progress', toStatusId: 's-cancelled' },
    ],
  }, 200),
  meta('wf-bug', {
    key: 'bug', name: 'سير عمل الأخطاء', scope: 'workItem',
    statusIds: ['s-pending', 's-progress', 's-review', 's-completed', 's-rejected'], initialStatusId: 's-pending',
    transitions: [
      { fromStatusId: 's-pending', toStatusId: 's-progress', requiresAssignee: true },
      { fromStatusId: 's-pending', toStatusId: 's-rejected' },
      { fromStatusId: 's-progress', toStatusId: 's-review' },
      { fromStatusId: 's-review', toStatusId: 's-progress' },
      { fromStatusId: 's-review', toStatusId: 's-completed', blockedByOpenDependencies: true },
      { fromStatusId: 's-completed', toStatusId: 's-progress', permission: 'tasks.edit' },
    ],
  }, 200),
];

// ---------- Work item & relation types ----------

export const WORK_ITEM_TYPES: WorkItemType[] = [
  meta('t-feature', {
    key: 'feature', name: 'ميزة', description: 'قدرة وظيفية تقدم قيمة للمستخدم', color: '#7c5cbf', icon: 'feature', order: 1, active: true,
    workflowId: 'wf-standard', allowedChildTypeIds: ['t-task', 't-bug'],
    fields: [
      { key: 'business_value', label: 'القيمة للأعمال', type: 'select', required: true, showInList: true, showOnCard: true, options: [{ value: 'high', label: 'عالية' }, { value: 'medium', label: 'متوسطة' }, { value: 'low', label: 'منخفضة' }] },
      { key: 'target_release', label: 'الإصدار المستهدف', type: 'text', required: false, hint: 'مثال: 2026.Q4' },
    ],
  }, 200),
  meta('t-task', {
    key: 'task', name: 'مهمة', description: 'وحدة عمل قابلة للتنفيذ', color: '#1a7a5c', icon: 'task', order: 2, active: true,
    workflowId: 'wf-standard', allowedChildTypeIds: ['t-subtask', 't-bug'],
    fields: [{ key: 'estimate_hours', label: 'التقدير (ساعات)', type: 'number', required: false, min: 0, max: 400 }],
  }, 200),
  meta('t-bug', {
    key: 'bug', name: 'خطأ', description: 'خلل في سلوك النظام', color: '#c0392b', icon: 'bug', order: 3, active: true,
    workflowId: 'wf-bug', allowedChildTypeIds: ['t-subtask'],
    fields: [
      { key: 'severity', label: 'الخطورة', type: 'select', required: true, showInList: true, showOnCard: true, options: [{ value: 'blocker', label: 'معطِّل' }, { value: 'major', label: 'كبير' }, { value: 'minor', label: 'بسيط' }] },
      { key: 'environment', label: 'البيئة', type: 'text', required: false },
      { key: 'reproducible', label: 'قابل لإعادة الإنتاج', type: 'boolean', required: false },
    ],
  }, 200),
  meta('t-subtask', {
    key: 'subtask', name: 'مهمة فرعية', description: 'جزء من مهمة', color: '#2f6fb5', icon: 'subtask', order: 4, active: true,
    workflowId: 'wf-standard', allowedChildTypeIds: [], fields: [],
  }, 200),
  meta('t-milestone', {
    key: 'milestone', name: 'معلم رئيسي', description: 'نقطة تسليم مهمة', color: '#c9a24a', icon: 'milestone', order: 5, active: true,
    workflowId: 'wf-standard', allowedChildTypeIds: ['t-feature'],
    fields: [{ key: 'reviewer', label: 'مسؤول المراجعة', type: 'user', required: false }],
  }, 200),
];

export const RELATION_TYPES: RelationType[] = [
  meta('rt-blocks', { key: 'blocks', name: 'يحجب', inverseName: 'محجوب بواسطة', directed: true, active: true, acyclic: true }, 200),
  meta('rt-relates', { key: 'relates', name: 'مرتبط بـ', inverseName: 'مرتبط بـ', directed: false, active: true, acyclic: false }, 200),
  meta('rt-duplicates', { key: 'duplicates', name: 'يكرر', inverseName: 'مكرر بواسطة', directed: true, active: true, acyclic: true }, 200),
];

// ---------- Projects ----------

export const PROJECTS: Project[] = [
  meta('p-erp', {
    code: 'ERP', name: 'تطوير نظام ERP الداخلي', description: 'إعادة بناء وحدات المشتريات والمخزون بواجهة عربية موحدة وربطها بالخدمات المركزية.',
    ownerId: 'u-2', statusId: 'ps-active', startDate: daysFromNow(-60), endDate: daysFromNow(75), archived: false,
    members: [{ userId: 'u-2', roleId: 'r-pm' }, { userId: 'u-3', roleId: 'r-approver' }, { userId: 'u-4', roleId: 'r-member' }, { userId: 'u-5', roleId: 'r-member' }, { userId: 'u-6', roleId: 'r-viewer' }],
    allowedTypeIds: ['t-feature', 't-task', 't-bug', 't-subtask', 't-milestone'], defaultTypeId: 't-task',
    repositories: [
      { id: 'repo-1', provider: 'gitea', name: 'erp/web-client', url: 'https://git.example.local/erp/web-client', defaultBranch: 'main', lastSyncAt: ago(0, 2), lastSyncError: null, connected: true, hasCredential: true, webhookUrl: 'https://ipm.example.local/api/v1/webhooks/gitea/repo-1' },
      { id: 'repo-2', provider: 'gitea', name: 'erp/api', url: 'https://git.example.local/erp/api', defaultBranch: 'main', lastSyncAt: ago(1), lastSyncError: 'انتهت مهلة الاتصال بالخادم', connected: true, hasCredential: true, webhookUrl: 'https://ipm.example.local/api/v1/webhooks/gitea/repo-2' },
    ],
  }, 60),
  meta('p-ssp', {
    code: 'SSP', name: 'بوابة الخدمات الذاتية', description: 'بوابة للموظفين لتقديم الطلبات الإدارية ومتابعتها إلكترونيًا.',
    ownerId: 'u-2', statusId: 'ps-active', startDate: daysFromNow(-35), endDate: daysFromNow(40), archived: false,
    members: [{ userId: 'u-2', roleId: 'r-pm' }, { userId: 'u-3', roleId: 'r-approver' }, { userId: 'u-5', roleId: 'r-member' }],
    allowedTypeIds: ['t-feature', 't-task', 't-bug'], defaultTypeId: 't-task',
    repositories: [{ id: 'repo-3', provider: 'gitea', name: 'ssp/portal', url: 'https://git.example.local/ssp/portal', defaultBranch: 'develop', lastSyncAt: ago(0, 5), lastSyncError: null, connected: true, hasCredential: true, webhookUrl: 'https://ipm.example.local/api/v1/webhooks/gitea/repo-3' }],
  }, 35),
  meta('p-bi', {
    code: 'BI', name: 'منصة البيانات والتقارير', description: 'مستودع بيانات موحد ولوحات مؤشرات للإدارة العليا.',
    ownerId: 'u-3', statusId: 'ps-pending', startDate: daysFromNow(10), endDate: daysFromNow(150), archived: false,
    members: [{ userId: 'u-3', roleId: 'r-pm' }, { userId: 'u-4', roleId: 'r-member' }, { userId: 'u-2', roleId: 'r-approver' }],
    allowedTypeIds: ['t-feature', 't-task', 't-milestone'], defaultTypeId: 't-feature', repositories: [],
  }, 10),
  meta('p-mail', {
    code: 'MAIL', name: 'ترحيل البريد المؤسسي', description: 'ترحيل صناديق البريد إلى المنصة الجديدة.',
    ownerId: 'u-2', statusId: 'ps-completed', startDate: daysFromNow(-160), endDate: daysFromNow(-20), archived: true,
    members: [{ userId: 'u-2', roleId: 'r-pm' }, { userId: 'u-4', roleId: 'r-member' }],
    allowedTypeIds: ['t-task', 't-bug'], defaultTypeId: 't-task', repositories: [],
  }, 160),
];

// ---------- Work items ----------

interface ItemSeed {
  n: number;
  type: string;
  title: string;
  status: string;
  priority: Priority;
  assignees: string[];
  due: number | null;
  parent?: number;
  fields?: WorkItem['fields'];
  description?: string;
}

function items(project: string, code: string, seeds: ItemSeed[]): WorkItem[] {
  return seeds.map((s) =>
    meta(`${project}-wi-${s.n}`, {
      ref: `${code}-${100 + s.n}`, projectId: project, typeId: s.type, title: s.title,
      description: s.description ?? 'وصف تفصيلي للعمل المطلوب ومعايير القبول.',
      statusId: s.status, priority: s.priority, assigneeIds: s.assignees,
      startDate: s.due === null ? null : daysFromNow(s.due - 14), dueDate: s.due === null ? null : daysFromNow(s.due),
      parentId: s.parent ? `${project}-wi-${s.parent}` : null, fields: s.fields ?? {}, archived: false, createdBy: 'u-2',
    }, 40 - s.n),
  );
}

export const WORK_ITEMS: WorkItem[] = [
  ...items('p-erp', 'ERP', [
    { n: 1, type: 't-milestone', title: 'إطلاق وحدة المشتريات', status: 's-progress', priority: 'high', assignees: ['u-2'], due: 30 },
    { n: 2, type: 't-feature', title: 'طلبات الشراء متعددة المراحل', status: 's-progress', priority: 'high', assignees: ['u-5'], due: 20, parent: 1, fields: { business_value: 'high', target_release: '2026.Q4' } },
    { n: 3, type: 't-task', title: 'تصميم شاشة إنشاء طلب الشراء', status: 's-completed', priority: 'medium', assignees: ['u-4'], due: -5, parent: 2, fields: { estimate_hours: 16 } },
    { n: 4, type: 't-task', title: 'ربط طلب الشراء بسير الموافقات', status: 's-progress', priority: 'high', assignees: ['u-4', 'u-5'], due: 6, parent: 2, fields: { estimate_hours: 24 } },
    { n: 5, type: 't-bug', title: 'خطأ في احتساب ضريبة القيمة المضافة', status: 's-review', priority: 'critical', assignees: ['u-4'], due: -2, parent: 2, fields: { severity: 'blocker', environment: 'staging', reproducible: true } },
    { n: 6, type: 't-subtask', title: 'اختبارات الوحدة لمحرك الضريبة', status: 's-pending', priority: 'medium', assignees: [], due: 8, parent: 4 },
    { n: 7, type: 't-feature', title: 'إدارة الموردين', status: 's-pending', priority: 'medium', assignees: ['u-5'], due: 45, parent: 1, fields: { business_value: 'medium' } },
    { n: 8, type: 't-task', title: 'نموذج تسجيل مورد جديد', status: 's-pending', priority: 'medium', assignees: [], due: 35, parent: 7 },
    { n: 9, type: 't-task', title: 'ترحيل بيانات الموردين القديمة', status: 's-blocked', priority: 'high', assignees: ['u-4'], due: -1, parent: 7, fields: { estimate_hours: 30 } },
    { n: 10, type: 't-bug', title: 'تعذّر رفع مرفقات بحجم كبير', status: 's-progress', priority: 'medium', assignees: ['u-4'], due: 4, fields: { severity: 'major', environment: 'production' } },
    { n: 11, type: 't-task', title: 'توثيق واجهات API للمخزون', status: 's-completed', priority: 'low', assignees: ['u-5'], due: -10 },
    { n: 12, type: 't-task', title: 'تحسين أداء تقرير المخزون', status: 's-review', priority: 'medium', assignees: ['u-4'], due: 2 },
  ]),
  ...items('p-ssp', 'SSP', [
    { n: 1, type: 't-feature', title: 'طلب إجازة إلكتروني', status: 's-progress', priority: 'high', assignees: ['u-5'], due: 15, fields: { business_value: 'high' } },
    { n: 2, type: 't-task', title: 'نموذج الطلب والتحقق من الرصيد', status: 's-completed', priority: 'high', assignees: ['u-5'], due: -3, parent: 1 },
    { n: 3, type: 't-task', title: 'إشعارات البريد للمدير المباشر', status: 's-progress', priority: 'medium', assignees: ['u-5'], due: 5, parent: 1 },
    { n: 4, type: 't-bug', title: 'اتجاه التاريخ معكوس في التقويم', status: 's-pending', priority: 'low', assignees: [], due: 12, parent: 1, fields: { severity: 'minor' } },
    { n: 5, type: 't-feature', title: 'شهادة تعريف بالراتب', status: 's-pending', priority: 'medium', assignees: [], due: 30, fields: { business_value: 'medium' } },
  ]),
  ...items('p-bi', 'BI', [
    { n: 1, type: 't-milestone', title: 'النموذج الأولي للوحة الإدارة', status: 's-pending', priority: 'high', assignees: ['u-3'], due: 60 },
    { n: 2, type: 't-feature', title: 'مؤشرات الأداء المالية', status: 's-pending', priority: 'high', assignees: ['u-4'], due: 50, parent: 1, fields: { business_value: 'high' } },
    { n: 3, type: 't-task', title: 'تحليل مصادر البيانات', status: 's-progress', priority: 'medium', assignees: ['u-4'], due: 20, parent: 2 },
  ]),
  ...items('p-mail', 'MAIL', [
    { n: 1, type: 't-task', title: 'ترحيل صناديق الإدارة العليا', status: 's-completed', priority: 'high', assignees: ['u-4'], due: -40 },
    { n: 2, type: 't-task', title: 'ترحيل الصناديق المشتركة', status: 's-completed', priority: 'medium', assignees: ['u-4'], due: -25 },
  ]),
];

export const RELATIONS: WorkItemRelation[] = [
  meta('rel-1', { sourceId: 'p-erp-wi-9', targetId: 'p-erp-wi-8', relationTypeId: 'rt-blocks', createdBy: 'u-2' }, 10),
  meta('rel-2', { sourceId: 'p-erp-wi-5', targetId: 'p-erp-wi-4', relationTypeId: 'rt-blocks', createdBy: 'u-2' }, 8),
  meta('rel-3', { sourceId: 'p-erp-wi-10', targetId: 'p-erp-wi-4', relationTypeId: 'rt-relates', createdBy: 'u-4' }, 6),
  meta('rel-4', { sourceId: 'p-ssp-wi-4', targetId: 'p-ssp-wi-2', relationTypeId: 'rt-relates', createdBy: 'u-5' }, 3),
];

// ---------- Approvals ----------

export const APPROVAL_TEMPLATES: ApprovalTemplate[] = [
  meta('tpl-project', {
    name: 'اعتماد مشروع جديد', event: 'project.approve', active: true, protectedFields: ['name', 'startDate', 'endDate', 'ownerId'],
    rule: { actions: ['activate'] },
    stages: [
      { order: 1, name: 'المسؤول المباشر', approverKind: 'user', approverId: 'u-3' },
      { order: 2, name: 'مدير المشروع', approverKind: 'role', approverId: 'r-pm' },
      { order: 3, name: 'الاعتماد النهائي', approverKind: 'user', approverId: 'u-1' },
    ],
  }, 120),
  meta('tpl-task', {
    name: 'اعتماد إنجاز مهمة', event: 'workItem.approve', active: true, protectedFields: ['title', 'dueDate', 'parentId'],
    rule: { workItemTypeIds: ['t-task', 't-feature', 't-bug'], actions: ['close', 'reopen'] },
    stages: [
      { order: 1, name: 'المشرف التقني', approverKind: 'role', approverId: 'r-approver' },
      { order: 2, name: 'مدير المشروع', approverKind: 'role', approverId: 'r-pm' },
    ],
  }, 120),
  meta('tpl-close', {
    name: 'إغلاق مشروع', event: 'project.close', active: true, protectedFields: ['endDate'],
    rule: { actions: ['close'] },
    stages: [
      { order: 1, name: 'مدير المشروع', approverKind: 'role', approverId: 'r-pm' },
      { order: 2, name: 'الاعتماد النهائي', approverKind: 'user', approverId: 'u-1' },
    ],
  }, 120),
  meta('tpl-sensitive-task', {
    name: 'تعديل حساس على مهمة حرجة', event: 'sensitive.change', active: true, protectedFields: ['title', 'dueDate', 'parentId', 'priority'],
    rule: { workItemTypeIds: ['t-task'], priorities: ['critical'], actions: ['change'], priority: 10 },
    stages: [{ order: 1, name: 'مدير المشروع', approverKind: 'role', approverId: 'r-pm', dueHours: 48 }],
  }, 100),
  meta('tpl-sensitive-project', {
    name: 'تعديل حساس على مشروع فعّال', event: 'sensitive.change', active: true, protectedFields: ['name', 'startDate', 'endDate', 'ownerId'],
    rule: { actions: ['change'], conditions: [{ field: 'statusId', op: 'eq', value: 'ps-active' }] },
    stages: [{ order: 1, name: 'الاعتماد النهائي', approverKind: 'user', approverId: 'u-1' }],
  }, 100),
];

export const DELEGATIONS: Delegation[] = [];

function sha(prefix: string): string {
  return prefix.padEnd(40, '0');
}

/** What each Git server holds. Some commits were delivered by webhook (seed GIT_EVENTS), others were missed and only a manual sync recovers them. */
export const REMOTE_COMMITS: Record<string, RemoteCommit[]> = {
  'repo-1': [
    { sha: sha('9f3c2ab'), message: 'ERP-104 ربط نموذج الطلب بمسار الموافقة', branch: 'feature/ERP-104-approval', author: 'fahad', url: 'https://git.example.local/erp/web-client/commit/9f3c2ab' },
    { sha: sha('3d5e7f1'), message: 'ERP-106 إضافة التحقق من الكميات', branch: 'feature/ERP-106', author: 'fahad', url: 'https://git.example.local/erp/web-client/commit/3d5e7f1' },
    { sha: sha('a8b9c0d'), message: 'تحديث الاعتماديات', branch: 'main', author: 'reem', url: 'https://git.example.local/erp/web-client/commit/a8b9c0d' },
    { sha: sha('4e6f8a2'), message: 'تنسيق الشيفرة', branch: 'main', author: 'fahad', url: 'https://git.example.local/erp/web-client/commit/4e6f8a2' },
  ],
  'repo-2': [
    { sha: sha('f0a1b2c'), message: 'ERP-111 توثيق رموز الأخطاء', branch: 'docs/ERP-111', author: 'reem', url: 'https://git.example.local/erp/api/commit/f0a1b2c' },
    { sha: sha('a3c5e7f'), message: 'إصلاح مهلة الاتصال بقاعدة البيانات', branch: 'main', author: 'fahad', url: 'https://git.example.local/erp/api/commit/a3c5e7f' },
    { sha: sha('b71c0aa'), message: 'ERP-109 سكربت ترحيل الموردين', branch: 'feature/ERP-109', author: 'fahad', url: 'https://git.example.local/erp/api/commit/b71c0aa' },
  ],
  'repo-3': [
    { sha: sha('55aa013'), message: 'SSP-103 قالب إشعار المدير', branch: 'feature/SSP-103', author: 'reem', url: 'https://git.example.local/ssp/portal/commit/55aa013' },
    { sha: sha('c0de123'), message: 'SSP-104 إصلاح اتجاه التقويم', branch: 'bugfix/SSP-104', author: 'reem', url: 'https://git.example.local/ssp/portal/commit/c0de123' },
    { sha: sha('d00d456'), message: 'تحديث ملف README', branch: 'develop', author: 'reem', url: 'https://git.example.local/ssp/portal/commit/d00d456' },
  ],
};

export const APPROVAL_REQUESTS: ApprovalRequest[] = [
  meta('apr-1', {
    templateId: 'tpl-project', subjectType: 'project', subjectId: 'p-bi', projectId: 'p-bi', title: 'اعتماد مشروع: منصة البيانات والتقارير',
    requesterId: 'u-2', status: 'PendingApproval', currentStage: 1, revision: 1,
    snapshot: { name: 'منصة البيانات والتقارير', startDate: daysFromNow(10), endDate: daysFromNow(150), ownerId: 'نورة القحطاني' },
    decisions: [], stages: APPROVAL_TEMPLATES[0].stages,
  }, 2),
  meta('apr-2', {
    templateId: 'tpl-task', subjectType: 'workItem', subjectId: 'p-erp-wi-3', projectId: 'p-erp', title: 'اعتماد إنجاز: ERP-103 تصميم شاشة إنشاء طلب الشراء',
    requesterId: 'u-4', status: 'PendingApproval', currentStage: 2, revision: 1,
    snapshot: { title: 'تصميم شاشة إنشاء طلب الشراء', dueDate: daysFromNow(-5), parentId: 'ERP-102' },
    decisions: [{ stageOrder: 1, deciderId: 'u-3', decision: 'Approve', comment: 'التصميم مطابق للهوية المعتمدة.', at: ago(1), revision: 1 }],
    stages: APPROVAL_TEMPLATES[1].stages,
  }, 3),
  meta('apr-3', {
    templateId: 'tpl-task', subjectType: 'workItem', subjectId: 'p-ssp-wi-2', projectId: 'p-ssp', title: 'اعتماد إنجاز: SSP-102 نموذج الطلب والتحقق من الرصيد',
    requesterId: 'u-5', status: 'Approved', currentStage: 0, revision: 1,
    snapshot: { title: 'نموذج الطلب والتحقق من الرصيد', dueDate: daysFromNow(-3), parentId: 'SSP-101' },
    decisions: [
      { stageOrder: 1, deciderId: 'u-3', decision: 'Approve', comment: 'تم التحقق.', at: ago(4), revision: 1 },
      { stageOrder: 2, deciderId: 'u-2', decision: 'Approve', comment: 'معتمد.', at: ago(3), revision: 1 },
    ],
    stages: APPROVAL_TEMPLATES[1].stages,
  }, 6),
  meta('apr-4', {
    templateId: 'tpl-task', subjectType: 'workItem', subjectId: 'p-erp-wi-11', projectId: 'p-erp', title: 'اعتماد إنجاز: ERP-111 توثيق واجهات API للمخزون',
    requesterId: 'u-5', status: 'Rejected', currentStage: 0, revision: 1,
    snapshot: { title: 'توثيق واجهات API للمخزون', dueDate: daysFromNow(-10), parentId: null },
    decisions: [{ stageOrder: 1, deciderId: 'u-3', decision: 'Reject', comment: 'التوثيق لا يغطي رموز الأخطاء.', at: ago(8), revision: 1 }],
    stages: APPROVAL_TEMPLATES[1].stages,
  }, 9),
];

// ---------- Collaboration, audit, git, notifications ----------

export const COMMENTS: Comment[] = [
  meta('c-1', { subjectType: 'workItem', subjectId: 'p-erp-wi-4', authorId: 'u-5', body: 'تم الاتفاق مع فريق المالية على أن تكون الموافقة على ثلاث مراحل.', edited: false, deleted: false, revisions: [] }, 3),
  meta('c-2', { subjectType: 'workItem', subjectId: 'p-erp-wi-4', authorId: 'u-4', body: 'بانتظار إصلاح خطأ الضريبة ERP-105 قبل الدمج.', edited: false, deleted: false, revisions: [] }, 1),
  meta('c-3', { subjectType: 'project', subjectId: 'p-erp', authorId: 'u-2', body: 'اجتماع المراجعة الأسبوعي يوم الأحد الساعة العاشرة.', edited: true, deleted: false, revisions: [] }, 5),
];

/** Hash chain fields are added when the database is built (see `MockDatabase`). */
export const AUDIT_EVENTS: Omit<AuditEvent, 'prevHash' | 'hash'>[] = [
  meta('a-1', { actorId: 'u-2', action: 'project.created', subjectType: 'project', subjectId: 'p-bi', subjectLabel: 'منصة البيانات والتقارير', projectId: 'p-bi', at: ago(10), changes: [], source: 'ui', correlationId: 'c0a1', security: false }, 10),
  meta('a-2', { actorId: 'u-2', action: 'approval.submitted', subjectType: 'approval', subjectId: 'apr-1', subjectLabel: 'اعتماد مشروع: منصة البيانات والتقارير', projectId: 'p-bi', at: ago(2), changes: [], source: 'ui', correlationId: 'c0a2', security: false }, 2),
  meta('a-3', { actorId: 'u-4', action: 'workItem.transition', subjectType: 'workItem', subjectId: 'p-erp-wi-5', subjectLabel: 'ERP-105', projectId: 'p-erp', at: ago(1, 3), changes: [{ field: 'الحالة', from: 'قيد التنفيذ', to: 'قيد المراجعة' }], source: 'ui', correlationId: 'c0a3', security: false }, 1),
  meta('a-4', { actorId: 'u-3', action: 'approval.decided', subjectType: 'approval', subjectId: 'apr-2', subjectLabel: 'اعتماد إنجاز: ERP-103', projectId: 'p-erp', at: ago(1), changes: [{ field: 'القرار', from: null, to: 'موافقة' }], source: 'ui', correlationId: 'c0a4', security: false }, 1),
  meta('a-5', { actorId: 'u-4', action: 'git.push', subjectType: 'git', subjectId: 'g-1', subjectLabel: 'erp/web-client', projectId: 'p-erp', at: ago(0, 4), changes: [], source: 'webhook', correlationId: 'c0a5', security: false }, 0),
  meta('a-6', { actorId: 'u-6', action: 'auth.login_failed', subjectType: 'user', subjectId: 'u-6', subjectLabel: 'abdullah', projectId: null, at: ago(0, 6), changes: [], source: 'api', correlationId: 'c0a6', security: true }, 0),
  meta('a-7', { actorId: 'u-1', action: 'role.updated', subjectType: 'role', subjectId: 'r-member', subjectLabel: 'عضو فريق', projectId: null, at: ago(4), changes: [{ field: 'الأذونات', from: '14 إذنًا', to: '15 إذنًا' }], source: 'ui', correlationId: 'c0a7', security: true }, 4),
  meta('a-8', { actorId: 'u-5', action: 'comment.created', subjectType: 'workItem', subjectId: 'p-erp-wi-4', subjectLabel: 'ERP-104', projectId: 'p-erp', at: ago(3), changes: [], source: 'ui', correlationId: 'c0a8', security: false }, 3),
];

export const GIT_EVENTS: GitEvent[] = [
  meta('g-1', { projectId: 'p-erp', repositoryId: 'repo-1', kind: 'push', title: 'ERP-104 ربط نموذج الطلب بمسار الموافقة', branch: 'feature/ERP-104-approval', sha: '9f3c2ab', author: 'fahad', url: 'https://git.example.local/erp/web-client/commit/9f3c2ab', workItemRefs: ['ERP-104'] }, 0),
  meta('g-2', { projectId: 'p-erp', repositoryId: 'repo-1', kind: 'pull_request', prNumber: 42, prState: 'open', title: 'ERP-105 إصلاح تقريب الضريبة', branch: 'fix/ERP-105-vat', sha: '1b77e0d', author: 'fahad', url: 'https://git.example.local/erp/web-client/pulls/42', workItemRefs: ['ERP-105'] }, 1),
  meta('g-3', { projectId: 'p-erp', repositoryId: 'repo-2', kind: 'merge', prNumber: 17, prState: 'merged', title: 'دمج توثيق ERP-111', branch: 'main', sha: 'c41d9e2', author: 'reem', url: 'https://git.example.local/erp/api/pulls/17', workItemRefs: ['ERP-111'] }, 9),
  meta('g-4', { projectId: 'p-ssp', repositoryId: 'repo-3', kind: 'push', title: 'SSP-103 قالب إشعار المدير', branch: 'feature/SSP-103', sha: '55aa013', author: 'reem', url: 'https://git.example.local/ssp/portal/commit/55aa013', workItemRefs: ['SSP-103'] }, 0),
];

export const NOTIFICATIONS: Notification[] = [
  meta('n-1', { userId: 'u-3', title: 'طلب موافقة بانتظارك', body: 'اعتماد مشروع: منصة البيانات والتقارير', link: '/approvals/apr-1', read: false }, 2),
  meta('n-2', { userId: 'u-2', title: 'طلب موافقة بانتظارك', body: 'اعتماد إنجاز: ERP-103', link: '/approvals/apr-2', read: false }, 1),
  meta('n-3', { userId: 'u-4', title: 'تم تكليفك بعنصر عمل', body: 'ERP-109 ترحيل بيانات الموردين القديمة', link: '/work-items/p-erp-wi-9', read: false }, 2),
  meta('n-4', { userId: 'u-1', title: 'محاولة دخول مرفوضة', body: 'الحساب abdullah', link: '/audit', read: false }, 0),
  meta('n-5', { userId: 'u-2', title: 'تعليق جديد', body: 'فهد الدوسري علّق على ERP-104', link: '/work-items/p-erp-wi-4', read: true }, 1),
];

export const ATTACHMENTS: Attachment[] = [
  meta('f-1', { subjectType: 'project', subjectId: 'p-erp', projectId: 'p-erp', fileName: 'نطاق-المشروع.pdf', size: 482_133, contentType: 'application/pdf', uploadedBy: 'u-2', deleted: false }, 20),
  meta('f-2', { subjectType: 'workItem', subjectId: 'p-erp-wi-3', projectId: 'p-erp', fileName: 'purchase-request-mockup.png', size: 1_204_551, contentType: 'image/png', uploadedBy: 'u-4', deleted: false }, 6),
  meta('f-3', { subjectType: 'workItem', subjectId: 'p-erp-wi-5', projectId: 'p-erp', fileName: 'vat-calculation.xlsx', size: 38_912, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', uploadedBy: 'u-5', deleted: false }, 2),
];

export const SETTINGS: SystemSettings[] = [meta('settings', { ...DEFAULT_SETTINGS }, 200)];

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  meta('ptpl-software', {
    name: 'مشروع تطوير برمجي', description: 'ميزات ومهام وأخطاء ومعالم، يبدأ قيد الإعداد ويحتاج اعتمادًا للتفعيل.', active: true,
    allowedTypeIds: ['t-feature', 't-task', 't-bug', 't-subtask', 't-milestone'], defaultTypeId: 't-task', initialStatusId: 'ps-pending',
    suggestedRoleIds: ['r-pm', 'r-approver', 'r-member'], durationDays: 120,
  }, 150),
  meta('ptpl-ops', {
    name: 'مشروع تشغيلي', description: 'مهام وأخطاء فقط لمشاريع التشغيل والدعم القصيرة.', active: true,
    allowedTypeIds: ['t-task', 't-bug'], defaultTypeId: 't-task', initialStatusId: 'ps-pending',
    suggestedRoleIds: ['r-pm', 'r-member'], durationDays: 45,
  }, 150),
];

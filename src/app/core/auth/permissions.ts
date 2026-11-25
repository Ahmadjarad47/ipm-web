/**
 * Stable permission keys (SRS §2.3). Keys are fixed in code; *who* holds them is dynamic
 * and configured from the admin panel.
 */
export const PERMISSION_GROUPS = {
  projects: ['projects.view', 'projects.create', 'projects.edit', 'projects.archive', 'projects.members.manage'],
  tasks: ['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.delete'],
  workflow: ['statuses.manage', 'workflows.manage', 'workflow.transition'],
  approvals: ['approvals.request', 'approvals.view', 'approvals.decide', 'approvals.configure', 'approvals.override'],
  collaboration: ['comments.create', 'comments.edit_own', 'files.upload', 'files.download', 'files.delete'],
  integration: ['git.view', 'git.manage', 'git.sync'],
  security: ['roles.manage', 'permissions.assign', 'audit.view', 'audit.export', 'audit.override', 'settings.manage'],
  reporting: ['dashboard.view', 'reports.view', 'reports.export'],
  workItemTypes: [
    'workitem.types.view',
    'workitem.types.manage',
    'workitem.fields.manage',
    'project.workitemtypes.configure',
  ],
  relationships: [
    'workitem.relations.view',
    'workitem.relations.create',
    'workitem.relations.delete',
    'workitem.relationtypes.manage',
  ],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type PermissionKey = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSION_GROUPS).flat();

export const PERMISSION_GROUP_LABELS: Record<PermissionGroup, string> = {
  projects: 'المشاريع',
  tasks: 'المهام',
  workflow: 'سير العمل',
  approvals: 'الموافقات',
  collaboration: 'التعاون',
  integration: 'تكامل Git',
  security: 'الأمن والتدقيق',
  reporting: 'التقارير',
  workItemTypes: 'أنواع العناصر',
  relationships: 'العلاقات',
};

/** System = global grant; Project = only inside projects where the user is a member with that role. */
export type PermissionScope = 'system' | 'project';

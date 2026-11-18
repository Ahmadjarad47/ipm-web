import { FieldChange } from '@domain/activity/activity.models';
import { Project, ProjectSummary } from '@domain/projects/project.models';
import { TransitionRecord } from '@domain/workflow/workflow.models';
import { MockDatabase } from '../../db/database';
import { failIfConflicts } from '../definitions';
import { body, fail, MockRouter } from '../router';
import { isOverdue, projectProgress } from './projects.handlers';

function summary(db: MockDatabase, project: Project): ProjectSummary {
  const items = db.workItems.where((w) => w.projectId === project.id && !w.archived);
  return { ...project, progress: projectProgress(db, project.id), workItemCount: items.length, overdueCount: items.filter((w) => isOverdue(db, w)).length };
}

/** Status history (FR-WF-08) and per-project workflow overrides (FR-WF-10). */
export function registerWorkflowExtras(router: MockRouter, db: MockDatabase): void {
  router
    .get('transitions/by-subject', (req, ctx) => {
      const subjectType = req.query.get('subjectType');
      const subjectId = req.query.get('subjectId') ?? '';
      let projectId: string;
      if (subjectType === 'workItem') {
        projectId = db.workItems.get(subjectId).projectId;
        ctx.requireProjectVisible(projectId);
        ctx.require('tasks.view', projectId);
      } else if (subjectType === 'project') {
        projectId = db.projects.get(subjectId).id;
        ctx.requireProjectVisible(projectId);
        ctx.require('projects.view', projectId);
      } else {
        return fail(400, 'نوع الموضوع غير صالح.', { subjectType: 'workItem أو project' });
      }
      return db.transitions.where((t: TransitionRecord) => t.subjectType === subjectType && t.itemId === subjectId);
    })
    .post('projects/:id/workflow-overrides', (req, ctx) => {
      const projectId = req.params['id'];
      ctx.requireProjectVisible(projectId);
      ctx.require('workflows.manage');
      ctx.require('project.workitemtypes.configure', projectId);
      const project = db.projects.get(projectId);
      if (project.archived) fail(422, 'المشروع مؤرشف ولا يمكن تعديله.');
      const { overrides, version } = body<{ overrides?: Record<string, string>; version?: number }>(req);
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail(400, 'قائمة الاستثناءات مطلوبة.', { overrides: 'مطلوب' });

      const errors: Record<string, string> = {};
      const normalized: Record<string, string> = {};
      for (const [typeId, workflowId] of Object.entries(overrides)) {
        const type = db.types.find(typeId);
        const workflow = db.workflows.find(workflowId);
        if (!type) errors[typeId] = 'نوع غير موجود';
        else if (!workflow || workflow.scope !== 'workItem') errors[typeId] = 'سير عمل غير موجود أو ليس لعناصر العمل';
        else if (workflow.id !== type.workflowId) normalized[typeId] = workflow.id; // same as the type's own workflow = no override
      }
      if (Object.keys(errors).length) fail(400, 'استثناءات سير العمل غير صالحة.', errors);

      // Every existing item must keep a status that exists in the workflow that will apply to it.
      const next: Project = { ...project, workflowOverrides: normalized };
      const conflicts: Record<string, string> = {};
      for (const item of db.workItems.where((w) => w.projectId === projectId && !w.archived)) {
        const target = db.workflows.get(normalized[item.typeId] ?? db.types.get(item.typeId).workflowId);
        if (!target.statusIds.includes(item.statusId)) {
          const key = `${db.types.get(item.typeId).name} / ${db.statuses.find(item.statusId)?.name ?? item.statusId}`;
          conflicts[key] = String(Number(conflicts[key] ?? 0) + 1);
        }
      }
      failIfConflicts('لا يمكن تطبيق الاستثناء: عناصر قائمة في حالات غير موجودة في سير العمل الجديد.', conflicts);

      const name = (workflowId: string | undefined): string => (workflowId ? db.workflows.find(workflowId)?.name ?? workflowId : 'سير عمل النوع الافتراضي');
      const diff: FieldChange[] = [];
      for (const type of db.types.all()) {
        const before = project.workflowOverrides?.[type.id];
        const after = next.workflowOverrides?.[type.id];
        if (before !== after) diff.push({ field: `سير عمل «${type.name}»`, from: name(before), to: name(after) });
      }
      const saved = db.projects.patch(projectId, { workflowOverrides: normalized }, version);
      if (diff.length) db.log(ctx.me, 'project.workflowOverrides', { type: 'project', id: project.id, label: project.code, projectId: project.id }, diff);
      return summary(db, saved);
    });
}

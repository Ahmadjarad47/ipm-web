import { FieldChange } from '@domain/activity/activity.models';
import { FIELD_TYPES, FieldDefinition, RelationType, WORK_ITEM_ICON_NAMES, WorkItem, WorkItemType } from '@domain/work-items/work-item.models';
import { STATUS_CATEGORIES, STATUS_CATEGORY_LABELS, Status, Transition, Workflow } from '@domain/workflow/workflow.models';
import { MockDatabase } from '../db/database';
import { fail } from './router';

// ---------- Shared helpers ----------

const TYPE_KEY = /^[a-z][a-z0-9_]{1,30}$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const yesNo = (b: boolean | undefined): string => (b ? 'نعم' : 'لا');
const blank = (v: unknown): boolean => typeof v !== 'string' || !v.trim();

/** Project override ?? the type's own workflow: the single source of truth for "which workflow applies" (FR-WF-10). */
export function effectiveWorkflowId(db: MockDatabase, projectId: string, typeId: string): string {
  return db.projects.find(projectId)?.workflowOverrides?.[typeId] ?? db.types.get(typeId).workflowId;
}

export function effectiveWorkflow(db: MockDatabase, projectId: string, typeId: string): Workflow {
  return db.workflows.get(effectiveWorkflowId(db, projectId, typeId));
}

/** Non-archived items whose effective workflow is `workflowId`. */
export function itemsOnWorkflow(db: MockDatabase, workflowId: string): WorkItem[] {
  return db.workItems.where((w) => !w.archived && effectiveWorkflowId(db, w.projectId, w.typeId) === workflowId);
}

/** `{statusName: count}` for items sitting in a status outside `allowed`. */
export function statusConflicts(db: MockDatabase, items: readonly WorkItem[], allowed: readonly string[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (allowed.includes(item.statusId)) continue;
    const name = db.statuses.find(item.statusId)?.name ?? item.statusId;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].map(([name, n]) => [name, String(n)]));
}

export function failIfConflicts(message: string, conflicts: Record<string, string>): void {
  if (Object.keys(conflicts).length) fail(422, message, conflicts);
}

function throwIfErrors(message: string, errors: Record<string, string>): void {
  if (Object.keys(errors).length) fail(400, message, errors);
}

const sameKey = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

// ---------- Work item types ----------

function validateField(def: FieldDefinition, index: number, seen: Set<string>, errors: Record<string, string>): void {
  const at = `fields[${index}]`;
  if (typeof def.key !== 'string' || !FIELD_KEY.test(def.key)) errors[`${at}.key`] = 'مفتاح الحقل: أحرف إنجليزية صغيرة وأرقام و_ ويبدأ بحرف';
  else if (seen.has(def.key)) errors[`${at}.key`] = `مفتاح الحقل «${def.key}» مكرر`;
  else seen.add(def.key);
  if (blank(def.label)) errors[`${at}.label`] = 'اسم الحقل مطلوب';
  if (!FIELD_TYPES.includes(def.type)) errors[`${at}.type`] = 'نوع الحقل غير مسموح';
  if (def.type === 'select') {
    const options = def.options ?? [];
    const values = new Set<string>();
    if (!options.length) errors[`${at}.options`] = 'حقل الاختيار يتطلب خيارًا واحدًا على الأقل';
    for (const o of options) {
      if (blank(o.value) || blank(o.label)) errors[`${at}.options`] = 'قيمة الخيار واسمه مطلوبان';
      else if (values.has(o.value)) errors[`${at}.options`] = `قيمة الخيار «${o.value}» مكررة`;
      values.add(o.value);
    }
  }
  if (def.min !== undefined && typeof def.min !== 'number') errors[`${at}.min`] = 'قيمة رقمية مطلوبة';
  if (def.max !== undefined && typeof def.max !== 'number') errors[`${at}.max`] = 'قيمة رقمية مطلوبة';
  if (typeof def.min === 'number' && typeof def.max === 'number' && def.min > def.max) errors[`${at}.max`] = 'الحد الأعلى يجب ألا يقل عن الحد الأدنى';
  for (const flag of ['showInList', 'showOnCard'] as const) {
    if (def[flag] !== undefined && typeof def[flag] !== 'boolean') errors[`${at}.${flag}`] = 'قيمة منطقية مطلوبة';
  }
  if (def.order !== undefined && (!Number.isInteger(def.order) || def.order < 0)) errors[`${at}.order`] = 'ترتيب العرض عدد صحيح غير سالب';
}

export function validateType(db: MockDatabase, row: WorkItemType, current?: WorkItemType): void {
  const errors: Record<string, string> = {};
  if (typeof row.key !== 'string' || !TYPE_KEY.test(row.key)) errors['key'] = 'المفتاح: أحرف إنجليزية صغيرة وأرقام و_ (2–31 حرفًا) ويبدأ بحرف';
  else if (db.types.where((t) => t.id !== row.id && sameKey(t.key, row.key)).length) errors['key'] = 'المفتاح مستخدم لنوع آخر';
  if (blank(row.name)) errors['name'] = 'الاسم مطلوب';
  if (typeof row.color !== 'string' || !COLOR.test(row.color)) errors['color'] = 'لون بصيغة #rrggbb';
  if (!WORK_ITEM_ICON_NAMES.includes(row.icon)) errors['icon'] = 'أيقونة غير مسموحة';
  const workflow = db.workflows.find(row.workflowId);
  if (!workflow || workflow.scope !== 'workItem') errors['workflowId'] = 'سير عمل غير موجود أو ليس لعناصر العمل';
  if (!Array.isArray(row.allowedChildTypeIds)) errors['allowedChildTypeIds'] = 'قائمة غير صالحة';
  else if (row.allowedChildTypeIds.some((id) => id !== row.id && !db.types.find(id))) errors['allowedChildTypeIds'] = 'يتضمن نوعًا غير موجود';
  if (!Array.isArray(row.fields)) errors['fields'] = 'قائمة غير صالحة';
  else {
    const seen = new Set<string>();
    row.fields.forEach((def, i) => validateField(def, i, seen, errors));
  }
  throwIfErrors('بيانات نوع العمل غير صالحة.', errors);

  if (!current) return;
  // FR-TYP-09: a type that new projects default to cannot be switched off silently.
  if (current.active && !row.active) {
    const asDefault = db.projects.where((p) => p.defaultTypeId === current.id);
    if (asDefault.length) {
      fail(422, `لا يمكن تعطيل النوع: هو النوع الافتراضي في ${asDefault.length} مشروع.`, Object.fromEntries(asDefault.map((p) => [p.code, p.name])));
    }
  }
  // FR-TYP-05: moving to another workflow must not strand items in a status the target lacks.
  if (current.workflowId !== row.workflowId) {
    const target = db.workflows.get(row.workflowId);
    const affected = db.workItems.where((w) => !w.archived && w.typeId === current.id && effectiveWorkflowId(db, w.projectId, w.typeId) === current.workflowId);
    failIfConflicts(`لا يمكن ربط النوع بسير «${target.name}»: عناصر قائمة في حالات غير موجودة فيه.`, statusConflicts(db, affected, target.statusIds));
  }
}

// ---------- Statuses ----------

export function validateStatus(db: MockDatabase, row: Status, current?: Status): void {
  if (current && current.scope !== row.scope) fail(422, 'لا يمكن تغيير نطاق الحالة بعد إنشائها.', { scope: 'غير قابل للتغيير' });
  const errors: Record<string, string> = {};
  if (row.scope !== 'project' && row.scope !== 'workItem') errors['scope'] = 'نطاق غير صالح';
  if (typeof row.key !== 'string' || !TYPE_KEY.test(row.key)) errors['key'] = 'المفتاح: أحرف إنجليزية صغيرة وأرقام و_ (2–31 حرفًا) ويبدأ بحرف';
  else if (db.statuses.where((s) => s.id !== row.id && s.scope === row.scope && sameKey(s.key, row.key)).length) errors['key'] = 'المفتاح مستخدم لحالة أخرى في النطاق نفسه';
  if (blank(row.name)) errors['name'] = 'الاسم مطلوب';
  if (typeof row.color !== 'string' || !COLOR.test(row.color)) errors['color'] = 'لون بصيغة #rrggbb';
  if (!STATUS_CATEGORIES.includes(row.category)) errors['category'] = 'تصنيف غير صالح';
  throwIfErrors('بيانات الحالة غير صالحة.', errors);
  if (!current) return;
  if (current.scope !== row.scope) fail(422, 'لا يمكن تغيير نطاق الحالة بعد إنشائها.', { scope: 'غير قابل للتغيير' });
  if (current.active && !row.active) {
    const initialIn = db.workflows.where((w) => w.initialStatusId === current.id);
    if (initialIn.length) fail(422, 'لا يمكن تعطيل حالة ابتدائية لسير عمل.', Object.fromEntries(initialIn.map((w) => [w.name, 'حالة ابتدائية'])));
  }
}

// ---------- Workflows ----------

export function validateWorkflow(db: MockDatabase, row: Workflow, current?: Workflow): void {
  if (current && current.scope !== row.scope) fail(422, 'لا يمكن تغيير نطاق سير العمل بعد إنشائه.', { scope: 'غير قابل للتغيير' });
  const errors: Record<string, string> = {};
  if (typeof row.key !== 'string' || !TYPE_KEY.test(row.key)) errors['key'] = 'المفتاح: أحرف إنجليزية صغيرة وأرقام و_ (2–31 حرفًا) ويبدأ بحرف';
  else if (db.workflows.where((w) => w.id !== row.id && sameKey(w.key, row.key)).length) errors['key'] = 'المفتاح مستخدم لسير عمل آخر';
  if (blank(row.name)) errors['name'] = 'الاسم مطلوب';
  if (row.scope !== 'project' && row.scope !== 'workItem') errors['scope'] = 'نطاق غير صالح';
  if (!Array.isArray(row.statusIds) || !row.statusIds.length) errors['statusIds'] = 'حالة واحدة على الأقل';
  else {
    if (new Set(row.statusIds).size !== row.statusIds.length) errors['statusIds'] = 'حالات مكررة';
    const bad = row.statusIds.filter((id) => db.statuses.find(id)?.scope !== row.scope);
    if (bad.length) errors['statusIds'] = 'حالات غير موجودة أو من نطاق مختلف عن سير العمل';
    if (!row.statusIds.includes(row.initialStatusId)) errors['initialStatusId'] = 'الحالة الابتدائية يجب أن تكون ضمن حالات سير العمل';
  }
  if (!Array.isArray(row.transitions)) errors['transitions'] = 'قائمة غير صالحة';
  else if (Array.isArray(row.statusIds)) {
    const seen = new Set<string>();
    for (const t of row.transitions) {
      const key = `${t.fromStatusId}>${t.toStatusId}`;
      if (!row.statusIds.includes(t.fromStatusId) || !row.statusIds.includes(t.toStatusId)) errors['transitions'] = 'انتقال يشير إلى حالة خارج سير العمل';
      else if (t.fromStatusId === t.toStatusId) errors['transitions'] = 'لا يُسمح بانتقال من الحالة إلى نفسها';
      else if (seen.has(key)) errors['transitions'] = 'انتقال مكرر';
      seen.add(key);
    }
  }
  throwIfErrors('بيانات سير العمل غير صالحة.', errors);
  if (!current) return;
  if (current.scope !== row.scope) fail(422, 'لا يمكن تغيير نطاق سير العمل بعد إنشائه.', { scope: 'غير قابل للتغيير' });
  // FR-WF-06/11: removing a status must not strand existing records.
  const removed = current.statusIds.filter((id) => !row.statusIds.includes(id));
  if (removed.length) {
    if (row.scope === 'workItem') {
      failIfConflicts('لا يمكن إزالة حالة عليها عناصر عمل نشطة.', statusConflicts(db, itemsOnWorkflow(db, current.id), row.statusIds));
    } else {
      const counts = new Map<string, number>();
      for (const p of db.projects.where((x) => removed.includes(x.statusId))) {
        const name = db.statuses.find(p.statusId)?.name ?? p.statusId;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      failIfConflicts('لا يمكن إزالة حالة عليها مشاريع.', Object.fromEntries([...counts].map(([k, n]) => [k, String(n)])));
    }
  }
}

// ---------- Relation types ----------

export function relationPairAllowed(rt: Pick<RelationType, 'allowedPairs' | 'directed'>, sourceTypeId: string, targetTypeId: string): boolean {
  const pairs = rt.allowedPairs;
  if (!pairs?.length) return true;
  const hit = (a: string, b: string): boolean => pairs.some((p) => p.sourceTypeId === a && p.targetTypeId === b);
  return hit(sourceTypeId, targetTypeId) || (!rt.directed && hit(targetTypeId, sourceTypeId));
}

export function validateRelationType(db: MockDatabase, row: RelationType, current?: RelationType): void {
  const errors: Record<string, string> = {};
  if (typeof row.key !== 'string' || !TYPE_KEY.test(row.key)) errors['key'] = 'المفتاح: أحرف إنجليزية صغيرة وأرقام و_ (2–31 حرفًا) ويبدأ بحرف';
  else if (db.relationTypes.where((r) => r.id !== row.id && sameKey(r.key, row.key)).length) errors['key'] = 'المفتاح مستخدم لنوع رابط آخر';
  if (blank(row.name)) errors['name'] = 'الاسم مطلوب';
  if (blank(row.inverseName)) errors['inverseName'] = 'الاسم العكسي مطلوب';
  else if (!row.directed && row.inverseName !== row.name) errors['inverseName'] = 'الرابط غير الموجّه يجب أن يكون اسمه العكسي مطابقًا لاسمه';
  if (typeof row.directed !== 'boolean') errors['directed'] = 'قيمة منطقية مطلوبة';
  if (row.allowedPairs !== undefined) {
    if (!Array.isArray(row.allowedPairs) || row.allowedPairs.some((p) => !db.types.find(p.sourceTypeId) || !db.types.find(p.targetTypeId))) {
      errors['allowedPairs'] = 'أزواج الأنواع تتضمن نوعًا غير موجود';
    }
  }
  throwIfErrors('بيانات نوع الرابط غير صالحة.', errors);
  if (!current) return;
  const used = db.relations.where((r) => r.relationTypeId === current.id);
  if (!used.length) return;
  // FR-REL-05: once links exist the semantics are frozen; renaming stays free.
  const locked = (['key', 'directed', 'acyclic'] as const).filter((k) => current[k] !== row[k]);
  if (locked.length) {
    fail(422, `نوع الرابط مستخدم في ${used.length} رابط؛ لا يمكن تغيير: ${locked.join('، ')}.`, Object.fromEntries(locked.map((k) => [k, 'مقفل بعد الاستخدام'])));
  }
  const conflicts: Record<string, string> = {};
  for (const rel of used) {
    const s = db.workItems.find(rel.sourceId);
    const t = db.workItems.find(rel.targetId);
    if (s && t && !relationPairAllowed(row, s.typeId, t.typeId)) conflicts[`${s.ref} → ${t.ref}`] = 'زوج الأنواع لم يعد مسموحًا';
  }
  failIfConflicts('لا يمكن تضييق الأزواج المسموحة: توجد روابط قائمة ستصبح غير صالحة.', conflicts);
}

// ---------- Impact (read-only preview) ----------

export interface Impact {
  readonly items: number;
  readonly projects: number;
  readonly workflows: number;
  readonly asDefaultIn: readonly { readonly id: string; readonly name: string }[];
}

export function typeImpact(db: MockDatabase, type: WorkItemType): Impact {
  return {
    items: db.workItems.where((w) => !w.archived && w.typeId === type.id).length,
    projects: db.projects.where((p) => p.allowedTypeIds.includes(type.id)).length,
    workflows: 1,
    asDefaultIn: db.projects.where((p) => p.defaultTypeId === type.id).map((p) => ({ id: p.id, name: p.name })),
  };
}

export function statusImpact(db: MockDatabase, status: Status): Impact {
  return {
    items: status.scope === 'workItem' ? db.workItems.where((w) => !w.archived && w.statusId === status.id).length : 0,
    projects: status.scope === 'project' ? db.projects.where((p) => p.statusId === status.id).length : 0,
    workflows: db.workflows.where((w) => w.statusIds.includes(status.id)).length,
    asDefaultIn: db.workflows.where((w) => w.initialStatusId === status.id).map((w) => ({ id: w.id, name: w.name })),
  };
}

// ---------- Audit diffs with readable Arabic labels (FR-TYP-10, FR-AUD-09) ----------

type Labelled<T> = Partial<Record<keyof T & string, { readonly label: string; readonly fmt?: (v: unknown) => string }>>;

function scalarChanges<T extends object>(current: T, next: T, spec: Labelled<T>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [key, def] of Object.entries(spec) as [string, { label: string; fmt?: (v: unknown) => string }][]) {
    const a = (current as Record<string, unknown>)[key];
    const b = (next as Record<string, unknown>)[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    const fmt = def.fmt ?? ((v: unknown) => String(v ?? ''));
    out.push({ field: def.label, from: a === undefined || a === null ? null : fmt(a), to: b === undefined || b === null ? null : fmt(b) });
  }
  return out;
}

const names = (lookup: (id: string) => string | undefined) => (v: unknown): string => ((v as readonly string[]) ?? []).map((id) => lookup(id) ?? id).join('، ') || '—';

function describeField(def: FieldDefinition): string {
  return `${def.label} (${def.type}${def.required ? '، مطلوب' : ''})`;
}

function fieldChanges(current: readonly FieldDefinition[], next: readonly FieldDefinition[]): FieldChange[] {
  const out: FieldChange[] = [];
  const before = new Map(current.map((f) => [f.key, f]));
  const after = new Map(next.map((f) => [f.key, f]));
  for (const [key, def] of after) {
    const old = before.get(key);
    if (!old) {
      out.push({ field: 'الحقول', from: null, to: `حقل مضاف: ${key} — ${describeField(def)}` });
      continue;
    }
    const parts: string[] = [];
    if (old.label !== def.label) parts.push(`التسمية: «${old.label}» ← «${def.label}»`);
    if (old.type !== def.type) parts.push(`النوع: ${old.type} ← ${def.type}`);
    if (old.required !== def.required) parts.push(`مطلوب: ${yesNo(old.required)} ← ${yesNo(def.required)}`);
    if (old.min !== def.min) parts.push(`الحد الأدنى: ${old.min ?? '—'} ← ${def.min ?? '—'}`);
    if (old.max !== def.max) parts.push(`الحد الأعلى: ${old.max ?? '—'} ← ${def.max ?? '—'}`);
    if (JSON.stringify(old.options ?? []) !== JSON.stringify(def.options ?? [])) {
      parts.push(`الخيارات: ${(old.options ?? []).map((o) => o.label).join('/') || '—'} ← ${(def.options ?? []).map((o) => o.label).join('/') || '—'}`);
    }
    if ((old.hint ?? '') !== (def.hint ?? '')) parts.push('النص الإرشادي');
    if (!!old.showInList !== !!def.showInList) parts.push(`الظهور في القائمة: ${yesNo(old.showInList)} ← ${yesNo(def.showInList)}`);
    if (!!old.showOnCard !== !!def.showOnCard) parts.push(`الظهور على البطاقة: ${yesNo(old.showOnCard)} ← ${yesNo(def.showOnCard)}`);
    if ((old.order ?? 0) !== (def.order ?? 0)) parts.push(`الترتيب: ${old.order ?? 0} ← ${def.order ?? 0}`);
    if (parts.length) out.push({ field: 'الحقول', from: `${key}`, to: `حقل معدّل: ${key} — ${parts.join('، ')}` });
  }
  for (const [key, def] of before) {
    if (!after.has(key)) out.push({ field: 'الحقول', from: `${key} — ${describeField(def)}`, to: `حقل محذوف: ${key}` });
  }
  return out;
}

export function typeChanges(db: MockDatabase, current: WorkItemType, next: WorkItemType): FieldChange[] {
  const typeName = (id: string): string | undefined => db.types.find(id)?.name;
  return [
    ...scalarChanges(current, next, {
      name: { label: 'الاسم' },
      description: { label: 'الوصف' },
      color: { label: 'اللون' },
      icon: { label: 'الأيقونة' },
      order: { label: 'الترتيب' },
      active: { label: 'التفعيل', fmt: (v) => (v ? 'مفعّل' : 'معطّل') },
      workflowId: { label: 'سير العمل', fmt: (v) => db.workflows.find(String(v))?.name ?? String(v) },
      allowedChildTypeIds: { label: 'الأنواع الفرعية المسموحة', fmt: names(typeName) },
    }),
    ...fieldChanges(current.fields, next.fields),
  ];
}

export function statusChanges(current: Status, next: Status): FieldChange[] {
  return scalarChanges(current, next, {
    name: { label: 'الاسم' },
    description: { label: 'الوصف' },
    color: { label: 'اللون' },
    category: { label: 'التصنيف', fmt: (v) => STATUS_CATEGORY_LABELS[v as Status['category']] ?? String(v) },
    order: { label: 'الترتيب' },
    active: { label: 'التفعيل', fmt: (v) => (v ? 'مفعّل' : 'معطّل') },
  });
}

const TRANSITION_FLAGS: readonly (readonly [keyof Transition & string, string])[] = [
  ['permission', 'الصلاحية'],
  ['requiresAssignee', 'يتطلب مسؤولًا'],
  ['requiresApproval', 'يتطلب موافقة'],
  ['blockedByOpenDependencies', 'يُمنع مع اعتماديات مفتوحة'],
];

export function workflowChanges(db: MockDatabase, current: Workflow, next: Workflow): FieldChange[] {
  const statusName = (id: string): string => db.statuses.find(id)?.name ?? id;
  const out = scalarChanges(current, next, {
    name: { label: 'الاسم' },
    initialStatusId: { label: 'الحالة الابتدائية', fmt: (v) => statusName(String(v)) },
  });
  for (const id of next.statusIds.filter((s) => !current.statusIds.includes(s))) out.push({ field: 'الحالات', from: null, to: `حالة مضافة: ${statusName(id)}` });
  for (const id of current.statusIds.filter((s) => !next.statusIds.includes(s))) out.push({ field: 'الحالات', from: statusName(id), to: 'حالة محذوفة' });
  const key = (t: Transition): string => `${t.fromStatusId}>${t.toStatusId}`;
  const label = (t: Transition): string => `${statusName(t.fromStatusId)} ← ${statusName(t.toStatusId)}`;
  const before = new Map(current.transitions.map((t) => [key(t), t]));
  const after = new Map(next.transitions.map((t) => [key(t), t]));
  for (const [k, t] of after) {
    const old = before.get(k);
    if (!old) {
      out.push({ field: 'الانتقالات', from: null, to: `انتقال مضاف: ${label(t)}` });
      continue;
    }
    const parts = TRANSITION_FLAGS.filter(([f]) => (old[f] ?? null) !== (t[f] ?? null)).map(([f, name]) =>
      f === 'permission' ? `${name}: ${old.permission ?? '—'} ← ${t.permission ?? '—'}` : `${name}: ${yesNo(old[f] as boolean | undefined)} ← ${yesNo(t[f] as boolean | undefined)}`);
    if (parts.length) out.push({ field: 'الانتقالات', from: label(t), to: `انتقال معدّل: ${label(t)} (${parts.join('، ')})` });
  }
  for (const [k, t] of before) if (!after.has(k)) out.push({ field: 'الانتقالات', from: label(t), to: 'انتقال محذوف' });
  return out;
}

export function relationTypeChanges(db: MockDatabase, current: RelationType, next: RelationType): FieldChange[] {
  const pairs = (v: unknown): string =>
    ((v as RelationType['allowedPairs']) ?? []).map((p) => `${db.types.find(p.sourceTypeId)?.name ?? p.sourceTypeId} ← ${db.types.find(p.targetTypeId)?.name ?? p.targetTypeId}`).join('، ') || 'أي نوع';
  return scalarChanges(current, next, {
    key: { label: 'المفتاح' },
    name: { label: 'الاسم' },
    inverseName: { label: 'الاسم العكسي' },
    directed: { label: 'موجّه', fmt: (v) => yesNo(v as boolean) },
    acyclic: { label: 'يمنع الحلقات', fmt: (v) => yesNo(v as boolean) },
    active: { label: 'التفعيل', fmt: (v) => (v ? 'مفعّل' : 'معطّل') },
    allowedPairs: { label: 'الأنواع المسموحة', fmt: pairs },
  });
}

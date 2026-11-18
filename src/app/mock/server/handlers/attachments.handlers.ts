import { Attachment, AttachmentSubject, extensionOf } from '@domain/attachments/attachment.models';
import { MockDatabase } from '../../db/database';
import { sha256 } from '../../db/hash';
import { fail, MockContext, MockRouter } from '../router';

/** EICAR is the industry-standard harmless test signature for antivirus scanners. */
const MALWARE_MARKERS = ['EICAR-STANDARD-ANTIVIRUS-TEST-FILE', 'eicar'];

function subjectProject(db: MockDatabase, type: AttachmentSubject, id: string): { projectId: string; label: string } {
  if (type === 'project') {
    const p = db.projects.get(id);
    return { projectId: p.id, label: p.name };
  }
  if (type === 'workItem') {
    const w = db.workItems.get(id);
    return { projectId: w.projectId, label: w.ref };
  }
  const a = db.approvals.get(id);
  return { projectId: a.projectId, label: a.title };
}

/** The parent resource must be visible before any file metadata or content is (FR-COL-04). */
function requireParentVisible(db: MockDatabase, ctx: MockContext, type: AttachmentSubject, id: string): { projectId: string; label: string } {
  const subject = subjectProject(db, type, id);
  ctx.requireProjectVisible(subject.projectId);
  return subject;
}

/** Leading bytes a file must have for its extension (FR-COL-05); text formats carry no signature. */
const SIGNATURES: Readonly<Record<string, readonly number[]>> = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8],
  jpeg: [0xff, 0xd8],
  gif: [0x47, 0x49, 0x46, 0x38], // GIF8
  zip: [0x50, 0x4b, 0x03, 0x04], // PK..
  docx: [0x50, 0x4b, 0x03, 0x04],
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  pptx: [0x50, 0x4b, 0x03, 0x04],
};

function contentMatchesExtension(bytes: Uint8Array, ext: string): boolean {
  const signature = SIGNATURES[ext];
  return !signature || signature.every((b, i) => bytes[i] === b);
}

async function looksMalicious(file: Blob, name: string): Promise<boolean> {
  if (MALWARE_MARKERS.some((m) => name.toLowerCase().includes(m.toLowerCase()))) return true;
  const head = await file.slice(0, 256).text();
  return MALWARE_MARKERS.some((m) => head.includes(m));
}

export function registerAttachmentHandlers(router: MockRouter, db: MockDatabase): void {
  router
    .get('attachments/by-subject', (req, ctx) => {
      const subjectType = req.query.get('subjectType') as AttachmentSubject;
      const subjectId = req.query.get('subjectId') ?? '';
      const { projectId } = requireParentVisible(db, ctx, subjectType, subjectId);
      ctx.require('files.download', projectId);
      return db.attachments
        .where((a) => a.subjectType === subjectType && a.subjectId === subjectId && !a.deleted)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    })
    .post('attachments', async (req, ctx) => {
      const form = req.body as FormData;
      const subjectType = String(form.get('subjectType')) as AttachmentSubject;
      const subjectId = String(form.get('subjectId'));
      const file = form.get('file');
      if (!(file instanceof File)) fail(400, 'لم يُرسل ملف.');
      const { projectId, label } = requireParentVisible(db, ctx, subjectType, subjectId);
      ctx.require('files.upload', projectId);
      if (db.projects.get(projectId).archived) fail(422, 'المشروع مؤرشف ولا يقبل مرفقات جديدة.');

      const ext = extensionOf(file.name);
      const policy = db.settings; // FR-COL-05: limits are organisation settings
      if (!policy.attachmentExtensions.includes(ext)) fail(422, `نوع الملف «${ext || 'بدون امتداد'}» غير مسموح.`);
      if (file.size > policy.attachmentMaxMb * 1024 * 1024) fail(422, `حجم الملف يتجاوز الحد المسموح (${policy.attachmentMaxMb} ميغابايت).`);
      if (file.size === 0) fail(422, 'الملف فارغ.');
      if (await looksMalicious(file, file.name)) {
        ctx.bind();
        db.log(ctx.me, 'file.rejected_malware', { type: subjectType === 'approval' ? 'approval' : subjectType, id: subjectId, label: file.name, projectId }, [], true);
        fail(422, 'لم يجتز الملف فحص المحتوى الضار ولم يُحفظ.');
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      ctx.bind(); // the await above may have interleaved another request
      if (!contentMatchesExtension(bytes, ext)) fail(422, 'محتوى الملف لا يطابق امتداده.');
      const digest = sha256(bytes);
      if (db.attachments.where((a) => a.subjectType === subjectType && a.subjectId === subjectId && !a.deleted && a.sha256 === digest).length) {
        fail(409, 'الملف مرفوع مسبقًا.');
      }

      const attachment = db.attachments.insert({
        subjectType, subjectId, projectId,
        fileName: file.name, size: file.size, contentType: file.type || 'application/octet-stream',
        uploadedBy: ctx.me, deleted: false, sha256: digest,
      });
      db.fileContents.set(attachment.id, file);
      db.log(ctx.me, 'file.uploaded', { type: subjectType === 'approval' ? 'approval' : subjectType, id: subjectId, label: `${label} · ${file.name}`, projectId });
      return attachment;
    })
    .get('attachments/:id/download', (req, ctx) => {
      const attachment = db.attachments.get(req.params['id']);
      if (attachment.deleted) fail(404, 'الملف غير موجود.');
      const subjectType = attachment.subjectType === 'approval' ? 'approval' : attachment.subjectType;
      // AT-08: a non-member's request is refused and recorded as a security event.
      const allowed = db.canSeeProject(ctx.me, attachment.projectId) && ctx.can('files.download', attachment.projectId);
      if (!allowed) {
        db.log(ctx.me, 'file.download_denied', { type: subjectType, id: attachment.subjectId, label: attachment.fileName, projectId: attachment.projectId }, [], true);
        fail(404, 'العنصر غير موجود أو لا تملك صلاحية الاطلاع عليه.');
      }
      db.log(ctx.me, 'file.downloaded', { type: subjectType, id: attachment.subjectId, label: attachment.fileName, projectId: attachment.projectId });
      return db.fileContents.get(attachment.id) ?? new Blob([`ملف تجريبي: ${attachment.fileName}`], { type: 'text/plain' });
    })
    .delete('attachments/:id', (req, ctx) => {
      const attachment: Attachment = db.attachments.get(req.params['id']);
      requireParentVisible(db, ctx, attachment.subjectType, attachment.subjectId);
      if (db.projects.get(attachment.projectId).archived) fail(422, 'المشروع مؤرشف؛ لا يمكن حذف مرفقاته.');
      if (attachment.uploadedBy !== ctx.me) ctx.require('files.delete', attachment.projectId);
      db.attachments.patch(attachment.id, { deleted: true });
      db.fileContents.delete(attachment.id);
      db.log(ctx.me, 'file.deleted', { type: attachment.subjectType === 'approval' ? 'approval' : attachment.subjectType, id: attachment.subjectId, label: attachment.fileName, projectId: attachment.projectId });
      return null;
    });
}

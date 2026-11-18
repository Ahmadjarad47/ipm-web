import { Entity } from '@core/models/entity.model';

export type AttachmentSubject = 'project' | 'workItem' | 'approval';

/** File metadata only; content is fetched through a permission-checked download (FR-COL-04). */
export interface Attachment extends Entity {
  readonly subjectType: AttachmentSubject;
  readonly subjectId: string;
  readonly projectId: string;
  readonly fileName: string;
  readonly size: number;
  readonly contentType: string;
  readonly uploadedBy: string;
  /** Logical delete: the record and its audit trail stay (FR-COL-06). */
  readonly deleted: boolean;
  /** SHA-256 of the content (hex), recorded by the server for integrity and duplicate detection (FR-COL-05). */
  readonly sha256?: string;
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** Client-side pre-check against the organisation policy; returns an Arabic reason, or null. */
export function precheckFile(file: File, policy: { readonly attachmentMaxMb: number; readonly attachmentExtensions: readonly string[] }): string | null {
  const ext = extensionOf(file.name);
  if (!policy.attachmentExtensions.includes(ext)) return `نوع الملف «${ext || 'بدون امتداد'}» غير مسموح.`;
  if (file.size > policy.attachmentMaxMb * 1024 * 1024) return `حجم الملف يتجاوز ${policy.attachmentMaxMb} ميغابايت.`;
  if (file.size === 0) return 'الملف فارغ.';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

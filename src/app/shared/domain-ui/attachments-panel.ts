import { HttpEventType } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { filter, switchMap } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { AttachmentsApi } from '@domain/attachments/attachment.api';
import { Attachment, AttachmentSubject, extensionOf, formatBytes, precheckFile } from '@domain/attachments/attachment.models';
import { SettingsStore } from '@domain/settings/settings.api';
import { RelativeTimePipe, UserNamePipe } from '@shared/pipes/pipes';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { Icon } from '@shared/ui/icon/icon';

interface UploadState {
  readonly key: string;
  readonly name: string;
  readonly progress: number;
  readonly error: string | null;
}

/**
 * Files attached to a project, work item or approval (FR-COL-03..06).
 *   <app-attachments-panel subjectType="workItem" [subjectId]="item.id" [projectId]="item.projectId" />
 * Upload: drag & drop or picker, several files at once, with per-file progress and client pre-checks.
 * The server re-validates type/size, scans content and checks permissions on every download.
 */
@Component({
  selector: 'app-attachments-panel',
  imports: [Icon, EmptyState, RelativeTimePipe, UserNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canUpload()) {
      <label class="drop" [class.over]="dragOver()"
        (dragover)="$event.preventDefault(); dragOver.set(true)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
        <input type="file" multiple class="sr-only" [attr.accept]="accept()" (change)="onPick($event)" />
        <app-icon name="paperclip" [size]="22" />
        <span><strong>اسحب الملفات هنا</strong> أو انقر للاختيار</span>
        <small class="muted">{{ policyHint() }}</small>
      </label>
    }

    @if (uploads().length) {
      <ul class="uploads" aria-live="polite">
        @for (u of uploads(); track u.key) {
          <li [class.failed]="!!u.error">
            <span class="name ltr">{{ u.name }}</span>
            @if (u.error) {
              <span class="err">{{ u.error }}</span>
              <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="dismiss(u.key)" aria-label="إخفاء"><app-icon name="close" [size]="14" /></button>
            } @else {
              <span class="bar" role="progressbar" [attr.aria-valuenow]="u.progress" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="u.progress"></span></span>
            }
          </li>
        }
      </ul>
    }

    @if (files.error()) {
      <app-empty-state icon="alert" title="تعذّر تحميل المرفقات">
        <button type="button" class="btn btn--outline btn--sm" (click)="files.reload()">إعادة المحاولة</button>
      </app-empty-state>
    } @else {
      <ul class="files">
        @for (f of files.value(); track f.id) {
          <li>
            <span class="ext" [attr.data-ext]="ext(f)">{{ ext(f) || '?' }}</span>
            <div class="meta">
              <span class="ltr fname" [title]="f.fileName">{{ f.fileName }}</span>
              <small class="muted">{{ size(f) }} · {{ f.uploadedBy | userName }} · {{ f.createdAt | relativeTime }}</small>
            </div>
            <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="download(f)" [disabled]="busyId() === f.id" [attr.aria-label]="'تنزيل ' + f.fileName">
              <app-icon name="download" [size]="16" />
            </button>
            @if (canDelete(f)) {
              <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="remove(f)" [attr.aria-label]="'حذف ' + f.fileName">
                <app-icon name="trash" [size]="16" />
              </button>
            }
          </li>
        } @empty {
          @if (!files.isLoading()) {
            <app-empty-state icon="paperclip" title="لا توجد مرفقات" />
          }
        }
      </ul>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--s-3); }
    .drop { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: var(--s-5); border: 2px dashed var(--c-border-strong); border-radius: var(--r-md); background: var(--c-surface-2); color: var(--c-text-2); text-align: center; cursor: pointer; transition: border-color .15s, background .15s; }
    .drop:hover, .drop.over { border-color: var(--c-emerald-600); background: var(--c-emerald-50); }
    .drop:focus-within { box-shadow: var(--focus-ring); }
    .drop small { font-size: var(--fs-xs); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
    .uploads li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--c-emerald-50); font-size: var(--fs-sm); }
    .uploads li.failed { background: var(--c-danger-bg); }
    .uploads .name { flex: 0 1 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .uploads .err { flex: 1; color: var(--c-danger); }
    .bar { flex: 1; height: 6px; border-radius: var(--r-pill); background: var(--c-surface); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--c-emerald-600); transition: width .2s; }
    .files li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); }
    .ext { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border-radius: var(--r-sm); background: var(--c-gold-100); color: var(--c-gold-600); font-size: 10px; font-weight: 700; text-transform: uppercase; direction: ltr; }
    .ext[data-ext='pdf'] { background: var(--c-danger-bg); color: var(--c-danger); }
    .ext[data-ext='png'], .ext[data-ext='jpg'], .ext[data-ext='jpeg'], .ext[data-ext='gif'] { background: var(--c-info-bg); color: var(--c-info); }
    .ext[data-ext='xlsx'], .ext[data-ext='csv'] { background: var(--c-success-bg); color: var(--c-success); }
    .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .fname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    small { font-size: var(--fs-xs); }
  `,
})
export class AttachmentsPanel {
  private readonly api = inject(AttachmentsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly subjectType = input.required<AttachmentSubject>();
  readonly subjectId = input.required<string>();
  readonly projectId = input.required<string>();
  /** Set when the parent is read-only (e.g. archived project). */
  readonly readonly = input(false);

  private readonly settings = inject(SettingsStore);
  /** Limits come from the organisation settings (FR-COL-05); the server re-checks. */
  protected readonly accept = computed(() => this.settings.value().attachmentExtensions.map((e) => `.${e}`).join(','));
  protected readonly policyHint = computed(() => {
    const s = this.settings.value();
    return `الأنواع المسموحة: ${s.attachmentExtensions.join('، ')} · الحد الأقصى ${s.attachmentMaxMb} م.ب للملف`;
  });

  protected readonly canUpload = computed(() => !this.readonly() && this.auth.can('files.upload', this.projectId()));
  private readonly canView = computed(() => this.auth.can('files.download', this.projectId()));

  protected readonly files = rxResource({
    params: () => (this.canView() ? { type: this.subjectType(), id: this.subjectId() } : undefined),
    stream: ({ params }) => this.api.forSubject(params.type, params.id),
    defaultValue: [],
  });

  protected readonly uploads = signal<readonly UploadState[]>([]);
  protected readonly dragOver = signal(false);
  protected readonly busyId = signal<string | null>(null);

  protected ext(f: Attachment): string {
    return extensionOf(f.fileName);
  }

  protected size(f: Attachment): string {
    return formatBytes(f.size);
  }

  protected canDelete(f: Attachment): boolean {
    if (this.readonly()) return false;
    return f.uploadedBy === this.auth.user()?.id || this.auth.can('files.delete', this.projectId());
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadAll([...(input.files ?? [])]);
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (this.canUpload()) this.uploadAll([...(event.dataTransfer?.files ?? [])]);
  }

  protected dismiss(key: string): void {
    this.uploads.update((list) => list.filter((u) => u.key !== key));
  }

  private uploadAll(files: File[]): void {
    for (const file of files) this.uploadOne(file);
  }

  private uploadOne(file: File): void {
    const key = crypto.randomUUID();
    const precheck = precheckFile(file, this.settings.value());
    this.uploads.update((list) => [...list, { key, name: file.name, progress: 0, error: precheck }]);
    if (precheck) return;

    const patch = (changes: Partial<UploadState>) =>
      this.uploads.update((list) => list.map((u) => (u.key === key ? { ...u, ...changes } : u)));

    this.api.upload(this.subjectType(), this.subjectId(), file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) patch({ progress: Math.round((event.loaded / event.total) * 100) });
        if (event.type === HttpEventType.Response) {
          this.dismiss(key);
          this.files.reload();
        }
      },
      error: (e: { message?: string }) => patch({ error: e.message ?? 'تعذّر رفع الملف.' }),
    });
  }

  protected download(f: Attachment): void {
    this.busyId.set(f.id);
    this.api.download(f.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.busyId.set(null);
      },
      error: () => this.busyId.set(null),
    });
  }

  protected remove(f: Attachment): void {
    this.confirm
      .confirm({ title: 'حذف المرفق', message: `سيُحذف «${f.fileName}» من القائمة ويبقى أثره في سجل التدقيق.`, confirmText: 'حذف', danger: true })
      .pipe(filter(Boolean), switchMap(() => this.api.remove(f.id)))
      .subscribe({
        next: () => {
          this.toast.success('حُذف المرفق.');
          this.files.reload();
        },
        error: () => this.files.reload(),
      });
  }
}

import { HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseApiService } from '@core/api/base-api.service';
import { Attachment, AttachmentSubject } from './attachment.models';

@Injectable({ providedIn: 'root' })
export class AttachmentsApi extends BaseApiService<Attachment, never, never> {
  protected readonly resource = 'attachments';

  forSubject(subjectType: AttachmentSubject, subjectId: string): Observable<readonly Attachment[]> {
    const params = new HttpParams().set('subjectType', subjectType).set('subjectId', subjectId);
    return this.http.get<readonly Attachment[]>(`${this.url}/by-subject`, { params });
  }

  /** Multipart upload with progress events. The server validates type, size and content (FR-COL-05). */
  upload(subjectType: AttachmentSubject, subjectId: string, file: File): Observable<HttpEvent<Attachment>> {
    const form = new FormData();
    form.append('subjectType', subjectType);
    form.append('subjectId', subjectId);
    form.append('file', file, file.name);
    return this.http.post<Attachment>(this.url, form, { reportProgress: true, observe: 'events' });
  }

  /** Every download is permission-checked and audited server-side (FR-COL-04, AT-08). */
  download(id: string): Observable<Blob> {
    return this.http.get(`${this.url}/${encodeURIComponent(id)}/download`, { responseType: 'blob' });
  }
}

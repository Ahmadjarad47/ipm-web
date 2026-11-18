import { forkJoin, map, Observable } from 'rxjs';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalBox, ApprovalRequest } from '@domain/approvals/approval.models';

const BOXES: readonly ApprovalBox[] = ['inbox', 'sent', 'closed'];

/** The API is per-user per box, so a project's requests are merged from every box (unique by id, newest first). */
export function fetchProjectApprovals(api: ApprovalRequestsApi, projectId: string): Observable<readonly ApprovalRequest[]> {
  const query = { page: 1, pageSize: 50, filters: { projectId } };
  return forkJoin(BOXES.map((box) => api.listBox(box, query))).pipe(
    map((pages) => {
      const unique = new Map<string, ApprovalRequest>();
      for (const page of pages) for (const item of page.items) unique.set(item.id, item);
      return [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }),
  );
}

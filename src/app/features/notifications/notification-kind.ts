export type NotificationTone = 'success' | 'info' | 'gold' | 'warning' | 'neutral';

export interface NotificationVisual {
  readonly icon: string;
  readonly tone: NotificationTone;
}

const VISUALS: Readonly<Record<string, NotificationVisual>> = {
  'work-item.assigned': { icon: 'task', tone: 'success' },
  'work-item.unassigned': { icon: 'user', tone: 'neutral' },
  'work-item.status-changed': { icon: 'refresh', tone: 'info' },
  'project.member-added': { icon: 'users', tone: 'success' },
  'project.member-removed': { icon: 'users', tone: 'neutral' },
  'project.status-changed': { icon: 'folder', tone: 'info' },
  'comment.mentioned': { icon: 'comment', tone: 'gold' },
  'approval.requested': { icon: 'approval', tone: 'gold' },
  'approval.decided': { icon: 'check', tone: 'success' },
  'approval.superseded': { icon: 'alert', tone: 'warning' },
  'approval.reminded': { icon: 'alert', tone: 'warning' },
  'approval.delegated': { icon: 'users', tone: 'gold' },
  'git.pr-merged': { icon: 'git', tone: 'neutral' },
};

const FALLBACK: NotificationVisual = { icon: 'bell', tone: 'neutral' };

/** Icon and colour tone of a notification, from the server's `kind` key (unknown kinds fall back to a bell). */
export const notificationVisual = (kind: string | undefined): NotificationVisual => (kind ? VISUALS[kind] : undefined) ?? FALLBACK;

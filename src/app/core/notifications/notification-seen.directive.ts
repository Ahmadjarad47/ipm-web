import { Directive, DestroyRef, ElementRef, inject, input } from '@angular/core';
import { NotificationReadBatcherService } from './notification-read-batcher.service';
import { Notification } from '@domain/activity/activity.models';

/** How long a notification must stay visible before it counts as "seen" and is marked read. */
const DWELL_MS = 1_500;

/**
 * Marks its host's notification as read once it has actually been on-screen for {@link DWELL_MS} (bell dropdown
 * or the full `/notifications` list) — not only on click. One `IntersectionObserver` per host element, created
 * here and disconnected in `DestroyRef.onDestroy`; its dwell timer is cleared both when the item scrolls out of
 * view early and on destroy, so neither the observer nor the timer can outlive the row (important since `@for`
 * recreates rows as pages load and the panel opens/closes).
 */
@Directive({ selector: '[appNotificationSeen]', standalone: true })
export class NotificationSeenDirective {
  readonly appNotificationSeen = input.required<Notification>();

  private readonly element = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly batcher = inject(NotificationReadBatcherService);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly observer: IntersectionObserver | null;

  constructor() {
    this.observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => this.onIntersect(entry.isIntersecting), { threshold: 0.6 });
    this.observer?.observe(this.element);

    inject(DestroyRef).onDestroy(() => {
      this.clearTimer();
      this.observer?.disconnect();
    });
  }

  private onIntersect(isIntersecting: boolean): void {
    if (!isIntersecting) {
      this.clearTimer();
      return;
    }

    const notification = this.appNotificationSeen();
    if (notification.read || this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.batcher.markSeen(notification.id);
    }, DWELL_MS);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

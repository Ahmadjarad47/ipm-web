import { Injectable, inject } from '@angular/core';
import { Subject, bufferTime, filter } from 'rxjs';
import { NotificationsApi } from '@domain/activity/activity.api';

/** How long a "seen" burst is collected before one batch request is sent. */
const BUFFER_MS = 400;

/**
 * Collects notification ids marked "seen" by any `NotificationSeenDirective` instance (bell dropdown or the
 * full list) and flushes them as one `markReadBatch` call per {@link BUFFER_MS} window, deduplicated — so N rows
 * becoming visible together cost one request, not N. Directive instances stay dumb: they only call `markSeen`,
 * never talk to the API themselves.
 */
@Injectable({ providedIn: 'root' })
export class NotificationReadBatcherService {
  private readonly api = inject(NotificationsApi);
  private readonly seen = new Subject<string>();
  /** Emits the batch of ids right before it is sent, so `NotificationStore` can apply the same local update `markRead` does. */
  readonly flushed = new Subject<readonly string[]>();

  constructor() {
    this.seen
      .pipe(
        bufferTime(BUFFER_MS),
        filter((ids) => ids.length > 0),
      )
      .subscribe((ids) => this.flush([...new Set(ids)]));
  }

  markSeen(id: string): void {
    this.seen.next(id);
  }

  private flush(ids: readonly string[]): void {
    this.flushed.next(ids);
    this.api.markReadBatch(ids).subscribe();
  }
}

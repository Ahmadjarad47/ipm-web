import { ErrorHandler, inject, Injectable, Injector, isDevMode } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ToastService } from '@core/notifications/toast.service';

/** Short, support-friendly incident id such as `INC-7F3K2A`. Carries no server or user details. */
export function generateIncidentId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'INC-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Global fallback for uncaught errors (NFR-11). The full error goes to the console in dev only;
 * users see a generic toast with an incident id they can copy for support. Never shows stacks or server text.
 * HTTP errors are already reported by the error interceptor, so they are not duplicated here.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);

  handleError(error: unknown): void {
    if (error instanceof HttpErrorResponse) return;
    const incidentId = generateIncidentId();
    if (isDevMode()) console.error(`[${incidentId}]`, error);
    try {
      this.injector.get(ToastService).error('حدث خطأ غير متوقع', {
        ttl: 10_000,
        action: { label: 'نسخ الرمز', run: () => void this.copy(incidentId) },
      });
    } catch {
      /* the UI itself is unavailable; nothing more we can safely do */
    }
  }

  private async copy(incidentId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(incidentId);
      this.injector.get(ToastService).info(`تم نسخ الرمز ${incidentId}`);
    } catch {
      this.injector.get(ToastService).info(`رمز الحادثة: ${incidentId}`);
    }
  }
}

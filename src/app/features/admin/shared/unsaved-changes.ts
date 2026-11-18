import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';

/** Pages with editable drafts implement this; the route guard and `beforeunload` ask it. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/** `canDeactivate: [unsavedChangesGuard]` — asks before leaving a page that has unsaved edits. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) return true;
  return inject(ConfirmService).confirm({
    title: 'تغييرات غير محفوظة',
    message: 'لديك تغييرات لم تُحفظ بعد. إن غادرت الصفحة فستُفقد. هل تريد المغادرة؟',
    confirmText: 'مغادرة دون حفظ',
    danger: true,
  });
};

/** Use with `host: { '(window:beforeunload)': 'onUnload($event)' }` so a tab close/reload warns too. */
export function warnBeforeUnload(event: BeforeUnloadEvent, dirty: boolean): void {
  if (dirty) event.preventDefault();
}

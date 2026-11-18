import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { PermissionKey } from '@core/auth/permissions';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { ShortcutsDialog } from './shortcuts-dialog';

interface GoTarget {
  readonly link: string;
  readonly permission: PermissionKey;
}

/** `g` then one of these keys. */
const GO: Readonly<Record<string, GoTarget>> = {
  p: { link: '/projects', permission: 'projects.view' },
  w: { link: '/work-items', permission: 'tasks.view' },
  a: { link: '/approvals', permission: 'approvals.view' },
  d: { link: '/dashboard', permission: 'dashboard.view' },
};

const GO_TIMEOUT_MS = 1500;

/** True when keystrokes belong to a text control or an open modal, so shortcuts must not fire. */
export function isTypingContext(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.getAttribute?.('role') === 'textbox')) return true;
  return !!document.querySelector('dialog[open]');
}

/**
 * Single-key shortcuts: `?` cheat-sheet, `g` then p/w/a/d to navigate, `c` to create a work item.
 * Ctrl/⌘+K and `/` (command palette) stay in the shell.
 */
@Injectable({ providedIn: 'root' })
export class Shortcuts {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private goPendingUntil = 0;

  /** Returns true when the event was consumed. */
  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (isTypingContext(event.target)) return false;
    const key = event.key;

    if (this.goPendingUntil > Date.now()) {
      this.goPendingUntil = 0;
      const target = GO[key.toLowerCase()];
      if (target) {
        event.preventDefault();
        if (this.auth.canSomewhere(target.permission) || target.link === '/approvals' && this.auth.canSomewhere('approvals.decide')) {
          void this.router.navigateByUrl(target.link);
        }
        return true;
      }
    }

    if (key === '?') {
      event.preventDefault();
      this.openCheatSheet();
      return true;
    }
    if (key === 'g') {
      this.goPendingUntil = Date.now() + GO_TIMEOUT_MS;
      return true;
    }
    if (key === 'c') {
      event.preventDefault();
      if (this.auth.can('tasks.create') || this.auth.canSomewhere('tasks.create')) {
        void this.router.navigate(['/work-items'], { queryParams: { create: 'true' } });
      }
      return true;
    }
    return false;
  }

  openCheatSheet(): void {
    this.dialog.open<ShortcutsDialog, void, void>(ShortcutsDialog, { width: 'min(560px, calc(100vw - 32px))' });
  }
}

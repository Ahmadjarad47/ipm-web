import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { Shortcuts } from './shortcuts';

function key(k: string, target: HTMLElement = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}

describe('Shortcuts', () => {
  let shortcuts: Shortcuts;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.setItem(
      'ipm.session',
      JSON.stringify({
        token: 't',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        user: { id: 'u', name: 'U', email: 'u@x', title: '' },
        systemPermissions: ['projects.view', 'tasks.view', 'tasks.create', 'dashboard.view', 'approvals.view'],
        projectPermissions: {},
        denied: [],
      }),
    );
    open = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: DialogService, useValue: { open } }],
    });
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
    shortcuts = TestBed.inject(Shortcuts);
  });

  it('navigates with g then p', () => {
    expect(shortcuts.handle(key('g'))).toBe(true);
    expect(shortcuts.handle(key('p'))).toBe(true);
    expect(navigateByUrl).toHaveBeenCalledWith('/projects');
  });

  it('opens the cheat sheet on ?', () => {
    shortcuts.handle(key('?'));
    expect(open).toHaveBeenCalledOnce();
  });

  it('ignores keystrokes typed into inputs, textareas and contenteditable', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    for (const el of [input, area, editable]) {
      expect(shortcuts.handle(key('?', el))).toBe(false);
      expect(shortcuts.handle(key('g', el))).toBe(false);
    }
    shortcuts.handle(key('p'));
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores shortcuts while a modal dialog is open', () => {
    const dlg = document.createElement('dialog');
    dlg.setAttribute('open', '');
    document.body.appendChild(dlg);
    expect(shortcuts.handle(key('?'))).toBe(false);
    dlg.remove();
  });
});

import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let toast: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = TestBed.inject(ToastService);
  });
  afterEach(() => vi.useRealTimers());

  it('dismisses after 3.5 s by default and 6 s with an action', () => {
    toast.info('a');
    toast.info('b', { action: { label: 'x', run: () => undefined } });
    vi.advanceTimersByTime(3600);
    expect(toast.toasts().map((t) => t.message)).toEqual(['b']);
    vi.advanceTimersByTime(2500);
    expect(toast.toasts()).toHaveLength(0);
  });

  it('pauses on hover and resumes with the remaining time', () => {
    const id = toast.info('a') as number;
    vi.advanceTimersByTime(2000);
    toast.pause(id);
    vi.advanceTimersByTime(10_000);
    expect(toast.toasts()).toHaveLength(1);
    toast.resume(id);
    vi.advanceTimersByTime(1600);
    expect(toast.toasts()).toHaveLength(0);
  });

  it('keeps at most 4 and runs undo actions', () => {
    for (let i = 0; i < 6; i++) toast.info('m' + i);
    expect(toast.toasts()).toHaveLength(4);
    const undo = vi.fn();
    const id = toast.undoable('deleted', undo) as number;
    toast.runAction(id);
    expect(undo).toHaveBeenCalledOnce();
    expect(toast.toasts().some((t) => t.id === id)).toBe(false);
  });
});

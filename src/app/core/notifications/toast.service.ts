import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly action?: ToastAction;
}

export interface ToastOptions {
  readonly action?: ToastAction;
  /** Milliseconds before auto-dismiss. Defaults: 3.5 s, 6 s with an action or for errors. */
  readonly ttl?: number;
}

const MAX_TOASTS = 4;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly _toasts = signal<readonly Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private readonly timers = new Map<number, { handle: ReturnType<typeof setTimeout>; started: number; remaining: number }>();

  success(message: string, options?: ToastOptions): number | null {
    return this.push('success', message, options);
  }

  error(message: string, options?: ToastOptions): number | null {
    return this.push('error', message, { ttl: 6000, ...options });
  }

  info(message: string, options?: ToastOptions): number | null {
    return this.push('info', message, options);
  }

  /** Success toast with an «تراجع» action, e.g. `toast.undoable('تم الحذف', () => restore())`. */
  undoable(message: string, undo: () => void): number | null {
    return this.success(message, { action: { label: 'تراجع', run: undo }, ttl: 8000 });
  }

  dismiss(id: number): void {
    this.clear(id);
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Hover / focus: stop the countdown, keeping the remaining time. */
  pause(id: number): void {
    const t = this.timers.get(id);
    if (!t) return;
    clearTimeout(t.handle);
    t.remaining = Math.max(500, t.remaining - (Date.now() - t.started));
    t.handle = 0 as unknown as ReturnType<typeof setTimeout>;
  }

  resume(id: number): void {
    const t = this.timers.get(id);
    if (!t) return;
    clearTimeout(t.handle);
    t.started = Date.now();
    t.handle = setTimeout(() => this.dismiss(id), t.remaining);
  }

  runAction(id: number): void {
    const t = this._toasts().find((x) => x.id === id);
    this.dismiss(id);
    t?.action?.run();
  }

  private clear(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t.handle);
    this.timers.delete(id);
  }

  private push(kind: ToastKind, message: string, options: ToastOptions = {}): number | null {
    // Drop identical messages already on screen (e.g. several failed requests at once).
    if (this._toasts().some((t) => t.message === message)) return null;
    const id = ++this.seq;
    const ttl = options.ttl ?? (options.action ? 6000 : 3500);
    const next = [...this._toasts(), { id, kind, message, action: options.action }];
    const dropped = next.slice(0, Math.max(0, next.length - MAX_TOASTS));
    dropped.forEach((t) => this.clear(t.id));
    this._toasts.set(next.slice(-MAX_TOASTS));
    this.timers.set(id, { handle: setTimeout(() => this.dismiss(id), ttl), started: Date.now(), remaining: ttl });
    return id;
  }
}

import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
  /** Auto-dismiss duration in ms, or null if the toast persists until manually dismissed. */
  duration: number | null;
}

/** Error toasts persist until manually dismissed (or superseded by a new action); everything else auto-dismisses. */
const DURATIONS: Partial<Record<ToastType, number>> = { success: 4500, info: 4500, warning: 5500 };

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly toasts = signal<ToastMessage[]>([]);

  /** Legacy alias, kept for the many existing call sites: pushes a success toast. */
  success(message: string): void { this.push('success', message); }
  /** Legacy alias, kept for the many existing call sites: pushes an error toast. */
  fail(message: string): void { this.push('error', message); }
  info(message: string): void { this.push('info', message); }
  warn(message: string): void { this.push('warning', message); }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
  }

  /** Legacy alias: clears any currently-shown error toasts (used before retrying an action). */
  dismissError(): void { this.dismissByType('error'); }
  /** Legacy alias: clears any currently-shown success toasts. */
  dismissNotice(): void { this.dismissByType('success'); }

  private dismissByType(type: ToastType): void {
    for (const toast of this.toasts().filter((item) => item.type === type)) this.dismiss(toast.id);
  }

  private push(type: ToastType, message: string): void {
    const id = this.nextId++;
    const duration = DURATIONS[type] ?? null;
    this.toasts.update((list) => [...list, { id, type, message, duration }]);
    if (duration !== null) this.timers.set(id, setTimeout(() => this.dismiss(id), duration));
  }
}

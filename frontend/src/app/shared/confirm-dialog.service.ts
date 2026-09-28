import { Injectable, signal } from '@angular/core';
import { ActionDialogConfig } from './action-dialog.component';

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly config = signal<ActionDialogConfig | null>(null);
  private resolver: ((value: Record<string, string | number> | null) => void) | null = null;

  /** Resolves with the confirmed field values (an empty object for a plain yes/no dialog), or null if cancelled. */
  open(config: ActionDialogConfig): Promise<Record<string, string | number> | null> {
    this.config.set(config);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  confirm(values: Record<string, string | number>): void {
    const resolve = this.resolver;
    this.close();
    resolve?.(values);
  }

  cancel(): void {
    const resolve = this.resolver;
    this.close();
    resolve?.(null);
  }

  private close(): void {
    this.config.set(null);
    this.resolver = null;
  }
}

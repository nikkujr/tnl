import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { AppFormsModule } from './app-forms.module';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BusinessApi } from '../core/business-api.service';
import { ToastService } from './toast.service';

export interface PasswordResetTarget {
  id: number;
  fullName: string;
  email: string;
  kind: 'agents' | 'customers';
}

@Component({
  selector: 'app-password-reset-dialog',
  imports: [AppFormsModule],
  templateUrl: './password-reset-dialog.component.html',
  styleUrl: './password-reset-dialog.component.scss',
})
export class PasswordResetDialogComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) target!: PasswordResetTarget;
  @Output() readonly closed = new EventEmitter<void>();
  private readonly api = inject(BusinessApi);
  private readonly toast = inject(ToastService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previousFocus = document.activeElement as HTMLElement | null;
  readonly busy = signal(false);
  readonly error = signal('');
  password = '';
  confirmation = '';
  showPassword = false;

  ngAfterViewInit() {
    this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus();
  }
  ngOnDestroy() {
    this.password = '';
    this.confirmation = '';
    this.previousFocus?.focus();
  }
  close() {
    if (!this.busy()) {
      this.password = '';
      this.confirmation = '';
      this.closed.emit();
    }
  }
  passwordBytes() { return new TextEncoder().encode(this.password).length; }
  valid() {
    return (
      this.password.length >= 8 &&
      this.password.length <= 72 &&
      new TextEncoder().encode(this.password).length <= 72 &&
      this.password === this.confirmation
    );
  }
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
    if (event.key !== 'Tab') return;
    const fields = [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled)',
      ),
    ];
    const first = fields[0],
      last = fields.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  reset() {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api
      .post(`${this.target.kind}/${this.target.id}/reset-password`, { newPassword: this.password })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.password = '';
          this.confirmation = '';
          this.busy.set(false);
          this.toast.success(
            `Password reset for ${this.target.fullName}. Existing sessions signed out.`,
          );
          this.closed.emit();
        },
        error: (e) => {
          this.busy.set(false);
          this.password = '';
          this.confirmation = '';
          this.error.set(e.error?.error?.message ?? 'Unable to reset password. Try again.');
          this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus();
        },
      });
  }
}

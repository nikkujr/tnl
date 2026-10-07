import { Directive, ElementRef, Injectable, Injector, NgModule, OnDestroy, OnInit, afterNextRender, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;
let errorId = 0;

/** Field messages own only their added description, preserving existing help text. */
export function clearFieldError(field: Field): void {
  const id = field.dataset['errorId'];
  if (!id) return;
  field.ownerDocument.getElementById(id)?.remove();
  const descriptions = (field.getAttribute('aria-describedby') ?? '').split(' ').filter(value => value && value !== id);
  if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
  else field.removeAttribute('aria-describedby');
  field.removeAttribute('aria-invalid');
  delete field.dataset['errorId'];
}

export function showFieldError(field: Field, message: string): void {
  clearFieldError(field);
  const error = field.ownerDocument.createElement('small');
  error.id = `validation-error-${++errorId}`;
  error.className = 'validation-field-error';
  error.textContent = message;
  const group = field instanceof HTMLInputElement && field.type === 'radio' ? field.closest('fieldset') : null;
  (group ?? field).after(error);
  field.dataset['errorId'] = error.id;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
}

export function focusField(field: Field): void {
  field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  field.focus({ preventScroll: true });
}

@Injectable({ providedIn: 'root' })
export class FormValidationService {
  submitting: HTMLFormElement | null = null;
}

@Directive({ selector: 'form' })
export class FormValidationDirective implements OnInit, OnDestroy {
  private readonly form: HTMLFormElement = inject(ElementRef).nativeElement;
  private readonly ngForm = inject(NgForm, { optional: true, self: true });
  private readonly validation = inject(FormValidationService);
  private readonly injector = inject(Injector);
  private attempted = false;

  private fields(): Field[] {
    const fields = Array.from(this.form.querySelectorAll<Field>('input,select,textarea,button[data-validation-field]'));
    return fields.filter((field, index) => !(field instanceof HTMLInputElement && field.type === 'radio') ||
      fields.findIndex(candidate => candidate.name === field.name) === index);
  }

  private message(field: Field): string {
    if (field.matches(':disabled') || (field instanceof HTMLInputElement && field.type === 'hidden')) return '';
    const custom = field.getAttribute('data-validation-error');
    if (custom) { field.dataset['validationConstraint'] = ''; return custom; }
    const errors = this.ngForm?.controls[field.name]?.errors;
    if (errors?.['required'] || ('validity' in field && field.validity.valueMissing)) return 'This field is required.';
    if (errors?.['minlength']) return `Use at least ${errors['minlength'].requiredLength} characters.`;
    if (errors?.['maxlength']) return `Use no more than ${errors['maxlength'].requiredLength} characters.`;
    if (errors?.['email']) return 'Enter a valid email address.';
    if (errors?.['pattern']) return 'Enter a value in the requested format.';
    if ('validity' in field && !field.validity.valid) return field.validationMessage;
    if (errors?.['min']) return `Enter ${errors['min'].min} or more.`;
    if (errors?.['max']) return `Enter ${errors['max'].max} or less.`;
    return errors ? 'Check this value.' : '';
  }

  private readonly submit = (event: Event): void => {
    this.attempted = true;
    this.form.querySelector('[data-validation-summary]')?.remove();
    this.ngForm?.form.markAllAsTouched();
    const invalid: Field[] = [];
    for (const field of this.fields()) {
      const message = this.message(field);
      clearFieldError(field);
      if (message) { showFieldError(field, message); invalid.push(field); }
    }
    if (invalid.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      focusField(invalid[0]);
      return;
    }
    this.validation.submitting = this.form;
    queueMicrotask(() => { if (this.validation.submitting === this.form) this.validation.submitting = null; });
  };

  private readonly edit = (event: Event): void => {
    const target = (event.type === 'click'
      ? (event.target as Element).closest('button[data-validation-field]') : event.target) as Field | null;
    if (!target) return;
    const field = target instanceof HTMLInputElement && target.type === 'radio'
      ? this.fields().find(candidate => candidate.name === target.name) ?? target : target;
    if (!field.matches('input,select,textarea,button[data-validation-field]')) return;
    clearFieldError(field);
    // Wait for ngModel and bound cross-field constraints to update.
    afterNextRender(() => {
      if (!this.form.isConnected || !this.attempted) return;
      for (const candidate of this.fields()) {
        if (candidate !== field && !candidate.hasAttribute('data-validation-error') && candidate.dataset['validationConstraint'] === undefined) continue;
        const message = this.message(candidate);
        clearFieldError(candidate);
        if (message) showFieldError(candidate, message);
      }
    }, { injector: this.injector });
  };

  ngOnInit(): void {
    this.form.noValidate = true;
    this.form.addEventListener('submit', this.submit, true);
    this.form.addEventListener('input', this.edit);
    this.form.addEventListener('change', this.edit);
    this.form.addEventListener('click', this.edit);
  }

  ngOnDestroy(): void {
    this.form.removeEventListener('submit', this.submit, true);
    this.form.removeEventListener('input', this.edit);
    this.form.removeEventListener('change', this.edit);
    this.form.removeEventListener('click', this.edit);
    if (this.validation.submitting === this.form) this.validation.submitting = null;
  }
}

export function applyServerFieldErrors(form: HTMLFormElement, issues: Array<{ path: Array<string | number>; message: string }>, scheduleFocus: (callback: () => void) => void = queueMicrotask): boolean {
  if (!form.isConnected || !issues.length) return false;
  const fields = Array.from(form.querySelectorAll<Field>('[name],[data-validation-field]'));
  const matched = issues.map(issue => {
    const path = issue.path.filter((part, index) => index !== 0 || part !== 'body').join('.');
    return { field: fields.find(field => field.getAttribute('data-validation-field') === path || field.name === path), message: issue.message };
  });
  for (const field of fields) {
    const messages = matched.filter(match => match.field === field).map(match => match.message);
    if (messages.length) showFieldError(field, messages.join(' '));
  }
  const unmatched = matched.filter(match => !match.field);
  if (unmatched.length) {
    // Form-wide rules have no single field (e.g. an invalid item combination).
    const summary = form.ownerDocument.createElement('p');
    summary.className = 'validation-field-error';
    summary.setAttribute('role', 'alert');
    summary.dataset['validationSummary'] = '';
    summary.textContent = unmatched.map(match => match.message).join(' ');
    form.querySelector('[data-validation-summary]')?.remove();
    form.prepend(summary);
    form.tabIndex = -1;
  }
  const first = fields.find(field => matched.some(match => match.field === field));
  scheduleFocus(() => {
    if (first?.isConnected && !first.disabled) focusField(first);
    else if (form.isConnected) { form.scrollIntoView?.({ block: 'center' }); form.focus(); }
  });
  return true;
}

export const formValidationInterceptor: HttpInterceptorFn = (request, next) => {
  const form = inject(FormValidationService).submitting;
  const injector = inject(Injector);
  return next(request).pipe(catchError(error => {
    if (form && error instanceof HttpErrorResponse && error.status === 400 &&
        applyServerFieldErrors(form, error.error?.error?.details?.issues ?? [], callback => afterNextRender(callback, { injector }))) {
      // Existing page handlers keep their loading/error handling; mapped errors stay beside fields.
      return throwError(() => new HttpErrorResponse({ ...error, url: error.url ?? undefined, error: { ...error.error, error: { ...error.error.error, message: '' } } }));
    }
    return throwError(() => error);
  }));
};

@NgModule({ imports: [FormsModule, FormValidationDirective], exports: [FormsModule, FormValidationDirective] })
export class AppFormsModule {}

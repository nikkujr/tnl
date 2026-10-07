import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AppFormsModule, applyServerFieldErrors, clearFieldError, FormValidationService, formValidationInterceptor } from './app-forms.module';
import { ToastService } from './toast.service';
import { buildPaymentDialogFields } from './order-payment';

@Component({
  imports: [AppFormsModule],
  template: `<form (ngSubmit)="submitted = submitted + 1">
    <label>Email<input name="email" type="email" [(ngModel)]="email" required aria-describedby="email-help"></label>
    <small id="email-help">Your sign-in email.</small>
    <label>Quantity<input name="quantity" type="number" [(ngModel)]="quantity" min="1" required></label>
    <label>Confirmation<input name="confirmation" [(ngModel)]="confirmation" [attr.data-validation-error]="confirmation !== email ? 'Values must match.' : null"></label>
    @if (showRating) {
      <fieldset>
        @for (value of [1, 2]; track value) {
          <label><input type="radio" name="rating" [value]="value" [(ngModel)]="rating" [attr.data-validation-error]="rating ? null : 'Select a rating.'"><span>Star</span></label>
        }
      </fieldset>
    }
    <button>Save</button>
  </form>`,
})
class TestForm {
  email = '';
  quantity = 0;
  confirmation = '';
  submitted = 0;
  showRating = false;
  rating = 0;
}

describe('app-wide field validation', () => {
  async function setup() {
    TestBed.configureTestingModule({ imports: [TestForm] });
    const fixture = TestBed.createComponent(TestForm);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, form: fixture.nativeElement.querySelector('form') as HTMLFormElement };
  }

  it('blocks invalid submission, highlights every error and focuses the first field', async () => {
    const { fixture, form } = await setup();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(fixture.componentInstance.submitted).toBe(0);
    const email = form.querySelector<HTMLInputElement>('[name=email]')!;
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(form.querySelector('[name=quantity]')?.getAttribute('aria-invalid')).toBe('true');
    expect(form.querySelectorAll('.validation-field-error').length).toBe(2);
    clearFieldError(email);
    expect(email.getAttribute('aria-describedby')).toBe('email-help');
  });

  it('validates email format and cross-field rules, then allows a corrected submission', async () => {
    const { fixture, form } = await setup();
    const email = form.querySelector<HTMLInputElement>('[name=email]')!;
    email.value = 'broken';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(email.getAttribute('aria-invalid')).toBe('true');
    fixture.componentInstance.email = 'name@example.com';
    fixture.componentInstance.confirmation = 'name@example.com';
    fixture.componentInstance.quantity = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    email.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(fixture.componentInstance.submitted).toBe(1);
    expect(form.querySelectorAll('.validation-field-error').length).toBe(0);
  });

  it('maps server paths, keeps unmatched validation inline and preserves field help', async () => {
    const { form } = await setup();
    const email = form.querySelector<HTMLInputElement>('[name=email]')!;
    email.dataset['validationField'] = 'contact.email';
    expect(applyServerFieldErrors(form, [{ path: ['body', 'contact', 'email'], message: 'Already used.' }])).toBe(true);
    await Promise.resolve();
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('aria-describedby')).toContain('email-help');
    expect(applyServerFieldErrors(form, [{ path: ['body', 'items'], message: 'Choose an item.' }])).toBe(true);
    expect(form.querySelector('[data-validation-summary]')?.textContent).toBe('Choose an item.');
  });

  it('shows one message for a radio group and keeps its focus styling intact', async () => {
    const { fixture, form } = await setup();
    fixture.componentInstance.email = fixture.componentInstance.confirmation = 'name@example.com';
    fixture.componentInstance.quantity = 1;
    fixture.componentInstance.showRating = true;
    fixture.detectChanges();
    await fixture.whenStable();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(form.querySelectorAll('.validation-field-error')).toHaveLength(1);
    const radios = form.querySelectorAll<HTMLInputElement>('[name=rating]');
    expect(document.activeElement).toBe(radios[0]);
    expect(radios[0].nextElementSibling?.tagName).toBe('SPAN');
    radios[1].click();
    await fixture.whenStable();
    expect(form.querySelectorAll('.validation-field-error')).toHaveLength(0);
  });

  it('validates cash against payment status inside the dialog and accepts centavos', () => {
    const fields = buildPaymentDialogFields({ paymentMethod: 'Cash', paymentStatus: 'PAID', cashReceived: 0, total: 10.25 });
    const cash = fields.find(field => field.key === 'cashReceived')!;
    expect(cash.step).toBe(0.01);
    expect(cash.validate!({ method: 'Cash', status: 'PAID', cashReceived: 1 })).toBeTruthy();
    expect(cash.validate!({ method: 'Cash', status: 'PAID', cashReceived: 10.25 })).toBeNull();
  });

  it('keeps field errors out of toasts while preserving operational errors', async () => {
    const { form } = await setup();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([formValidationInterceptor])), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpClient);
    const requests = TestBed.inject(HttpTestingController);
    const validation = TestBed.inject(FormValidationService);
    const toast = TestBed.inject(ToastService);
    // Use a connected form for the response, just like a visible editor.
    document.body.append(form);
    validation.submitting = form;
    let status = 0;
    http.post('/save', {}).subscribe({ error: error => { status = error.status; toast.fail(error.error.error.message); } });
    requests.expectOne('/save').flush({ error: { message: 'Validation failed', details: { issues: [{ path: ['body', 'email'], message: 'Invalid email.' }] } } }, { status: 400, statusText: 'Bad Request' });
    expect(status).toBe(400);
    expect(toast.toasts()).toHaveLength(0);
    expect(form.querySelector('[name=email]')?.getAttribute('aria-invalid')).toBe('true');
    http.post('/save', {}).subscribe({ error: error => toast.fail(error.error.error.message) });
    requests.expectOne('/save').flush({ error: { message: 'Connection failed.' } }, { status: 500, statusText: 'Server Error' });
    expect(toast.toasts()[0].message).toBe('Connection failed.');
    requests.verify();
    form.remove();
  });
});

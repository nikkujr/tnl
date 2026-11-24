import { afterNextRender, Component, DestroyRef, ElementRef, inject, Injector, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BusinessApi } from '../../core/business-api.service';
import { SessionService } from '../../core/session.service';
import { AppFormsModule, applyServerFieldErrors } from '../../shared/app-forms.module';
import { AppIconComponent } from '../../shared/app-icon.component';
import { ContactFieldsComponent, contactEntry, contactText } from '../../shared/contact-fields.component';

type AuthMode = 'login' | 'register' | 'forgot' | 'verify' | 'reset';

@Component({
  selector: 'app-sign-in',
  imports: [AppFormsModule, AppIconComponent, ContactFieldsComponent],
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.scss',
})
export class SignInComponent {
  private readonly api = inject(BusinessApi);
  private readonly sessionService = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private magic = '';

  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal(false);
  mode: AuthMode = 'login';
  email = '';
  password = '';
  fullName = contactEntry();
  phone = '';
  address = contactEntry();
  marketingOptIn = false;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      this.magic = query.get('verify') ?? query.get('reset') ?? '';
      if (this.magic) {
        this.setMode(query.has('verify') ? 'verify' : 'reset');
        this.scrollToForm();
      }
    });
    this.route.fragment.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((fragment) => {
      if (fragment === 'sign-in' || fragment === 'staff-login') this.scrollToForm();
    });
  }

  private scrollToForm() {
    afterNextRender(() => this.host.nativeElement.closest('section')?.scrollIntoView(), { injector: this.injector });
  }

  setMode(mode: AuthMode) {
    this.mode = mode;
    this.password = '';
    this.error.set('');
    this.notice.set('');
  }
  authTitle() {
    return {
      login: 'Sign in',
      register: 'Create a customer account',
      forgot: 'Forgot your password?',
      verify: 'Activate your account.',
      reset: 'Choose a new password.',
    }[this.mode];
  }
  authDescription() {
    return {
      login: '',
      register: 'Create an account, then verify your email to get started.',
      forgot: 'Enter your email and we’ll send you a reset link.',
      verify: 'Confirm your email to connect with your customer record.',
      reset: 'Use at least 8 characters for your new password.',
    }[this.mode];
  }
  readonly demoAccountsAvailable = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  useDemoAccount(role: 'admin' | 'agent') {
    this.email = role + '@tnl.local';
    this.password = 'TnlDemo123!';
  }

  auth(form: HTMLFormElement) {
    if (this.busy()) return;
    this.error.set('');
    this.notice.set('');
    this.busy.set(true);
    let request;
    if (this.mode === 'register')
      request = this.api.post('customer-auth/register', {
        email: this.email,
        password: this.password,
        fullName: contactText(this.fullName, 'name'),
        nameParts: this.fullName.parts ?? undefined,
        phone: this.phone,
        address: contactText(this.address, 'address'),
        addressParts: this.address.parts ?? undefined,
        marketingOptIn: this.marketingOptIn,
      });
    else if (this.mode === 'forgot')
      request = this.api.post('customer-auth/forgot-password', { email: this.email });
    else if (this.mode === 'verify')
      request = this.api.post('customer-auth/verify', {
        token: this.magic,
        ...(this.password ? { password: this.password } : {}),
      });
    else if (this.mode === 'reset')
      request = this.api.post('customer-auth/reset-password', {
        token: this.magic,
        password: this.password,
      });
    else request = this.api.signIn(this.email, this.password);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.password = '';
        if (r.data.token) {
          this.sessionService.setSession(r.data);
          if (r.data.user.role !== 'CUSTOMER') {
            void this.router.navigateByUrl(r.data.user.role === 'DELIVERY' ? '/delivery' : '/dashboard', { replaceUrl: true });
            return;
          }
          this.magic = '';
          void this.router.navigate(['/portal'], {
            queryParams: {
              offerId: this.route.snapshot.queryParamMap.get('offerId'),
              offerKind: this.route.snapshot.queryParamMap.get('offerKind'),
            },
            replaceUrl: true,
          });
        } else {
          this.notice.set(r.data.message);
          if (this.mode === 'reset') this.mode = 'login';
        }
      },
      error: (error) => {
        this.busy.set(false);
        const failure = error.error?.error;
        if (failure?.message === '' || applyServerFieldErrors(form, failure?.details?.issues ?? [])) return;
        this.error.set(failure?.message ?? 'Unable to complete this action. Try again.');
      },
    });
  }
}

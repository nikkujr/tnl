import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BusinessApi, CatalogOffer } from '../../core/business-api.service';
import { SessionService } from '../../core/session.service';
import { GuidedChatComponent } from '../../shared/guided-chat.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { DeliveryPanelComponent } from '../delivery/delivery-panel.component';
type AuthMode = 'login' | 'register' | 'forgot' | 'verify' | 'reset';
@Component({
  selector: 'app-customer-portal',
  imports: [FormsModule, CurrencyPipe, DatePipe, GuidedChatComponent, AppIconComponent, RouterLink, DeliveryPanelComponent],
  templateUrl: './portal.page.html',
  styleUrls: ['../../shared/business.scss', './portal.page.scss'],
})
export class PortalPage {
  readonly api = inject(BusinessApi);
  readonly sessionService = inject(SessionService);
  readonly session = this.sessionService.session;
  readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal(false);
  readonly offers = signal<CatalogOffer[]>([]);
  readonly catalogKind = signal<'ALL' | 'PRODUCT' | 'PACKAGE'>('ALL');
  readonly filteredOffers = computed(() =>
    this.offers().filter((offer) =>
      offer.available && (this.catalogKind() === 'ALL' || offer.kind === this.catalogKind()),
    ),
  );
  readonly catalogPage = signal(1);
  readonly catalogPageSize = 6;
  readonly catalogLoading = signal(false);
  readonly catalogError = signal('');
  readonly catalogPageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredOffers().length / this.catalogPageSize)),
  );
  readonly visibleOffers = computed(() =>
    this.filteredOffers().slice(
      (this.catalogPage() - 1) * this.catalogPageSize,
      this.catalogPage() * this.catalogPageSize,
    ),
  );
  readonly catalogStart = computed(() =>
    this.filteredOffers().length ? (this.catalogPage() - 1) * this.catalogPageSize + 1 : 0,
  );
  readonly catalogEnd = computed(() =>
    Math.min(this.catalogPage() * this.catalogPageSize, this.filteredOffers().length),
  );
  private readonly catalogSummary = viewChild<ElementRef<HTMLElement>>('catalogSummary');
  private readonly catalogSearchInput =
    viewChild<ElementRef<HTMLInputElement>>('catalogSearchInput');
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private catalogRequest?: Subscription;
  readonly orders = signal<any[]>([]);
  readonly requests = signal<any[]>([]);
  readonly detail = signal<any>(null);
  readonly profile = signal<any>(null);
  readonly cart = signal<Array<{ offer: CatalogOffer; quantity: number }>>([]);
  tab = 'catalog';
  mode: AuthMode = 'login';
  email = '';
  password = '';
  fullName = '';
  phone = '';
  address = '';
  marketingOptIn = false;
  deliveryAddress = '';
  paymentMethod = 'Cash on delivery';
  search = '';
  followupMessage = 'Please provide an update on my order.';
  private magic = '';
  unsubscribe = '';
  setMode(mode: AuthMode) {
    this.mode = mode;
    this.password = '';
    this.error.set('');
    this.notice.set('');
  }
  authTitle() {
    return {
      login: 'Welcome back.',
      register: 'Make yourself at home.',
      forgot: 'Forgot your password?',
      verify: 'Activate your account.',
      reset: 'Choose a new password.',
    }[this.mode];
  }
  authDescription() {
    return {
      login: 'Sign in to your offers, requests, and orders.',
      register: 'Create an account, then verify your email to get started.',
      forgot: 'Enter your email and we’ll send you a reset link.',
      verify: 'Confirm your email to connect with your customer record.',
      reset: 'Use at least 8 characters for your new password.',
    }[this.mode];
  }
  constructor() {
    const query = this.route.snapshot.queryParamMap;
    this.magic = query.get('verify') ?? query.get('reset') ?? '';
    this.mode = query.has('verify') ? 'verify' : query.has('reset') ? 'reset' : 'login';
    this.unsubscribe = query.get('unsubscribe') ?? '';
    this.loadCatalog();
    if (this.session()?.role === 'CUSTOMER') this.load();
  }
  loadCatalog() {
    this.catalogRequest?.unsubscribe();
    this.catalogLoading.set(true);
    this.catalogError.set('');
    this.catalogRequest = this.api
      .get<CatalogOffer[]>('catalog', { search: this.search })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.offers.set(r.data);
          this.catalogPage.set(1);
          this.catalogLoading.set(false);
          const id = Number(this.route.snapshot.queryParamMap.get('offerId')),
            kind = this.route.snapshot.queryParamMap.get('offerKind');
          if (this.session()?.role === 'CUSTOMER' && id) {
            const offer = r.data.find((o) => o.id === id && o.kind === kind);
            if (offer && this.cart().length === 0) this.add(offer);
          }
        },
        error: (e) => {
          this.catalogLoading.set(false);
          this.catalogError.set(
            e.error?.error?.message ?? 'Unable to load offers. Please try again.',
          );
        },
      });
  }
  changeCatalogKind(kind: 'ALL' | 'PRODUCT' | 'PACKAGE') {
    this.catalogKind.set(kind);
    this.catalogPage.set(1);
  }
  changeCatalogPage(page: number) {
    if (page < 1 || page > this.catalogPageCount() || this.catalogLoading()) return;
    this.catalogPage.set(page);
    const summary = this.catalogSummary()?.nativeElement;
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({ block: 'start' });
  }
  browseOffers() {
    this.tab = 'catalog';
    afterNextRender(
      () => {
        const input = this.catalogSearchInput()?.nativeElement;
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({ block: 'center' });
      },
      { injector: this.injector },
    );
  }
  load() {
    this.api.get('customer/me').subscribe({
      next: (r) => {
        this.profile.set(r.data);
        this.deliveryAddress = r.data.address;
        this.marketingOptIn = Boolean(r.data.marketingOptIn);
      },
      error: (e) => this.fail(e),
    });
    this.api
      .get<any[]>('customer/orders')
      .subscribe({ next: (r) => this.orders.set(r.data), error: (e) => this.fail(e) });
    this.api
      .get<any[]>('customer/requests')
      .subscribe({ next: (r) => this.requests.set(r.data), error: (e) => this.fail(e) });
  }
  auth() {
    this.error.set('');
    this.notice.set('');
    this.busy.set(true);
    let request;
    if (this.mode === 'register')
      request = this.api.post('customer-auth/register', {
        email: this.email,
        password: this.password,
        fullName: this.fullName,
        phone: this.phone,
        address: this.address,
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
    else request = this.api.customerLogin(this.email, this.password);
    request.subscribe({
      next: (r) => {
        this.busy.set(false);
        this.password = '';
        if (r.data.token) {
          this.sessionService.setSession(r.data);
          this.magic = '';
          this.router.navigate(['/portal'], {
            queryParams: {
              offerId: this.route.snapshot.queryParamMap.get('offerId'),
              offerKind: this.route.snapshot.queryParamMap.get('offerKind'),
            },
            replaceUrl: true,
          });
          this.load();
          this.loadCatalog();
        } else {
          this.notice.set(r.data.message);
          if (this.mode === 'reset') this.mode = 'login';
        }
      },
      error: (e) => this.fail(e),
    });
  }
  add(offer: CatalogOffer) {
    if (this.session()?.role !== 'CUSTOMER') {
      this.notice.set('Sign in to submit an order request.');
      return;
    }
    if (!offer.available) {
      this.error.set('This offer is unavailable.');
      return;
    }
    this.cart.update((lines) => {
      const index = lines.findIndex((l) => l.offer.id === offer.id && l.offer.kind === offer.kind);
      return index < 0
        ? [...lines, { offer, quantity: 1 }]
        : lines.map((l, i) => (i === index ? { ...l, quantity: l.quantity + 1 } : l));
    });
    this.tab = 'request';
  }
  quantity(index: number, value: number) {
    if (Number.isInteger(value) && value > 0 && value <= 10000)
      this.cart.update((lines) =>
        lines.map((l, i) => (i === index ? { ...l, quantity: value } : l)),
      );
  }
  remove(index: number) {
    this.cart.update((lines) => lines.filter((_, i) => i !== index));
  }
  total() {
    return this.cart().reduce((s, l) => s + l.offer.price * l.quantity, 0);
  }
  submit() {
    if (!this.cart().length) return;
    this.busy.set(true);
    this.api
      .post('customer/requests', {
        items: this.cart()
          .filter((l) => l.offer.kind === 'PRODUCT')
          .map((l) => ({ productId: l.offer.id, quantity: l.quantity })),
        packages: this.cart()
          .filter((l) => l.offer.kind === 'PACKAGE')
          .map((l) => ({ packageId: l.offer.id, quantity: l.quantity })),
        deliveryAddress: this.deliveryAddress,
        paymentMethod: this.paymentMethod,
        reviewedTerms: this.cart().map((l) => ({
          kind: l.offer.kind,
          id: l.offer.id,
          revision: l.offer.revision,
        })),
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cart.set([]);
          this.notice.set(
            'Request submitted. Your agent or the admin assignment queue has been notified.',
          );
          this.tab = 'requests';
          this.load();
        },
        error: (e) => this.fail(e),
      });
  }
  view(id: number) {
    this.api.get('customer/orders/' + id).subscribe({
      next: (r) => {
        this.detail.set(r.data);
        this.tab = 'orders';
      },
      error: (e) => this.fail(e),
    });
  }
  deliveryChanged(id: number) {
    this.view(id);
    this.api.get<any[]>('customer/orders').subscribe({
      next: (r) => this.orders.set(r.data),
      error: (e) => this.fail(e),
    });
  }
  followup() {
    const order = this.detail();
    if (!order) return;
    this.api
      .post(`customer/orders/${order.id}/followups`, { message: this.followupMessage })
      .subscribe({
        next: (r) => {
          this.notice.set(
            r.data.reused ? 'An update request is already open.' : 'Your agent has been notified.',
          );
          this.view(order.id);
        },
        error: (e) => this.fail(e),
      });
  }
  preferences() {
    this.api.patch('customer/preferences', { marketingOptIn: this.marketingOptIn }).subscribe({
      next: () => this.notice.set('Marketing preference saved.'),
      error: (e) => this.fail(e),
    });
  }
  stopMarketing() {
    this.api.post('customer-auth/unsubscribe', { token: this.unsubscribe }).subscribe({
      next: (r) => {
        this.notice.set(r.data.message);
        this.unsubscribe = '';
        this.router.navigate(['/portal'], { replaceUrl: true });
      },
      error: (e) => this.fail(e),
    });
  }
  logout() {
    this.error.set('');
    this.notice.set('');
    this.sessionService.logout();
    this.profile.set(null);
    this.orders.set([]);
    this.requests.set([]);
    this.detail.set(null);
    this.cart.set([]);
    this.mode = 'login';
    this.tab = 'catalog';
    this.router.navigateByUrl('/portal');
  }
  private fail(e: any) {
    this.busy.set(false);
    if (e.status === 401 && this.session()?.role === 'CUSTOMER') {
      this.logout();
      this.notice.set('Your session expired. Sign in again.');
    }
    this.error.set(e.error?.error?.message ?? 'Unable to complete this action.');
  }
}

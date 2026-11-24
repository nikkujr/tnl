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
import { ContactFieldsComponent, contactEntry, contactText } from '../../shared/contact-fields.component';
import { AppFormsModule } from '../../shared/app-forms.module';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BusinessApi, CatalogOffer } from '../../core/business-api.service';
import { SessionService } from '../../core/session.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { GuidedChatComponent } from '../../shared/guided-chat.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { ToastService } from '../../shared/toast.service';
@Component({
  selector: 'app-customer-portal',
  imports: [ActionDialogComponent, ContactFieldsComponent, AppFormsModule, CurrencyPipe, DatePipe, GuidedChatComponent, AppIconComponent, RouterLink],
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
  private readonly toast = inject(ToastService);
  readonly busy = signal(false);
  readonly confirmDialog = inject(ConfirmDialogService);
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
  readonly ordersLoading = signal(false);
  readonly ordersError = signal('');
  readonly orderTotal = signal(0);
  readonly orderPage = signal(1);
  readonly orderLimit = signal(10);
  readonly orderPageCount = computed(() => Math.max(1, Math.ceil(this.orderTotal() / this.orderLimit())));
  orderSearch = '';
  orderStatus = '';
  deliveryStatus = '';
  orderPaymentStatus = '';
  private orderRequest?: Subscription;
  private readonly ordersSummary = viewChild<ElementRef<HTMLElement>>('ordersSummary');
  private appliedOrderQuery: Record<string, string | number | null> = { tab: 'orders' };
  readonly requests = signal<any[]>([]);
  readonly profile = signal<any>(null);
  readonly cart = signal<Array<{ offer: CatalogOffer; quantity: number }>>([]);
  tab = 'catalog';
  marketingOptIn = false;
  deliveryAddress = contactEntry();
  paymentMethod = 'Cash on delivery';
  search = '';
  unsubscribe = '';
  constructor() {
    const query = this.route.snapshot.queryParamMap;
    this.unsubscribe = query.get('unsubscribe') ?? '';
    if (query.get('tab') === 'orders') this.tab = 'orders';
    this.orderSearch = query.get('orderSearch') ?? '';
    this.orderStatus = query.get('orderStatus') ?? '';
    this.deliveryStatus = query.get('deliveryStatus') ?? '';
    this.orderPaymentStatus = query.get('orderPaymentStatus') ?? '';
    this.orderPage.set(Math.max(1, Number(query.get('orderPage')) || 1));
    this.orderLimit.set([10, 20, 50].includes(Number(query.get('orderLimit'))) ? Number(query.get('orderLimit')) : 10);
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
        this.deliveryAddress = contactEntry(r.data.address, r.data.addressParts);
        this.marketingOptIn = Boolean(r.data.marketingOptIn);
      },
      error: (e) => this.fail(e),
    });
    this.loadOrders();
    this.api
      .get<any[]>('customer/requests')
      .subscribe({ next: (r) => this.requests.set(r.data), error: (e) => this.fail(e) });
  }
  orderListQuery() {
    return { tab: 'orders', orderSearch: this.orderSearch || null, orderStatus: this.orderStatus || null,
      deliveryStatus: this.deliveryStatus || null, orderPaymentStatus: this.orderPaymentStatus || null,
      orderPage: this.orderPage(), orderLimit: this.orderLimit() };
  }
  loadOrders() {
    this.orderRequest?.unsubscribe();
    this.ordersLoading.set(true);
    this.ordersError.set('');
    const listQuery = this.orderListQuery();
    this.orderRequest = this.api.get<any[]>('customer/orders', {
      search: this.orderSearch, orderStatus: this.orderStatus, deliveryStatus: this.deliveryStatus,
      paymentStatus: this.orderPaymentStatus, page: this.orderPage(), limit: this.orderLimit(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        this.orders.set(r.data);
        this.orderTotal.set(r.meta?.total ?? r.data.length);
        this.orderPage.set(r.meta?.page ?? 1);
        this.ordersLoading.set(false);
        this.appliedOrderQuery = { ...listQuery, orderPage: this.orderPage() };
        if (this.tab === 'orders') void this.router.navigate([], { relativeTo: this.route, queryParams: this.appliedOrderQuery, queryParamsHandling: 'merge', replaceUrl: true });
      },
      error: e => {
        this.orders.set([]);
        this.ordersLoading.set(false);
        this.ordersError.set(e.error?.error?.message ?? 'Unable to load orders. Please try again.');
        if (e.status === 401) this.fail(e);
      },
    });
  }
  filterOrders() { this.orderPage.set(1); this.loadOrders(); }
  clearOrderFilters() {
    this.orderSearch = this.orderStatus = this.deliveryStatus = this.orderPaymentStatus = '';
    this.filterOrders();
  }
  changeOrderPage(page: number) {
    if (page < 1 || page > this.orderPageCount() || this.ordersLoading()) return;
    this.orderPage.set(page);
    this.loadOrders();
    const summary = this.ordersSummary()?.nativeElement;
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({ block: 'start' });
  }
  async cancelRequest(id: number) {
    const confirmed = await this.confirmDialog.open({
      title: 'Cancel request?',
      message: 'This request will be closed. You can submit a new request later.',
      confirmLabel: 'Cancel request', tone: 'danger',
    });
    if (!confirmed || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.api.post('customer/requests/' + id + '/cancel').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.requests.update((rows) => rows.map((row) => row.id === id ? { ...row, status: 'CANCELLED' } : row));
        this.notice.set('Request cancelled.');
      },
      error: (error) => this.fail(error),
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
  requestLineIndex(index: number): number {
    const lines = this.cart();
    return lines.slice(0, index).filter(line => line.offer.kind === lines[index].offer.kind).length;
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
        deliveryAddress: contactText(this.deliveryAddress, 'address'),
        deliveryAddressParts: this.deliveryAddress.parts ?? undefined,
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
    void this.router.navigate(['/portal/orders', id], { queryParams: this.appliedOrderQuery });
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
        if (this.session()?.role === 'CUSTOMER') void this.router.navigate(['/portal'], { replaceUrl: true });
      },
      error: (e) => this.fail(e),
    });
  }
  logout() {
    this.error.set('');
    this.notice.set('');
    this.sessionService.logout();
    this.orderRequest?.unsubscribe();
    this.profile.set(null);
    this.orders.set([]);
    this.requests.set([]);
    this.cart.set([]);
    this.tab = 'catalog';
    void this.router.navigate(['/'], { fragment: 'sign-in' });
  }
  private fail(e: any) {
    this.busy.set(false);
    if (e.status === 401 && this.session()?.role === 'CUSTOMER') {
      this.logout();
      this.toast.warn('Your session expired. Sign in again.');
      return;
    }
    this.error.set(e.error?.error?.message ?? 'Unable to complete this action.');
  }
}

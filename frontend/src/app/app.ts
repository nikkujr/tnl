import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { forkJoin } from 'rxjs';
import { ActionDialogComponent, ActionDialogConfig } from './shared/action-dialog.component';
import { AppIconComponent, AppIconName } from './shared/app-icon.component';
import { LandingBackdropComponent } from './shared/landing-backdrop.component';
import { formatMoney } from './shared/money';
import { ToastService } from './shared/toast.service';
import { ToastContainerComponent } from './shared/toast-container.component';
import { ConfirmDialogService } from './shared/confirm-dialog.service';
import { SessionService } from './core/session.service';
import { ThemeService } from './core/theme.service';
import { GuidedChatComponent } from './shared/guided-chat.component';
import { BusinessApi } from './core/business-api.service';
import {
  ApiService,
  Agent,
  Customer,
  DashboardNotification,
  DashboardSummary,
  Order,
  Product,
  Role,
  TrackingResult,
} from './core/api.service';

@Component({
  selector: 'app-root',
  imports: [
    DatePipe,
    FormsModule,
    RouterOutlet,
    ActionDialogComponent,
    AppIconComponent,
    LandingBackdropComponent,
    ToastContainerComponent,
    GuidedChatComponent,
  ],
  templateUrl: './app.html',
  styleUrls: [
    './app.scss',
    './landing.scss',
    './theme-overrides.scss',
    './dashboard-cards.scss',
    './pastel-theme.scss',
    './orders-controls.scss',
    './notifications.scss',
    './sidebar-nav.scss',
    './admin-motion.scss',
    './header-account.scss',
  ],
})
export class App implements OnInit, OnDestroy {
  private readonly business = inject(BusinessApi);
  private readonly customerSessionEffect = effect(() => {
    if (this.session()?.role === 'CUSTOMER' && this.notificationRefreshTimer) {
      clearInterval(this.notificationRefreshTimer);
      this.notificationRefreshTimer = null;
    }
  });
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly sessionService = inject(SessionService);
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);
  readonly themeService = inject(ThemeService);
  readonly today = new Date();
  readonly session = this.sessionService.session;
  readonly loading = signal(false);
  readonly loginError = signal('');
  readonly mobileNavOpen = signal(false);
  private notificationRefreshTimer: ReturnType<typeof setInterval> | null = null;
  readonly showOrderForm = signal(false);
  /** Current URL path, cleaned of leading/trailing slashes and query/hash (e.g. 'orders/5', 'tracking', ''). */
  readonly routedPath = signal('');
  readonly isNewOrderPage = computed(() => this.routedPath() === 'orders/new');
  readonly isOrderDetailPage = computed(() => /^orders\/\d+$/.test(this.routedPath()));
  readonly isAgentDetailPage = computed(() => /^agents\/\d+$/.test(this.routedPath()));
  readonly isImportsPage = computed(
    () => this.routedPath() === 'imports' || /^imports\/\d+$/.test(this.routedPath()),
  );
  readonly isOrdersListPage = computed(() => this.routedPath() === 'orders');
  readonly isTrackingPage = computed(() => this.routedPath() === 'tracking');
  readonly isCategoriesPage = computed(() => this.routedPath() === 'categories');
  readonly isLeadsPage = computed(() => this.routedPath() === 'leads');
  readonly isCampaignsPage = computed(() => this.routedPath() === 'campaigns');
  readonly isAgentsPage = computed(() => this.routedPath() === 'agents');
  readonly isCommissionsPage = computed(() => this.routedPath() === 'commissions');
  readonly isProductsPage = computed(() => this.routedPath() === 'products');
  readonly isInventoryPage = computed(() => this.routedPath() === 'inventory');
  readonly isCustomersPage = computed(() => this.routedPath() === 'customers');
  readonly anyModalOpen = computed(
    () => this.showOrderForm() || this.confirmDialog.config() !== null,
  );
  private readonly lockBodyScroll = effect(() => {
    document.body.style.overflow = this.anyModalOpen() ? 'hidden' : '';
  });
  readonly summary = signal<DashboardSummary>({
    totalOrders: 0,
    pendingOrders: 0,
    completedOrders: 0,
    openOrders: 0,
    revenue: 0,
    activeDeliveries: 0,
    totalCustomers: 0,
    totalProducts: 0,
    lowStockProducts: 0,
    monthlyRevenue: [],
    notifications: [],
  });
  readonly customers = signal<Customer[]>([]);
  readonly products = signal<Product[]>([]);
  readonly trackingResult = signal<TrackingResult | null>(null);
  readonly trackingError = signal('');
  readonly agents = signal<Agent[]>([]);
  readonly activeAgents = computed(() => this.agents().filter((agent) => agent.active));
  readonly notificationPanelOpen = signal(false);
  @ViewChild('notificationCenter') private notificationCenterRef?: ElementRef<HTMLElement>;
  readonly themeMenuOpen = signal(false);
  @ViewChild('themeCenter') private themeCenterRef?: ElementRef<HTMLElement>;
  readonly accountMenuOpen = signal(false);
  @ViewChild('accountCenter') private accountCenterRef?: ElementRef<HTMLElement>;
  readonly notificationReadAt = signal(0);
  readonly unreadNotifications = computed(() =>
    this.summary().notifications.filter((item) => !item.readAt),
  );

  loginEmail = 'admin@tnl.local';
  loginPassword = 'TnlDemo123!';
  trackingNumber = '';
  editingOrderId: number | null = null;
  newOrder = {
    customerId: 0,
    agentId: 0,
    items: [{ productId: 0, quantity: 1 }],
    packages: [] as Array<{ packageId: number; quantity: number }>,
    deliveryAddress: '',
    paymentMethod: 'Bank transfer',
    cashReceived: 0,
  };
  editingPackageNames: Record<number, string> = {};

  readonly visibleNavigation = computed<
    Array<
      | 'Overview'
      | 'Packages'
      | 'Requests'
      | 'Automations'
      | 'Orders'
      | 'Customers'
      | 'Tracking'
      | 'Categories'
      | 'Products'
      | 'Inventory'
      | 'Commissions'
    >
  >(() =>
    this.session()?.role === 'ADMIN'
      ? [
          'Overview',
          'Packages',
          'Requests',
          'Automations',
          'Orders',
          'Customers',
          'Categories',
          'Products',
          'Inventory',
          'Tracking',
        ]
      : ['Overview', 'Packages', 'Requests', 'Orders', 'Customers', 'Commissions', 'Tracking'],
  );
  readonly initials = computed(
    () =>
      this.session()
        ?.fullName.split(' ')
        .map((part) => part[0])
        .join('') ?? '',
  );

  ngOnInit(): void {
    const browserUrl = `${window.location.pathname}${window.location.search}`;
    this.routedPath.set(App.cleanPath(browserUrl));
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.routedPath.set(App.cleanPath(event.urlAfterRedirects));
        if (this.session() && this.session()?.role !== 'CUSTOMER')
          this.applyWorkspaceRoute(event.urlAfterRedirects);
        const flash = sessionStorage.getItem('tnl_flash');
        if (flash) {
          sessionStorage.removeItem('tnl_flash');
          this.showSuccess(flash);
        }
      });
    if (this.session() && this.session()?.role !== 'CUSTOMER') {
      this.restoreNotificationReadTime(this.session()!.id);
      this.applyWorkspaceRoute(browserUrl);
      this.loadWorkspace();
      this.startNotificationRefresh();
    }
    if (this.session()?.role === 'CUSTOMER' && App.cleanPath(browserUrl) === '')
      this.router.navigateByUrl('/portal');
  }

  login(): void {
    this.loading.set(true);
    this.loginError.set('');
    this.sessionService.login(this.loginEmail, this.loginPassword).subscribe({
      next: (data) => {
        this.restoreNotificationReadTime(data.user.id);
        this.applyWorkspaceRoute(this.router.url);
        this.loadWorkspace();
        this.startNotificationRefresh();
      },
      error: (error) => {
        this.loading.set(false);
        this.loginError.set(
          error.error?.error?.message ??
            'Unable to sign in. Confirm that the API and database are running.',
        );
      },
    });
  }

  logout(): void {
    this.accountMenuOpen.set(false);
    this.mobileNavOpen.set(false);
    this.notificationPanelOpen.set(false);
    if (this.notificationRefreshTimer) clearInterval(this.notificationRefreshTimer);
    this.notificationRefreshTimer = null;
    this.sessionService.logout();
    this.customers.set([]);
    this.products.set([]);
    this.router.navigateByUrl('/');
  }

  loadWorkspace(): void {
    if (this.session()?.role === 'CUSTOMER') return;
    this.loading.set(true);
    this.toast.dismissError();
    const requests: {
      dashboard: ReturnType<ApiService['getDashboard']>;
      customers: ReturnType<ApiService['getCustomers']>;
      products: ReturnType<ApiService['getProducts']>;
      agents?: ReturnType<ApiService['getAgents']>;
    } = {
      dashboard: this.api.getDashboard(),
      customers: this.api.getCustomers({ limit: 100 }),
      products: this.api.getProducts({ limit: 100 }),
    };
    if (this.session()?.role === 'ADMIN') {
      requests.agents = this.api.getAgents();
    }
    forkJoin(requests).subscribe({
      next: (result) => {
        this.summary.set(result.dashboard.data);
        this.customers.set(result.customers.data);
        this.products.set(result.products.data);
        this.agents.set(result.agents?.data ?? []);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        if (error.status === 401) this.logout();
        this.setError(error.error?.error?.message ?? 'Unable to load workspace data from the API.');
      },
    });
  }

  isNavActive(item: string): boolean {
    const path = item === 'Overview' ? 'dashboard' : item.toLowerCase();
    return this.routedPath() === path;
  }
  selectView(view: string): void {
    this.mobileNavOpen.set(false);
    this.notificationPanelOpen.set(false);
    this.toast.dismissError();
    const path = view === 'Overview' ? 'dashboard' : view.toLowerCase();
    this.router.navigateByUrl(`/${path}`);
  }
  private static cleanPath(url: string): string {
    return url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
  }
  private applyWorkspaceRoute(url: string): void {
    this.toast.dismissError();
    this.notificationPanelOpen.set(false);
    const [rawPath, rawQuery] = url.split(/[?#]/);
    const path = rawPath.replace(/^\/+|\/+$/g, '');
    if (path === '') {
      this.router.navigateByUrl('/dashboard');
      return;
    }
    if (path === 'orders' && rawQuery) {
      const editId = Number(new URLSearchParams(rawQuery).get('edit'));
      if (editId) {
        this.api.getOrder(editId).subscribe({ next: ({ data }) => this.openNewOrder(data) });
        this.router.navigateByUrl('/orders', { replaceUrl: true });
      }
    }
  }
  toggleNotifications(): void {
    this.accountMenuOpen.set(false);
    this.notificationPanelOpen.update((open) => !open);
  }
  toggleThemeMenu(): void {
    this.accountMenuOpen.set(false);
    this.themeMenuOpen.update((open) => !open);
  }
  toggleAccountMenu(): void {
    this.themeMenuOpen.set(false);
    this.notificationPanelOpen.set(false);
    this.accountMenuOpen.update((open) => !open);
  }
  openMyAccount(): void {
    this.accountMenuOpen.set(false);
    this.router.navigateByUrl('/account');
  }
  @HostListener('document:keydown.escape')
  closeAccountMenu(): void {
    if (!this.accountMenuOpen()) return;
    this.accountMenuOpen.set(false);
    this.accountCenterRef?.nativeElement
      .querySelector<HTMLButtonElement>('.account-trigger')
      ?.focus();
  }
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    if (this.notificationPanelOpen() && !this.notificationCenterRef?.nativeElement.contains(target))
      this.notificationPanelOpen.set(false);
    if (this.themeMenuOpen() && !this.themeCenterRef?.nativeElement.contains(target))
      this.themeMenuOpen.set(false);
    if (this.accountMenuOpen() && !this.accountCenterRef?.nativeElement.contains(target))
      this.accountMenuOpen.set(false);
  }
  markNotificationsRead(): void {
    this.business.post('notifications/read').subscribe({
      next: () =>
        this.summary.update((s) => ({
          ...s,
          notifications: s.notifications.map((n) => ({ ...n, readAt: new Date().toISOString() })),
        })),
    });
  }
  isNotificationUnread(createdAt: string): boolean {
    return new Date(createdAt).getTime() > this.notificationReadAt();
  }
  openNotification(item: DashboardNotification): void {
    this.markNotificationsRead();
    this.notificationPanelOpen.set(false);
    this.router.navigateByUrl(item.link);
  }
  private restoreNotificationReadTime(userId: number): void {
    this.notificationReadAt.set(
      Number(localStorage.getItem(`tnl_notifications_read_${userId}`) ?? 0),
    );
  }
  private startNotificationRefresh(): void {
    if (this.notificationRefreshTimer) clearInterval(this.notificationRefreshTimer);
    this.notificationRefreshTimer = setInterval(() => {
      if (!this.session() || this.session()?.role === 'CUSTOMER') return;
      this.api.getDashboard().subscribe({ next: ({ data }) => this.summary.set(data) });
    }, 30_000);
  }
  ngOnDestroy(): void {
    if (this.notificationRefreshTimer) clearInterval(this.notificationRefreshTimer);
  }
  openNewOrder(order?: Order): void {
    if (!order) {
      this.router.navigateByUrl('/orders/new');
      return;
    }
    this.editingOrderId = order?.id ?? null;
    this.newOrder = {
      customerId: order?.customerId ?? this.customers()[0]?.id ?? 0,
      agentId:
        order?.agentId ??
        this.agents()[0]?.id ??
        (this.session()?.role === 'AGENT' ? this.session()!.id : 0),
      items: order?.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })) ?? [{ productId: this.products()[0]?.id ?? 0, quantity: 1 }],
      packages:
        order?.packages.map((p) => ({ packageId: p.packageId, quantity: p.quantity })) ?? [],
      cashReceived: order?.cashReceived ?? 0,
      deliveryAddress: order?.deliveryAddress ?? this.customers()[0]?.address ?? '',
      paymentMethod: order?.paymentMethod ?? 'Bank transfer',
    };
    this.editingPackageNames = Object.fromEntries(
      (order?.packages ?? []).map((p) => [p.packageId, p.name]),
    );
    this.showOrderForm.set(true);
  }
  closeNewOrder(): void {
    this.showOrderForm.set(false);
  }
  addOrderItem(): void {
    if (this.session()?.role !== 'ADMIN') return;
    const used = new Set(this.newOrder.items.map((item) => item.productId));
    const product = this.products().find((item) => !used.has(item.id));
    if (!product) {
      this.setError('All available products are already included.');
      return;
    }
    this.newOrder.items.push({ productId: product.id, quantity: 1 });
  }
  removeOrderItem(index: number): void {
    if (this.newOrder.items.length <= 1 && !this.newOrder.packages.length) return;
    const product = this.products().find(
      (item) => item.id === this.newOrder.items[index].productId,
    );
    this.openDialog(
      {
        title: 'Remove item?',
        message: `${product?.name ?? 'This item'} will be removed from the order.`,
        confirmLabel: 'Remove item',
        tone: 'danger',
      },
      () => {
        this.newOrder.items.splice(index, 1);
      },
    );
  }
  submitOrder(): void {
    if (this.session()?.role === 'ADMIN' && !this.newOrder.agentId) {
      this.setError('Select an assigned agent.');
      return;
    }
    this.loading.set(true);
    const request = this.editingOrderId
      ? this.api.updateOrder(this.editingOrderId, this.newOrder)
      : this.api.createOrder(this.newOrder);
    request.subscribe({
      next: () => {
        this.closeNewOrder();
        this.showSuccess(this.editingOrderId ? 'Order updated.' : 'Order created.');
        this.loadWorkspace();
      },
      error: (error) => {
        this.loading.set(false);
        this.setError(error.error?.error?.message ?? 'Unable to create order.');
      },
    });
  }
  private openDialog(
    config: ActionDialogConfig,
    action: (values: Record<string, string | number>) => void,
  ): void {
    this.confirmDialog.open(config).then((values) => {
      if (values) action(values);
    });
  }
  showSuccess(message: string): void {
    this.toast.success(message);
  }
  private setError(message: string): void {
    this.toast.fail(message);
  }
  track(): void {
    const value = this.trackingNumber.trim().toUpperCase();
    if (!value) return;
    this.loading.set(true);
    this.trackingError.set('');
    this.api.track(value).subscribe({
      next: ({ data }) => {
        this.trackingResult.set(data);
        this.trackingNumber = data.trackingNumber;
        this.loading.set(false);
      },
      error: (error) => {
        this.trackingResult.set(null);
        this.loading.set(false);
        this.trackingError.set(error.error?.error?.message ?? 'Tracking number not found.');
      },
    });
  }
  titleCase(value: string | null): string {
    return value
      ? value
          .toLowerCase()
          .split('_')
          .map((part) => part[0]?.toUpperCase() + part.slice(1))
          .join(' ')
      : 'Not started';
  }
  money(value: number): string {
    return formatMoney(value);
  }
  iconFor(view: string): AppIconName {
    return (
      (
        {
          Overview: 'dashboard',
          Packages: 'products',
          Requests: 'orders',
          Automations: 'dashboard',
          Orders: 'orders',
          Customers: 'customers',
          Categories: 'categories',
          Products: 'products',
          Inventory: 'inventory',
          Tracking: 'tracking',
          Leads: 'leads',
          Campaigns: 'campaigns',
          Agents: 'agents',
          Performance: 'gauge',
          Commissions: 'commissions',
        } as Record<string, AppIconName>
      )[view] ?? 'gauge'
    );
  }
  useAccount(role: Role): void {
    this.loginEmail = role === 'ADMIN' ? 'admin@tnl.local' : 'agent@tnl.local';
    this.loginPassword = 'TnlDemo123!';
  }
}

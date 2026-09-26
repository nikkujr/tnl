import { CurrencyPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, ElementRef, HostListener, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { forkJoin } from 'rxjs';
import { ActionDialogComponent, ActionDialogConfig } from './shared/action-dialog.component';
import { AppIconComponent, AppIconName } from './shared/app-icon.component';
import { LandingBackdropComponent } from './shared/landing-backdrop.component';
import { RichTextEditorComponent } from './shared/rich-text-editor.component';
import { DELIVERY_STEPS, DeliveryStatus, nextDeliveryStep } from './shared/delivery-steps';
import { buildPaymentDialogFields, PaymentStatus, validateCashPayment } from './shared/order-payment';
import { formatMoney } from './shared/money';
import {
  ApiService,
  Agent,
  Campaign,
  Category,
  Customer,
  DashboardNotification,
  DashboardSummary,
  Lead,
  Order,
  Product,
  Commission,
  Role,
  SessionUser,
  TrackingResult
} from './core/api.service';

type View = 'Overview' | 'Orders' | 'Customers' | 'Categories' | 'Products' | 'Inventory' | 'Tracking' | 'Leads' | 'Campaigns' | 'Agents' | 'Commissions';

const VIEW_ROUTES: Record<View, string> = {
  Overview: 'dashboard', Orders: 'orders', Customers: 'customers',
  Categories: 'categories', Products: 'products', Inventory: 'inventory',
  Tracking: 'tracking', Leads: 'leads', Campaigns: 'campaigns',
  Agents: 'agents', Commissions: 'commissions'
};

const ROUTE_VIEWS = Object.fromEntries(
  Object.entries(VIEW_ROUTES).map(([view, route]) => [route, view])
) as Record<string, View>;

@Component({
  selector: 'app-root',
  imports: [CurrencyPipe, DatePipe, FormsModule, NgTemplateOutlet, RouterOutlet, ActionDialogComponent, AppIconComponent, LandingBackdropComponent, RichTextEditorComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.scss', './landing.scss', './theme-overrides.scss', './dashboard-cards.scss', './pastel-theme.scss', './orders-controls.scss', './notifications.scss', './sidebar-nav.scss', './admin-motion.scss']
})
export class App implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly today = new Date();
  readonly view = signal<View>('Overview');
  readonly session = signal<SessionUser | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly loginError = signal('');
  readonly notice = signal('');
  readonly actionDialog = signal<ActionDialogConfig | null>(null);
  readonly mobileNavOpen = signal(false);
  private dialogAction: ((values: Record<string, string | number>) => void) | null = null;
  private notificationRefreshTimer: ReturnType<typeof setInterval> | null = null;
  readonly showOrderForm = signal(false);
  readonly showCustomerForm = signal(false);
  readonly isNewOrderPage = signal(false);
  readonly viewingOrderId = signal<number | null>(null);
  readonly isOrderDetailPage = computed(() => this.viewingOrderId() !== null);
  readonly viewingAgentId = signal<number | null>(null);
  readonly isAgentDetailPage = computed(() => this.viewingAgentId() !== null);
  readonly showCategoryForm = signal(false);
  readonly showProductForm = signal(false);
  readonly showLeadForm = signal(false);
  readonly showCampaignForm = signal(false);
  readonly showAgentForm = signal(false);
  readonly anyModalOpen = computed(() =>
    this.showOrderForm() || this.showCategoryForm() || this.showProductForm() ||
    this.showCustomerForm() || this.showLeadForm() || this.showCampaignForm() || this.showAgentForm() || this.actionDialog() !== null
  );
  private readonly lockBodyScroll = effect(() => {
    document.body.style.overflow = this.anyModalOpen() ? 'hidden' : '';
  });
  readonly summary = signal<DashboardSummary>({
    totalOrders: 0, pendingOrders: 0, completedOrders: 0, openOrders: 0, revenue: 0,
    activeDeliveries: 0, totalCustomers: 0, totalProducts: 0, lowStockProducts: 0,
    monthlyRevenue: [], notifications: []
  });
  readonly orders = signal<Order[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly trackingResult = signal<TrackingResult | null>(null);
  readonly leads = signal<Lead[]>([]);
  readonly campaigns = signal<Campaign[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly activeAgents = computed(() => this.agents().filter((agent) => agent.active));
  readonly commissions = signal<Commission[]>([]);
  readonly notificationPanelOpen = signal(false);
  @ViewChild('notificationCenter') private notificationCenterRef?: ElementRef<HTMLElement>;
  readonly notificationReadAt = signal(0);
  readonly unreadNotifications = computed(() =>
    this.summary().notifications.filter((item) => new Date(item.createdAt).getTime() > this.notificationReadAt())
  );

  loginEmail = 'admin@tnl.local';
  loginPassword = 'TnlDemo123!';
  orderSearch = '';
  customerSearch = '';
  orderStatus = 'All';
  trackingNumber = '';
  categorySearch = '';
  productSearch = '';
  inventoryHealth = 'ALL';
  editingCategoryId: number | null = null;
  editingCustomerId: number | null = null;
  editingProductId: number | null = null;
  editingLeadId: number | null = null;
  editingCampaignId: number | null = null;
  editingAgentId: number | null = null;
  editingOrderId: number | null = null;
  categoryForm = { name: '', description: '' };
  customerForm = { fullName: '', email: '', phone: '', address: '', assignedAgentId: null as number|null };
  productForm = { categoryId: 0, name: '', sku: '', price: 0, description: '' };
  leadForm = { fullName: '', email: '', phone: '', source: '', assignedAgentId: null as number|null, status: 'NEW' };
  campaignForm = { name: '', targetAudience: '', content: '', startDate: '', endDate: '', status: 'DRAFT' };
  agentForm = { fullName: '', email: '', phone: '', password: '', commissionRate: 0 };
  newOrder = { customerId: 0, agentId: 0, items: [{ productId: 0, quantity: 1 }], deliveryAddress: '', paymentMethod: 'Bank transfer' };

  readonly revenueBars = computed(() => {
    const values = new Map(this.summary().monthlyRevenue.map((item) => [item.month, item.revenue]));
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(this.today.getFullYear(), this.today.getMonth() - 5 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return { key, month: date.toLocaleString('en', { month: 'short' }), revenue: values.get(key) ?? 0 };
    });
    const maximum = Math.max(...months.map((item) => item.revenue), 1);
    return months.map((item) => ({ ...item, value: item.revenue === 0 ? 0 : Math.max(6, (item.revenue / maximum) * 100) }));
  });

  readonly visibleNavigation = computed<View[]>(() =>
    this.session()?.role === 'ADMIN'
      ? ['Overview', 'Orders', 'Customers', 'Categories', 'Products', 'Inventory', 'Tracking']
      : ['Overview', 'Orders', 'Customers', 'Commissions', 'Tracking']
  );
  readonly initials = computed(() => this.session()?.fullName.split(' ').map((part) => part[0]).join('') ?? '');
  readonly firstName = computed(() => this.session()?.fullName.split(' ')[0] ?? '');
  readonly recentOrders = computed(() => this.orders().slice(0, 4));
  readonly metrics = computed(() => {
    const summary = this.summary();
    return [
      { label: 'Revenue', value: this.money(summary.revenue), change: 'Paid', note: 'recognized', icon:'commissions' as AppIconName, destination:'Orders' as View },
      { label: 'Open orders', value: String(summary.openOrders), change: `${summary.pendingOrders} pending`, note: 'now', icon:'orders' as AppIconName, destination:'Orders' as View, filter:'Open' },
      this.session()?.role === 'ADMIN'
        ? { label: 'Customers', value: String(summary.totalCustomers), change: 'Live', note: 'records', icon:'customers' as AppIconName, destination:'Customers' as View }
        : { label: 'Completed', value: String(summary.completedOrders), change: 'Your', note: 'orders', icon:'check' as AppIconName, destination:'Orders' as View },
      { label: 'Low stock', value: String(summary.lowStockProducts), change: `${summary.totalProducts} total`, note: 'products', icon:'inventory' as AppIconName, destination:'Inventory' as View, filter:'LOW' }
    ];
  });
  readonly attentionItems = computed(() => {
    const lowStock = this.session()?.role === 'ADMIN'
      ? this.products().filter((product) => product.stockOnHand <= product.lowStockThreshold).slice(0, 2)
        .map((product) => ({ title: product.name, detail: `${product.stockOnHand} left · threshold ${product.lowStockThreshold}`, action: 'Restock', destination: 'Inventory' as View }))
      : [];
    const pending = this.orders().find((order) => order.orderStatus === 'PENDING');
    return pending
      ? [...lowStock, { title: pending.trackingNumber, detail: 'Awaiting approval', action: 'Review', destination: 'Orders' as View }]
      : lowStock;
  });

  ngOnInit(): void {
    const browserUrl = `${window.location.pathname}${window.location.search}`;
    this.isNewOrderPage.set(browserUrl.startsWith('/orders/new'));
    this.viewingOrderId.set(this.matchOrderDetailId(browserUrl));
    this.viewingAgentId.set(this.matchDetailId(browserUrl, 'agents'));
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      const wasSubPage = this.isNewOrderPage() || this.isOrderDetailPage() || this.isAgentDetailPage();
      this.isNewOrderPage.set(event.urlAfterRedirects.startsWith('/orders/new'));
      this.viewingOrderId.set(this.matchOrderDetailId(event.urlAfterRedirects));
      this.viewingAgentId.set(this.matchDetailId(event.urlAfterRedirects, 'agents'));
      if (this.session()) this.applyWorkspaceRoute(event.urlAfterRedirects);
      if (wasSubPage && !this.isNewOrderPage() && !this.isOrderDetailPage() && !this.isAgentDetailPage()) {const flash=sessionStorage.getItem('tnl_flash');if(flash){sessionStorage.removeItem('tnl_flash');this.showSuccess(flash);}this.loadWorkspace();}
    });
    const token = sessionStorage.getItem('tnl_access_token');
    const storedUser = sessionStorage.getItem('tnl_user');
    if (token && storedUser) {
      try {
        const user = JSON.parse(storedUser) as SessionUser;
        this.session.set(user);
        this.restoreNotificationReadTime(user.id);
        this.applyWorkspaceRoute(browserUrl);
        this.loadWorkspace();
        this.startNotificationRefresh();
      } catch {
        this.logout();
      }
    }
  }


  login(): void {
    this.loading.set(true);
    this.loginError.set('');
    this.api.login(this.loginEmail, this.loginPassword).subscribe({
      next: ({ data }) => {
        sessionStorage.setItem('tnl_access_token', data.token);
        sessionStorage.setItem('tnl_user', JSON.stringify(data.user));
        this.session.set(data.user);
        this.restoreNotificationReadTime(data.user.id);
        if (this.router.url === '/' || this.router.url === '') this.selectView('Overview');
        else this.applyWorkspaceRoute(this.router.url);
        this.loadWorkspace();
        this.startNotificationRefresh();
      },
      error: (error) => {
        this.loading.set(false);
        this.loginError.set(error.error?.error?.message ?? 'Unable to sign in. Confirm that the API and database are running.');
      }
    });
  }
  loadAdminModules(): void {
    forkJoin({ leads:this.api.getLeads(), campaigns:this.api.getCampaigns(), agents:this.api.getAgents(), commissions:this.api.getCommissions() }).subscribe({
      next:(result)=>{this.leads.set(result.leads.data);this.campaigns.set(result.campaigns.data);this.agents.set(result.agents.data);this.commissions.set(result.commissions.data);this.loading.set(false);},
      error:(error)=>{this.loading.set(false);this.setError(error.error?.error?.message ?? 'Unable to load administration modules.');}
    });
  }
  loadCommissions(): void { this.api.getCommissions().subscribe({next:({data})=>{this.commissions.set(data);this.loading.set(false);},error:(error)=>{this.loading.set(false);this.setError(error.error?.error?.message ?? 'Unable to load commissions.');}}); }
  openLeadForm(item?:Lead):void{
    this.editingLeadId=item?.id??null;
    this.leadForm={fullName:item?.fullName??'',email:item?.email??'',phone:item?.phone??'',source:item?.source??'',assignedAgentId:item?.assignedAgentId??null,status:item?.status==='CONVERTED'?'QUALIFIED':item?.status??'NEW'};
    this.showLeadForm.set(true);
  }
  saveLead():void{
    const input={...this.leadForm} as Omit<Lead,'id'|'assignedAgentName'>;
    const request=this.editingLeadId?this.api.updateLead(this.editingLeadId,input):this.api.createLead(input);
    this.loading.set(true);
    request.subscribe({next:()=>{this.showLeadForm.set(false);this.showSuccess(this.editingLeadId?'Lead updated.':'Lead created.');this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to save lead.')});
  }
  convertLead(lead:Lead):void{this.api.convertLead(lead.id).subscribe({next:()=>{this.showSuccess('Lead converted to customer.');this.loadWorkspace();},error:(e)=>this.handleMutationError(e,'Unable to convert lead.')});}
  removeLead(lead:Lead):void{this.openDialog({title:'Delete lead?',message:`"${lead.fullName}" will be permanently removed.`,confirmLabel:'Delete lead',tone:'danger'},()=>this.api.deleteLead(lead.id).subscribe({next:()=>{this.showSuccess('Lead deleted.');this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to delete lead.')}));}
  openCampaignForm(item?:Campaign):void{
    this.editingCampaignId=item?.id??null;
    this.campaignForm={name:item?.name??'',targetAudience:item?.targetAudience??'',content:item?.content??'',startDate:item?.startDate?.slice(0,10)??'',endDate:item?.endDate?.slice(0,10)??'',status:item?.status??'DRAFT'};
    this.showCampaignForm.set(true);
  }
  saveCampaign():void{
    if(this.campaignForm.endDate<=this.campaignForm.startDate){this.setError('Campaign end date must be later than its start date.');return;}
    const input={...this.campaignForm} as Omit<Campaign,'id'>;
    const request=this.editingCampaignId?this.api.updateCampaign(this.editingCampaignId,input):this.api.createCampaign(input);
    this.loading.set(true);
    request.subscribe({next:()=>{this.showCampaignForm.set(false);this.showSuccess(this.editingCampaignId?'Campaign updated.':'Campaign created.');this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to save campaign.')});
  }
  removeCampaign(item:Campaign):void{this.openDialog({title:'Delete campaign?',message:`"${item.name}" will be permanently removed.`,confirmLabel:'Delete campaign',tone:'danger'},()=>this.api.deleteCampaign(item.id).subscribe({next:()=>{this.showSuccess('Campaign deleted.');this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to delete campaign.')}));}
  sendCampaign(item:Campaign):void{
    this.openDialog({title:'Send campaign email?',message:`"${item.name}" will be sent to all customer email addresses using BCC.`,confirmLabel:'Send campaign'},()=>{
      this.loading.set(true);this.error.set('');this.notice.set('');
      this.api.sendCampaign(item.id).subscribe({next:({data})=>{this.showSuccess(`Campaign sent to ${data.recipientCount} customer${data.recipientCount===1?'':'s'}.`);this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to send campaign email.')});
    });
  }
  openAgentForm(item?:Agent):void{
    this.editingAgentId=item?.id??null;
    this.agentForm={fullName:item?.fullName??'',email:item?.email??'',phone:item?.phone??'',password:'',commissionRate:item?.commissionRate??0};
    this.showAgentForm.set(true);
  }
  saveAgent():void{
    if(!this.editingAgentId&&!this.agentForm.password){this.setError('A password is required for a new agent.');return;}
    const input={...this.agentForm};
    const request=this.editingAgentId?this.api.updateAgent(this.editingAgentId,{...input,password:input.password||undefined}):this.api.createAgent(input);
    this.loading.set(true);
    request.subscribe({next:()=>{this.showAgentForm.set(false);this.showSuccess(this.editingAgentId?'Agent updated.':'Agent created.');this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to save agent.')});
  }
  removeAgent(item:Agent):void{if(item.active)this.openDialog({title:'Deactivate agent?',message:`"${item.fullName}" will lose access and disappear from assignment lists.`,confirmLabel:'Deactivate',tone:'danger'},()=>this.api.deleteAgent(item.id).subscribe({next:()=>{this.showSuccess('Agent deactivated.');this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to deactivate agent.')}));}
  activateAgent(item:Agent):void{if(!item.active)this.openDialog({title:'Activate agent?',message:`"${item.fullName}" will regain login access and become available for assignments.`,confirmLabel:'Activate agent'},()=>this.api.activateAgent(item.id).subscribe({next:()=>{this.showSuccess('Agent activated.');this.loadAdminModules();},error:(e)=>this.handleMutationError(e,'Unable to activate agent.')}));}

  logout(): void {
    this.mobileNavOpen.set(false);
    this.notificationPanelOpen.set(false);
    if (this.notificationRefreshTimer) clearInterval(this.notificationRefreshTimer);
    this.notificationRefreshTimer = null;
    sessionStorage.removeItem('tnl_access_token');
    sessionStorage.removeItem('tnl_user');
    this.session.set(null);
    this.orders.set([]);
    this.customers.set([]);
    this.products.set([]);
    this.view.set('Overview');
    this.router.navigateByUrl('/');
  }

  loadWorkspace(): void {
    this.loading.set(true);
    this.error.set('');
    const requests: {
      dashboard: ReturnType<ApiService['getDashboard']>;
      orders: ReturnType<ApiService['getOrders']>;
      customers: ReturnType<ApiService['getCustomers']>;
      products: ReturnType<ApiService['getProducts']>;
      categories?: ReturnType<ApiService['getCategories']>;
    } = {
      dashboard: this.api.getDashboard(),
      orders: this.api.getOrders(),
      customers: this.api.getCustomers(),
      products: this.api.getProducts()
    };
    if (this.session()?.role === 'ADMIN') requests.categories = this.api.getCategories();
    forkJoin(requests).subscribe({
      next: (result) => {
        this.summary.set(result.dashboard.data);
        this.orders.set(result.orders.data);
        this.customers.set(result.customers.data);
        this.products.set(result.products.data);
        this.categories.set(result.categories?.data ?? []);
        this.loading.set(false);
        if (this.session()?.role === 'ADMIN') this.loadAdminModules();
        else this.loadCommissions();
      },
      error: (error) => {
        this.loading.set(false);
        if (error.status === 401) this.logout();
        this.setError(error.error?.error?.message ?? 'Unable to load workspace data from the API.');
      }
    });
  }

  filteredOrders(): Order[] {
    const query = this.orderSearch.toLowerCase();
    return this.orders().filter((order) =>
      `${order.trackingNumber} ${order.customerName} ${order.items.map((item)=>item.productName).join(' ')}`.toLowerCase().includes(query) &&
      (this.orderStatus === 'All' ||
        (this.orderStatus === 'Open' && ['PENDING','APPROVED'].includes(order.orderStatus)) ||
        this.displayStatus(order) === this.orderStatus)
    );
  }

  filteredCustomers(): Customer[] {
    const query=this.customerSearch.trim().toLowerCase();
    return this.customers().filter((customer)=>`${customer.fullName} ${customer.email} ${customer.phone} ${customer.address} ${customer.assignedAgentName??''}`.toLowerCase().includes(query));
  }

  filteredInventory(): Product[] {
    if(this.inventoryHealth==='LOW')return this.products().filter((product)=>product.stockOnHand<=product.lowStockThreshold);
    if(this.inventoryHealth==='HEALTHY')return this.products().filter((product)=>product.stockOnHand>product.lowStockThreshold);
    return this.products();
  }

  selectView(view: string): void {
    this.mobileNavOpen.set(false);
    this.notificationPanelOpen.set(false);
    this.error.set('');
    const destination = view as View;
    if (!this.isViewAllowed(destination)) {
      this.router.navigateByUrl('/dashboard');
      this.view.set('Overview');
      return;
    }
    this.view.set(destination);
    this.router.navigateByUrl(`/${VIEW_ROUTES[destination]}`);
  }
  private matchOrderDetailId(url: string): number | null {
    return this.matchDetailId(url, 'orders');
  }
  private matchDetailId(url: string, segment: string): number | null {
    const match = url.match(new RegExp(`^/${segment}/(\\d+)(?:[/?#]|$)`));
    return match ? Number(match[1]) : null;
  }
  private applyWorkspaceRoute(url: string): void {
    this.error.set('');
    this.notificationPanelOpen.set(false);
    const [rawPath, rawQuery] = url.split(/[?#]/);
    const path = rawPath.replace(/^\/+|\/+$/g, '');
    if (path === '') {
      this.view.set('Overview');
      this.router.navigateByUrl('/dashboard');
      return;
    }
    if (path === 'orders/new') {
      if (!this.session()) return;
      this.isNewOrderPage.set(true);
      return;
    }
    if (/^orders\/\d+$/.test(path) || /^agents\/\d+$/.test(path)) {
      return;
    }
    const requested = ROUTE_VIEWS[path] ?? null;
    if (!requested || !this.isViewAllowed(requested)) {
      this.view.set('Overview');
      this.router.navigateByUrl('/dashboard');
      return;
    }
    this.view.set(requested);
    if (path === 'orders' && rawQuery) {
      const editId = Number(new URLSearchParams(rawQuery).get('edit'));
      if (editId) {
        const order = this.orders().find((candidate) => candidate.id === editId);
        if (order) this.openNewOrder(order);
        this.router.navigateByUrl('/orders', { replaceUrl: true });
      }
    }
    if (path === 'customers' && rawQuery) {
      const focusId = Number(new URLSearchParams(rawQuery).get('focus'));
      if (focusId) {
        const customer = this.customers().find((candidate) => candidate.id === focusId);
        if (customer) this.customerSearch = customer.fullName;
        this.router.navigateByUrl('/customers', { replaceUrl: true });
      }
    }
  }
  viewOrder(order: Order): void {
    this.router.navigateByUrl(`/orders/${order.id}`);
  }
  viewAgent(agent: Agent): void {
    this.router.navigateByUrl(`/agents/${agent.id}`);
  }
  private isViewAllowed(view: View): boolean {
    if (this.session()?.role === 'ADMIN') {
      return ['Overview','Orders','Customers','Categories','Products','Inventory','Tracking','Leads','Campaigns','Agents'].includes(view);
    }
    return ['Overview','Orders','Customers','Commissions','Tracking'].includes(view);
  }
  toggleNotifications(): void {
    this.notificationPanelOpen.update((open) => !open);
  }
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.notificationPanelOpen()) return;
    const target = event.target as Node;
    if (!this.notificationCenterRef?.nativeElement.contains(target)) this.notificationPanelOpen.set(false);
  }
  markNotificationsRead(): void {
    const timestamp = Date.now();
    this.notificationReadAt.set(timestamp);
    const userId = this.session()?.id;
    if (userId) localStorage.setItem(`tnl_notifications_read_${userId}`, String(timestamp));
  }
  isNotificationUnread(createdAt: string): boolean {
    return new Date(createdAt).getTime() > this.notificationReadAt();
  }
  openNotification(item: DashboardNotification): void {
    this.markNotificationsRead();
    this.notificationPanelOpen.set(false);
    if (item.type === 'ORDER') {
      const orderId = Number(item.id.replace('order-', ''));
      this.router.navigateByUrl(`/orders/${orderId}`);
    } else {
      this.selectView('Customers');
    }
  }
  private restoreNotificationReadTime(userId: number): void {
    this.notificationReadAt.set(Number(localStorage.getItem(`tnl_notifications_read_${userId}`) ?? 0));
  }
  private startNotificationRefresh(): void {
    if (this.notificationRefreshTimer) clearInterval(this.notificationRefreshTimer);
    this.notificationRefreshTimer = setInterval(() => {
      if (!this.session()) return;
      this.api.getDashboard().subscribe({ next: ({ data }) => this.summary.set(data) });
    }, 30_000);
  }
  ngOnDestroy(): void {
    if (this.notificationRefreshTimer) clearInterval(this.notificationRefreshTimer);
  }
  openAttentionItem(destination: View): void {
    if (destination === 'Inventory') this.inventoryHealth = 'LOW';
    this.selectView(destination);
  }
  openMetric(metric: { destination: View; filter?: string }): void {
    if (metric.destination === 'Inventory') this.inventoryHealth = metric.filter ?? 'ALL';
    if (metric.destination === 'Orders') this.orderStatus = metric.filter ?? 'All';
    this.selectView(metric.destination);
  }
  openCustomerForm(customer?:Customer):void{
    this.editingCustomerId=customer?.id??null;
    this.customerForm={fullName:customer?.fullName??'',email:customer?.email??'',phone:customer?.phone??'',address:customer?.address??'',assignedAgentId:customer?.assignedAgentId??(this.session()?.role==='AGENT'?this.session()!.id:null)};
    this.showCustomerForm.set(true);
  }
  saveCustomer():void{
    const input={...this.customerForm};
    const request=this.editingCustomerId?this.api.updateCustomer(this.editingCustomerId,input):this.api.createCustomer(input);
    this.loading.set(true);
    request.subscribe({next:()=>{this.showCustomerForm.set(false);this.showSuccess(this.editingCustomerId?'Customer updated.':'Customer created.');this.loadWorkspace();},error:(error)=>this.handleMutationError(error,'Unable to save customer.')});
  }
  deleteCustomer(customer:Customer):void{
    this.openDialog({title:'Delete customer?',message:`"${customer.fullName}" will be permanently removed if no order history exists.`,confirmLabel:'Delete customer',tone:'danger'},()=>{this.loading.set(true);this.api.deleteCustomer(customer.id).subscribe({next:()=>{this.showSuccess('Customer deleted.');this.loadWorkspace();},error:(error)=>this.handleMutationError(error,'Unable to delete customer.')});});
  }
  openCategoryForm(category?: Category): void {
    this.editingCategoryId = category?.id ?? null;
    this.categoryForm = { name: category?.name ?? '', description: category?.description ?? '' };
    this.showCategoryForm.set(true);
  }
  saveCategory(): void {
    const input = { name: this.categoryForm.name, description: this.categoryForm.description || null };
    const request = this.editingCategoryId ? this.api.updateCategory(this.editingCategoryId, input) : this.api.createCategory(input);
    this.loading.set(true);
    request.subscribe({ next: () => { this.showCategoryForm.set(false);this.showSuccess(this.editingCategoryId?'Category updated.':'Category created.');this.loadWorkspace(); }, error: (error) => this.handleMutationError(error, 'Unable to save category.') });
  }
  deleteCategory(category: Category): void {
    this.openDialog({title:'Delete category?',message:`"${category.name}" will be permanently removed.`,confirmLabel:'Delete category',tone:'danger'},()=>{this.loading.set(true);this.api.deleteCategory(category.id).subscribe({ next: () => {this.showSuccess('Category deleted.');this.loadWorkspace();}, error: (error) => this.handleMutationError(error, 'Unable to delete category.') });});
  }
  openProductForm(product?: Product): void {
    this.editingProductId = product?.id ?? null;
    this.productForm = {
      categoryId: product?.categoryId ?? this.categories()[0]?.id ?? 0,
      name: product?.name ?? '', sku: product?.sku ?? '', price: product?.price ?? 0, description: product?.description ?? ''
    };
    this.showProductForm.set(true);
  }
  saveProduct(): void {
    const input = { ...this.productForm, description: this.productForm.description || null };
    const request = this.editingProductId ? this.api.updateProduct(this.editingProductId, input) : this.api.createProduct(input);
    this.loading.set(true);
    request.subscribe({ next: () => { this.showProductForm.set(false);this.showSuccess(this.editingProductId?'Product updated.':'Product created.');this.loadWorkspace(); }, error: (error) => this.handleMutationError(error, 'Unable to save product.') });
  }
  deleteProduct(product: Product): void {
    this.openDialog({title:'Delete product?',message:`"${product.name}" will be permanently removed.`,confirmLabel:'Delete product',tone:'danger'},()=>{this.loading.set(true);this.api.deleteProduct(product.id).subscribe({ next: () => {this.showSuccess('Product deleted.');this.loadWorkspace();}, error: (error) => this.handleMutationError(error, 'Unable to delete product.') });});
  }
  adjustInventory(product: Product): void {
    this.openDialog({title:'Adjust inventory',message:`Update available stock for ${product.name}.`,confirmLabel:'Save adjustment',fields:[
      {key:'operation',label:'Operation',type:'select',value:'ADD',options:['ADD','DEDUCT'],required:true},
      {key:'quantity',label:'Quantity',type:'number',value:1,min:1,required:true},
      {key:'note',label:'Adjustment note (optional)',type:'text',value:''}
    ]},(values)=>{
      const operation=String(values['operation']) as 'ADD'|'DEDUCT';const quantity=Number(values['quantity']);const note=String(values['note']||'')||undefined;
      if(!Number.isInteger(quantity)||quantity<=0){this.setError('Inventory quantity must be a positive whole number.');return;}
      this.loading.set(true);this.api.adjustInventory(product.id,operation,quantity,note).subscribe({next:()=>{this.showSuccess('Inventory adjusted.');this.loadWorkspace();},error:(error)=>this.handleMutationError(error,'Unable to adjust inventory.')});
    });
  }
  editInventorySettings(product: Product): void {
    this.openDialog({title:'Inventory settings',message:`Set stock alerts for ${product.name}.`,confirmLabel:'Save settings',fields:[
      {key:'threshold',label:'Low-stock threshold',type:'number',value:product.lowStockThreshold,min:1,required:true},
      {key:'reorder',label:'Reorder level',type:'number',value:product.reorderLevel,min:1,required:true}
    ]},(values)=>{
      const threshold=Number(values['threshold']);const reorder=Number(values['reorder']);
      if(!Number.isInteger(threshold)||threshold<=0||!Number.isInteger(reorder)||reorder<=0){this.setError('Threshold and reorder level must be positive whole numbers.');return;}
      this.loading.set(true);this.api.updateInventorySettings(product.id,threshold,reorder).subscribe({next:()=>{this.showSuccess('Inventory settings updated.');this.loadWorkspace();},error:(error)=>this.handleMutationError(error,'Unable to update inventory settings.')});
    });
  }
  searchedCategories(): Category[] {
    const value = this.categorySearch.toLowerCase();
    return this.categories().filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(value));
  }
  searchedProducts(): Product[] {
    const value = this.productSearch.toLowerCase();
    return this.products().filter((item) => `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(value));
  }
  openNewOrder(order?: Order): void {
    if (!order) { this.router.navigateByUrl('/orders/new'); return; }
    this.editingOrderId = order?.id ?? null;
    this.newOrder = {
      customerId: order?.customerId ?? this.customers()[0]?.id ?? 0,
      agentId: order?.agentId ?? this.agents()[0]?.id ?? (this.session()?.role === 'AGENT' ? this.session()!.id : 0),
      items: order?.items.map((item)=>({productId:item.productId,quantity:item.quantity})) ?? [{ productId: this.products()[0]?.id ?? 0, quantity: 1 }],
      deliveryAddress: order?.deliveryAddress ?? this.customers()[0]?.address ?? '',
      paymentMethod: order?.paymentMethod ?? 'Bank transfer'
    };
    this.showOrderForm.set(true);
  }
  closeNewOrder(): void { this.showOrderForm.set(false); }
  addOrderItem():void{
    const used=new Set(this.newOrder.items.map((item)=>item.productId));
    const product=this.products().find((item)=>!used.has(item.id));
    if(!product){this.setError('All available products are already included.');return;}
    this.newOrder.items.push({productId:product.id,quantity:1});
  }
  removeOrderItem(index:number):void{
    if(this.newOrder.items.length<=1)return;
    const product=this.products().find((item)=>item.id===this.newOrder.items[index].productId);
    this.openDialog({title:'Remove item?',message:`${product?.name??'This item'} will be removed from the order.`,confirmLabel:'Remove item',tone:'danger'},()=>{this.newOrder.items.splice(index,1);});
  }
  submitOrder(): void {
    if (this.session()?.role === 'ADMIN' && !this.newOrder.agentId) { this.setError('Select an assigned agent.'); return; }
    this.loading.set(true);
    const request = this.editingOrderId ? this.api.updateOrder(this.editingOrderId, this.newOrder) : this.api.createOrder(this.newOrder);
    request.subscribe({
      next: () => { this.closeNewOrder();this.showSuccess(this.editingOrderId?'Order updated.':'Order created.');this.loadWorkspace(); },
      error: (error) => { this.loading.set(false); this.setError(error.error?.error?.message ?? 'Unable to create order.'); }
    });
  }
  decideOrder(order: Order, decision: 'APPROVE' | 'REJECT'): void {
    this.loading.set(true);
    this.api.decideOrder(order.id, decision).subscribe({
      next: () => {this.showSuccess(decision==='APPROVE'?'Order approved.':'Order rejected.');this.loadWorkspace();},
      error: (error) => { this.loading.set(false); this.setError(error.error?.error?.message ?? 'Unable to update the order.'); }
    });
  }
  updatePayment(order:Order):void{
    this.openDialog({title:'Update payment',message:`Choose the payment method and current payment state for ${order.trackingNumber}.`,confirmLabel:'Update payment',fields:buildPaymentDialogFields(order)},(values)=>{
      const value=String(values['status']) as PaymentStatus;
      const method=String(values['method']);
      const cashReceived=method==='Cash'?Number(values['cashReceived']):null;
      const total=this.orderAmount(order);
      const validationError=validateCashPayment(method,value,cashReceived,total);
      if(validationError){this.setError(validationError);return;}
      this.loading.set(true);this.api.updatePaymentStatus(order.id,value,method,cashReceived).subscribe({next:()=>{this.showSuccess(method==='Cash'&&cashReceived!>total?`Payment updated. Change due: ${this.money(cashReceived!-total)}.`:'Payment details updated.');this.loadWorkspace();},error:(e)=>this.handleMutationError(e,'Unable to update payment details.')});
    });
  }
  advanceDelivery(order:Order):void{
    const currentValue=(order.deliveryStatus??'PREPARING') as DeliveryStatus;
    const suggested=nextDeliveryStep(order.deliveryStatus as DeliveryStatus|null);
    this.openDialog({title:'Update delivery progress',message:`Record the next delivery event for ${order.trackingNumber}.`,confirmLabel:'Update delivery',fields:[
      {key:'status',label:'Delivery status',type:'steps',value:suggested,currentValue,steps:DELIVERY_STEPS,required:true},
      {key:'notes',label:'Event note (optional)',type:'text',value:''}
    ]},(values)=>{
      const value=String(values['status']) as DeliveryStatus;const notes=String(values['notes']||'')||undefined;
      this.loading.set(true);this.api.updateDeliveryStatus(order.id,value,notes).subscribe({next:()=>{this.showSuccess('Delivery progress updated.');this.loadWorkspace();},error:(e)=>this.handleMutationError(e,'Unable to update delivery status.')});
    });
  }
  removeOrder(order:Order):void{
    this.openDialog({title:'Delete order?',message:`Order ${order.trackingNumber} will be permanently removed.`,confirmLabel:'Delete order',tone:'danger'},()=>{
      this.loading.set(true);this.api.deleteOrder(order.id).subscribe({next:()=>{this.showSuccess('Order deleted.');this.loadWorkspace();},error:(e)=>this.handleMutationError(e,'Unable to delete order.')});
    });
  }
  private openDialog(config:ActionDialogConfig,action:(values:Record<string,string|number>)=>void):void{this.dialogAction=action;this.actionDialog.set(config);}
  closeActionDialog():void{this.actionDialog.set(null);this.dialogAction=null;}
  confirmActionDialog(values:Record<string,string|number>):void{const action=this.dialogAction;this.closeActionDialog();action?.(values);}
  showSuccess(message:string):void{this.error.set('');this.notice.set(message);window.setTimeout(()=>{if(this.notice()===message)this.notice.set('');},4500);}
  private setError(message:string):void{this.notice.set('');this.error.set(message);}
  track(): void {
    const value = this.trackingNumber.trim().toUpperCase();
    if (!value) return;
    this.loading.set(true);
    this.error.set('');
    this.api.track(value).subscribe({
      next: ({ data }) => { this.trackingResult.set(data); this.trackingNumber = data.trackingNumber; this.loading.set(false); },
      error: (error) => { this.trackingResult.set(null); this.loading.set(false); this.setError(error.error?.error?.message ?? 'Tracking number not found.'); }
    });
  }
  stockWidth(stock: number): number { return Math.min(100, stock * 4); }
  displayStatus(order: Order): string {
    if (order.deliveryStatus === 'DELIVERED') return 'Delivered';
    if (order.deliveryStatus === 'IN_TRANSIT') return 'In transit';
    return this.titleCase(order.orderStatus);
  }
  statusClass(status: string): string { return status.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-'); }
  titleCase(value: string | null): string { return value ? value.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') : 'Not started'; }
  orderAmount(order: Order): number { return order.items.reduce((total,item)=>total+item.quantity*item.unitPrice,0); }
  orderItemSummary(order:Order):string{return order.items.map((item)=>`${item.productName} × ${item.quantity}`).join(', ');}
  money(value: number): string { return formatMoney(value); }
  iconFor(view: string): AppIconName {
    return ({Overview:'dashboard',Orders:'orders',Customers:'customers',Categories:'categories',Products:'products',Inventory:'inventory',Tracking:'tracking',Leads:'leads',Campaigns:'campaigns',Agents:'agents',Commissions:'commissions'} as Record<string,AppIconName>)[view]??'gauge';
  }
  greeting(): string { const hour = this.today.getHours(); return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; }
  useAccount(role: Role): void {
    this.loginEmail = role === 'ADMIN' ? 'admin@tnl.local' : 'agent@tnl.local';
    this.loginPassword = 'TnlDemo123!';
  }
  private handleMutationError(error: any, fallback: string): void {
    this.loading.set(false);
    this.setError(error.error?.error?.message ?? fallback);
  }
}

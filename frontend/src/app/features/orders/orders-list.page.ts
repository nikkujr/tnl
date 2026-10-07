import { CurrencyPipe } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { AppFormsModule } from '../../shared/app-forms.module';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, Order, OrderStats, SessionUser } from '../../core/api.service';
import { ActionDialogComponent, ActionDialogConfig } from '../../shared/action-dialog.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { formatMoney } from '../../shared/money';

const STATUS_OPTIONS = [
  'All',
  'Open',
  'Pending',
  'Approved',
  'In transit',
  'Delivered',
  'Cancelled',
];
const STATUS_COLORS: Record<string, string> = {
  Pending: '#a85a2a',
  Approved: '#28786b',
  'In transit': '#4f6eaa',
  Delivered: '#28786b',
  Completed: '#28786b',
  Cancelled: '#a44355',
  Rejected: '#a44355',
};

@Component({
  selector: 'app-orders-list-page',
  imports: [
    CurrencyPipe,
    AppFormsModule,
    ActionDialogComponent,
    AppIconComponent,
    BreadcrumbComponent,
  ],
  templateUrl: './orders-list.page.html',
  styleUrls: ['./orders-list.page.scss'],
})
export class OrdersListPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly statusOptions = STATUS_OPTIONS;

  readonly session = signal<SessionUser>(JSON.parse(sessionStorage.getItem('tnl_user') ?? '{}'));
  readonly orders = signal<Order[]>([]);
  readonly stats = signal<OrderStats | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly actionDialog = signal<ActionDialogConfig | null>(null);
  private dialogAction: (() => void) | null = null;
  private readonly lockBodyScroll = effect(() => {
    document.body.style.overflow = this.actionDialog() !== null ? 'hidden' : '';
  });

  search = '';
  status = 'All';
  page = 1;
  readonly limit = 20;
  total = 0;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly monthlyBars = computed(() => {
    const months = this.stats()?.monthlyTrend ?? [];
    const maxRevenue = Math.max(...months.map((item) => item.revenue), 1);
    return months.map((item) => ({
      ...item,
      label: new Date(`${item.month}-01T00:00:00`).toLocaleString('en', { month: 'short' }),
      height: item.revenue === 0 ? 0 : Math.max(6, (item.revenue / maxRevenue) * 100),
    }));
  });

  readonly statusBars = computed(() => {
    const breakdown = this.stats()?.statusBreakdown ?? [];
    const maxCount = Math.max(...breakdown.map((item) => item.count), 1);
    return breakdown
      .slice()
      .sort((a, b) => b.count - a.count)
      .map((item) => ({
        ...item,
        width: (item.count / maxCount) * 100,
        color: STATUS_COLORS[item.status] ?? '#667085',
      }));
  });

  ngOnInit(): void {
    const requestedStatus = this.route.snapshot.queryParamMap.get('status');
    if (requestedStatus && this.statusOptions.includes(requestedStatus)) {
      this.status = requestedStatus;
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
    this.loadStats();
    this.loadOrders();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private loadStats(): void {
    this.api.getOrderStats().subscribe({
      next: ({ data }) => this.stats.set(data),
      error: (error) =>
        this.setError(error.error?.error?.message ?? 'Unable to load order statistics.'),
    });
  }

  private loadOrders(): void {
    this.loading.set(true);
    this.api
      .getOrders({
        page: this.page,
        limit: this.limit,
        search: this.search || undefined,
        status: this.status === 'All' ? undefined : this.status,
      })
      .subscribe({
        next: ({ data, meta }) => {
          this.orders.set(data);
          this.total = meta?.total ?? data.length;
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.setError(error.error?.error?.message ?? 'Unable to load orders.');
        },
      });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.loadOrders();
    }, 350);
  }

  onStatusChange(): void {
    this.page = 1;
    this.loadOrders();
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  goToPage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || (next - 1) * this.limit >= this.total) return;
    this.page = next;
    this.loadOrders();
  }

  viewOrder(order: Order): void {
    this.router.navigateByUrl(`/orders/${order.id}`);
  }
  goToImports(): void {
    this.router.navigateByUrl('/imports');
  }
  editOrder(order: Order): void {
    this.router.navigateByUrl(`/orders?edit=${order.id}`);
  }

  decideOrder(order: Order, decision: 'APPROVE' | 'REJECT'): void {
    this.loading.set(true);
    this.api.decideOrder(order.id, decision).subscribe({
      next: () => {
        this.showSuccess(decision === 'APPROVE' ? 'Order approved.' : 'Order rejected.');
        this.refreshAfterMutation();
      },
      error: (error) => this.handleMutationError(error, 'Unable to update the order.'),
    });
  }

  removeOrder(order: Order): void {
    this.openDialog(
      {
        title: 'Delete order?',
        message: `Order ${order.trackingNumber} will be permanently removed.`,
        confirmLabel: 'Delete order',
        tone: 'danger',
      },
      () => {
        this.loading.set(true);
        this.api.deleteOrder(order.id).subscribe({
          next: () => {
            this.showSuccess('Order deleted.');
            this.refreshAfterMutation();
          },
          error: (error) => this.handleMutationError(error, 'Unable to delete order.'),
        });
      },
    );
  }

  private refreshAfterMutation(): void {
    this.loadOrders();
    this.loadStats();
  }

  private openDialog(config: ActionDialogConfig, action: () => void): void {
    this.dialogAction = action;
    this.actionDialog.set(config);
  }
  closeActionDialog(): void {
    this.actionDialog.set(null);
    this.dialogAction = null;
  }
  confirmActionDialog(): void {
    const action = this.dialogAction;
    this.closeActionDialog();
    action?.();
  }

  private showSuccess(message: string): void {
    this.error.set('');
    this.notice.set(message);
    window.setTimeout(() => {
      if (this.notice() === message) this.notice.set('');
    }, 4500);
  }
  private setError(message: string): void {
    this.notice.set('');
    this.error.set(message);
  }
  private handleMutationError(error: any, fallback: string): void {
    this.loading.set(false);
    this.setError(error.error?.error?.message ?? fallback);
  }

  money(value: number): string {
    return formatMoney(value);
  }
  displayStatus(order: Order): string {
    if (order.deliveryStatus === 'DELIVERED') return 'Delivered';
    if (order.deliveryStatus === 'IN_TRANSIT') return 'In transit';
    return this.titleCase(order.orderStatus);
  }
  statusClass(status: string): string {
    return status.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  }
  titleCase(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ');
  }
  orderAmount(order: Order): number {
    return order.total;
  }
  orderItemSummary(order: Order): string {
    return [
      ...order.items.map((item) => `${item.productName} × ${item.quantity}`),
      ...order.packages.map((p) => `${p.name} × ${p.quantity}`),
    ].join(', ');
  }
}

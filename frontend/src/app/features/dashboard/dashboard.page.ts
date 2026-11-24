import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppFormsModule } from '../../shared/app-forms.module';
import { fillTrend, type ReportPeriod, type ReportPeriodQuery } from '../reports/reports.model';
import { ApiService, DashboardSummary, Order, Product } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { AppIconComponent, AppIconName } from '../../shared/app-icon.component';
import { formatMoney } from '../../shared/money';
import { AgentRewardsComponent } from '../../shared/agent-rewards.component';
import { orderRejectionDialog, selectedRejectionReason } from '../../shared/order-rejection';

@Component({
  selector: 'app-dashboard-page',
  imports: [AppFormsModule, CurrencyPipe, DatePipe, AppIconComponent, AgentRewardsComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss'
})
export class DashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly session = inject(SessionService).session;
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly today = new Date();
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  private readonly manilaDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(this.today);
  readonly period = signal<ReportPeriod>('monthly');
  readonly selectedDate = signal(this.manilaDate);
  readonly selectedMonth = signal(this.manilaDate.slice(0, 7));
  readonly periodQuery = computed<ReportPeriodQuery>(() => {
    switch (this.period()) {
      case 'daily': return { period: 'daily', date: this.selectedDate() };
      case 'monthly': return { period: 'monthly', month: this.selectedMonth() };
      case 'overall': return { period: 'overall' };
    }
  });
  readonly loading = signal(true);
  readonly summary = signal<DashboardSummary>({
    totalOrders: 0, pendingOrders: 0, completedOrders: 0, openOrders: 0, revenue: 0,
    activeDeliveries: 0, totalCustomers: 0, totalProducts: 0, lowStockProducts: 0,
    monthlyRevenue: [], notifications: []
  });
  readonly orders = signal<Order[]>([]);
  readonly pendingOrder = signal<Order | undefined>(undefined);
  readonly products = signal<Product[]>([]);

  readonly firstName = computed(() => this.session()?.fullName.split(' ')[0] ?? '');
  readonly recentOrders = computed(() => this.orders().slice(0, 4));

  readonly revenueBars = computed(() => {
    const trend = this.summary().revenueTrend;
    if (trend) {
      const query = this.periodQuery();
      const selection = query.period === 'daily' ? query.date : query.period === 'monthly' ? query.month : '';
      const rows = fillTrend({ period: query.period, selection, trend }, (label) => ({ label, revenue: 0 }));
      const maximum = Math.max(...rows.map((row) => row.revenue), 1);
      return rows.map(({ label, revenue }) => ({
        key: label,
        month: query.period === 'daily' ? label.slice(11) : query.period === 'monthly' ? label.slice(8) : label,
        revenue,
        value: Math.max(0, (revenue / maximum) * 100),
      }));
    }
    const values = new Map(this.summary().monthlyRevenue.map((item) => [item.month, item.revenue]));
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(this.today.getFullYear(), this.today.getMonth() - 5 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return { key, month: date.toLocaleString('en', { month: 'short' }), revenue: values.get(key) ?? 0 };
    });
    const maximum = Math.max(...months.map((item) => item.revenue), 1);
    return months.map((item) => ({ ...item, value: item.revenue === 0 ? 0 : Math.max(6, (item.revenue / maximum) * 100) }));
  });

  readonly metrics = computed(() => {
    const summary = this.summary();
    return [
      { label: 'Revenue', value: this.money(summary.revenue), change: 'Paid', note: 'recognized', icon: 'commissions' as AppIconName, destination: 'orders' as const },
      { label: 'Open orders', value: String(summary.openOrders), change: `${summary.pendingOrders} pending`, note: 'now', icon: 'orders' as AppIconName, destination: 'orders' as const, filter: 'Open' },
      this.session()?.role === 'ADMIN'
        ? { label: 'Customers', value: String(summary.totalCustomers), change: 'Live', note: 'records', icon: 'customers' as AppIconName, destination: 'customers' as const }
        : { label: 'Completed', value: String(summary.completedOrders), change: 'Your', note: 'orders', icon: 'check' as AppIconName, destination: 'orders' as const },
      { label: 'Low stock', value: String(summary.lowStockProducts), change: `${summary.totalProducts} total`, note: 'products', icon: 'inventory' as AppIconName, destination: 'inventory' as const, filter: 'LOW' }
    ];
  });

  readonly attentionItems = computed(() => {
    const lowStock = this.session()?.role === 'ADMIN'
      ? this.products().filter((product) => product.stockOnHand <= product.lowStockThreshold).slice(0, 2)
        .map((product) => ({ title: product.name, detail: `${product.stockOnHand} left · threshold ${product.lowStockThreshold}`, action: 'Restock', destination: 'inventory' as const }))
      : [];
    const pending = this.pendingOrder();
    return pending
      ? [...lowStock, { title: pending.trackingNumber, detail: 'Awaiting approval', action: 'Review', destination: 'orders' as const }]
      : lowStock;
  });

  ngOnInit(): void {
    this.load();
  }

  changePeriod(period: ReportPeriod): void {
    this.period.set(period);
    this.load();
  }

  changeDate(value: string): void {
    if (!value) return;
    this.selectedDate.set(value);
    this.load();
  }

  changeMonth(value: string): void {
    if (!value) return;
    this.selectedMonth.set(value);
    this.load();
  }

  private load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    const isAdmin = this.session()?.role === 'ADMIN';
    const period = isAdmin ? this.periodQuery() : undefined;
    this.request = forkJoin({
      dashboard: this.api.getDashboard(period),
      orders: this.api.getOrders({ limit: 4, period }),
      pending: this.api.getOrders({ status: 'Pending', limit: 1 }),
      products: isAdmin ? this.api.getProducts({ limit: 100 }) : of({ data: [] as Product[] })
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ dashboard, orders, products, pending }) => {
        this.summary.set(dashboard.data);
        this.orders.set(orders.data);
        this.pendingOrder.set(pending.data[0]);
        this.products.set(products.data);
        this.loading.set(false);
      },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load dashboard data.'); }
    });
  }

  openMetric(metric: { destination: 'orders' | 'inventory' | 'customers'; filter?: string }): void {
    if (metric.destination === 'inventory') { this.router.navigateByUrl(`/inventory${metric.filter ? `?health=${metric.filter}` : ''}`); return; }
    if (metric.destination === 'orders') { this.router.navigateByUrl(`/orders${metric.filter ? `?status=${metric.filter}` : ''}`); return; }
    this.router.navigateByUrl('/customers');
  }

  openAttentionItem(destination: 'orders' | 'inventory'): void {
    if (destination === 'inventory') { this.router.navigateByUrl('/inventory?health=LOW'); return; }
    this.router.navigateByUrl('/orders?status=Pending');
  }

  viewOrder(order: Order): void { this.router.navigateByUrl(`/orders/${order.id}`); }
  editOrder(order: Order): void { this.router.navigateByUrl(`/orders?edit=${order.id}`); }
  goToOrders(): void { this.router.navigateByUrl('/orders'); }

  async decideOrder(order: Order, decision: 'APPROVE' | 'REJECT'): Promise<void> {
    let reason: string | undefined;
    if (decision === 'REJECT') {
      const values = await this.confirmDialog.open(orderRejectionDialog(order.trackingNumber));
      if (!values) return;
      reason = selectedRejectionReason(values);
    }
    this.loading.set(true);
    this.api.decideOrder(order.id, decision, reason).subscribe({
      next: () => { this.toast.success(decision === 'APPROVE' ? 'Order approved.' : 'Order rejected.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to update the order.'); }
    });
  }

  async removeOrder(order: Order): Promise<void> {
    const confirmed = await this.confirmDialog.open({ title: 'Delete order?', message: `Order ${order.trackingNumber} will be permanently removed.`, confirmLabel: 'Delete order', tone: 'danger' });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.deleteOrder(order.id).subscribe({
      next: () => { this.toast.success('Order deleted.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to delete order.'); }
    });
  }

  displayStatus(order: Order): string {
    if (order.deliveryStatus === 'DELIVERED') return 'Delivered';
    if (order.deliveryStatus === 'IN_TRANSIT') return 'In transit';
    return this.titleCase(order.orderStatus);
  }
  statusClass(status: string): string { return status.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-'); }
  titleCase(value: string | null): string { return value ? value.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') : 'Not started'; }
  orderAmount(order: Order): number { return order.total; }
  orderItemSummary(order: Order): string { return [...order.items.map((item) => `${item.productName} × ${item.quantity}`), ...order.packages.map((p) => `${p.name} × ${p.quantity}`)].join(', '); }
  money(value: number): string { return formatMoney(value); }
  greeting(): string { const hour = this.today.getHours(); return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; }
}

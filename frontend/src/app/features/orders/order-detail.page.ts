import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, OrderDetail, SessionUser } from '../../core/api.service';
import { AppIconComponent, AppIconName } from '../../shared/app-icon.component';
import { ActionDialogComponent, ActionDialogConfig } from '../../shared/action-dialog.component';
import { DELIVERY_STEPS, DeliveryStatus, nextDeliveryStep } from '../../shared/delivery-steps';
import { buildPaymentDialogFields, PaymentStatus, validateCashPayment } from '../../shared/order-payment';

const HISTORY_ICONS: Record<string, AppIconName> = {
  CREATED: 'plus',
  EDITED: 'edit',
  APPROVED: 'check',
  REJECTED: 'close',
  PAYMENT_UPDATED: 'commissions',
  DELIVERY_UPDATED: 'tracking'
};

@Component({
  selector: 'app-order-detail-page',
  imports: [CurrencyPipe, DatePipe, AppIconComponent, ActionDialogComponent],
  templateUrl: './order-detail.page.html',
  styleUrls: ['./order-detail.page.scss']
})
export class OrderDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly session = signal<SessionUser>(JSON.parse(sessionStorage.getItem('tnl_user') ?? '{}'));
  readonly order = signal<OrderDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly actionDialog = signal<ActionDialogConfig | null>(null);
  private dialogAction: ((values: Record<string, string | number>) => void) | null = null;
  private readonly lockBodyScroll = effect(() => {
    document.body.style.overflow = this.actionDialog() !== null ? 'hidden' : '';
  });

  readonly orderTotal = computed(() => {
    const order = this.order();
    return order ? order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) : 0;
  });

  readonly deliveryProgress = computed(() => {
    const order = this.order();
    if (!order) return [];
    const eventsByStatus = new Map(order.deliveryEvents.map((event) => [event.status, event]));
    const currentIndex = DELIVERY_STEPS.findIndex((step) => step.value === order.deliveryStatus);
    return DELIVERY_STEPS.map((step, index) => ({
      step,
      event: eventsByStatus.get(step.value) ?? null,
      reached: currentIndex >= 0 && index <= currentIndex,
      current: step.value === order.deliveryStatus
    }));
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      this.load(id);
    });
  }

  private load(id: number): void {
    this.order.set(null);
    this.closeActionDialog();
    this.loading.set(true);
    this.error.set('');
    this.notice.set('');
    this.api.getOrder(id).subscribe({
      next: ({ data }) => { this.order.set(data); this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.setError(error.error?.error?.message ?? 'Unable to load this order.'); }
    });
  }

  back(): void { this.router.navigateByUrl('/orders'); }

  editOrder(): void {
    const order = this.order();
    if (order) this.router.navigateByUrl(`/orders?edit=${order.id}`);
  }

  decideOrder(decision: 'APPROVE' | 'REJECT'): void {
    const order = this.order();
    if (!order) return;
    this.loading.set(true);
    this.api.decideOrder(order.id, decision).subscribe({
      next: () => { this.showSuccess(decision === 'APPROVE' ? 'Order approved.' : 'Order rejected.'); this.load(order.id); },
      error: (e) => this.handleError(e, 'Unable to update the order.')
    });
  }

  updatePayment(): void {
    const order = this.order();
    if (!order) return;
    this.openDialog({ title: 'Update payment', message: `Choose the payment method and current payment state for ${order.trackingNumber}.`, confirmLabel: 'Update payment', fields: buildPaymentDialogFields(order) }, (values) => {
      const status = String(values['status']) as PaymentStatus;
      const method = String(values['method']);
      const cashReceived = method === 'Cash' ? Number(values['cashReceived']) : null;
      const total = this.orderTotal();
      const validationError = validateCashPayment(method, status, cashReceived, total);
      if (validationError) { this.setError(validationError); return; }
      this.loading.set(true);
      this.api.updatePaymentStatus(order.id, status, method, cashReceived).subscribe({
        next: () => { this.showSuccess('Payment details updated.'); this.load(order.id); },
        error: (e) => this.handleError(e, 'Unable to update payment details.')
      });
    });
  }

  advanceDelivery(): void {
    const order = this.order();
    if (!order) return;
    const currentValue = (order.deliveryStatus ?? 'PREPARING') as DeliveryStatus;
    const suggested = nextDeliveryStep(order.deliveryStatus as DeliveryStatus | null);
    this.openDialog({ title: 'Update delivery progress', message: `Record the next delivery event for ${order.trackingNumber}.`, confirmLabel: 'Update delivery', fields: [
      { key: 'status', label: 'Delivery status', type: 'steps', value: suggested, currentValue, steps: DELIVERY_STEPS, required: true },
      { key: 'notes', label: 'Event note (optional)', type: 'text', value: '' }
    ] }, (values) => {
      const value = String(values['status']) as DeliveryStatus;
      const notes = String(values['notes'] || '') || undefined;
      this.loading.set(true);
      this.api.updateDeliveryStatus(order.id, value, notes).subscribe({
        next: () => { this.showSuccess('Delivery progress updated.'); this.load(order.id); },
        error: (e) => this.handleError(e, 'Unable to update delivery status.')
      });
    });
  }

  removeOrder(): void {
    const order = this.order();
    if (!order) return;
    this.openDialog({ title: 'Delete order?', message: `Order ${order.trackingNumber} will be permanently removed.`, confirmLabel: 'Delete order', tone: 'danger' }, () => {
      this.loading.set(true);
      this.api.deleteOrder(order.id).subscribe({
        next: () => { sessionStorage.setItem('tnl_flash', 'Order deleted.'); this.router.navigateByUrl('/orders'); },
        error: (e) => this.handleError(e, 'Unable to delete order.')
      });
    });
  }

  private openDialog(config: ActionDialogConfig, action: (values: Record<string, string | number>) => void): void {
    this.dialogAction = action;
    this.actionDialog.set(config);
  }
  closeActionDialog(): void { this.actionDialog.set(null); this.dialogAction = null; }
  confirmActionDialog(values: Record<string, string | number>): void {
    const action = this.dialogAction;
    this.closeActionDialog();
    action?.(values);
  }
  private showSuccess(message: string): void {
    this.error.set('');
    this.notice.set(message);
    window.setTimeout(() => { if (this.notice() === message) this.notice.set(''); }, 4500);
  }
  private setError(message: string): void {
    this.notice.set('');
    this.error.set(message);
  }
  private handleError(error: any, fallback: string): void {
    this.loading.set(false);
    this.setError(error.error?.error?.message ?? fallback);
  }

  displayStatus(order: OrderDetail): string {
    if (order.deliveryStatus === 'DELIVERED') return 'Delivered';
    if (order.deliveryStatus === 'IN_TRANSIT') return 'In transit';
    return this.titleCase(order.orderStatus);
  }
  statusClass(status: string): string { return status.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-'); }
  titleCase(value: string | null): string { return value ? value.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') : 'Not started'; }
  historyIcon(type: string): AppIconName { return HISTORY_ICONS[type] ?? 'gauge'; }
}

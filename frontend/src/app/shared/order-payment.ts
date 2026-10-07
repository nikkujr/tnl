import { ActionDialogField } from './action-dialog.component';
import { formatMoney } from './money';

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export function buildPaymentDialogFields(order: { paymentMethod: string; paymentStatus: string; cashReceived: number | null; total: number }): ActionDialogField[] {
  return [
    { key: 'method', label: 'Payment method', type: 'select', value: order.paymentMethod, options: ['Cash', 'Cash on delivery', 'Bank transfer', 'Card'], required: true },
    { key: 'cashReceived', label: 'Cash received', type: 'number', value: order.cashReceived ?? 0, min: 0, step: 0.01, required: true, visibleWhen: { key: 'method', value: 'Cash' }, validate: values => validateCashPayment(String(values['method']), values['status'] as PaymentStatus, Number(values['cashReceived']), order.total) },
    { key: 'status', label: 'Payment status', type: 'select', value: order.paymentStatus, options: ['UNPAID', 'PARTIALLY_PAID', 'PAID'], required: true }
  ];
}

/** Returns an error message when the cash entry doesn't match the selected status, or null when valid. */
export function validateCashPayment(method: string, status: PaymentStatus, cashReceived: number | null, total: number): string | null {
  if (method !== 'Cash') return null;
  const invalid = !Number.isFinite(cashReceived) || cashReceived! < 0 ||
    (status === 'UNPAID' && cashReceived !== 0) ||
    (status === 'PARTIALLY_PAID' && (cashReceived! <= 0 || cashReceived! >= total)) ||
    (status === 'PAID' && cashReceived! < total);
  return invalid ? `Cash entry must match the status: ₱0 for unpaid, below ${formatMoney(total)} for partially paid, or at least ${formatMoney(total)} for paid.` : null;
}

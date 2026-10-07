import { ActionDialogField } from './action-dialog.component';
import { formatMoney } from './money';

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export function buildPaymentDialogFields(order: { paymentMethod: string; paymentStatus: string; cashReceived: number | null; amountPaid?: number | null; total: number }): ActionDialogField[] {
  return [
    { key: 'method', label: 'Payment method', type: 'select', value: order.paymentMethod, options: ['Cash', 'Cash on delivery', 'Bank transfer', 'Card'], required: true },
    { key: 'cashReceived', label: 'Total amount received (PHP)', type: 'number', value: order.cashReceived ?? order.amountPaid ?? 0, min: 0, step: 0.01, required: true, validate: values => validateCashPayment(String(values['method']), values['status'] as PaymentStatus, Number(values['cashReceived']), order.total) },
    { key: 'status', label: 'Payment status', type: 'select', value: order.paymentStatus, options: ['UNPAID', 'PARTIALLY_PAID', 'PAID'], required: true }
  ];
}

/** Returns an error message when the cash entry doesn't match the selected status, or null when valid. */
export function validateCashPayment(method: string, status: PaymentStatus, cashReceived: number | null, total: number): string | null {
  const cash = method === 'Cash' || method === 'Cash on delivery';
  const invalid = !Number.isFinite(cashReceived) || cashReceived! < 0 ||
    (status === 'UNPAID' && cashReceived !== 0) ||
    (status === 'PARTIALLY_PAID' && (cashReceived! <= 0 || cashReceived! >= total)) ||
    (status === 'PAID' && (cash ? cashReceived! < total : cashReceived !== total));
  return invalid ? `Enter the total amount received so far: ₱0 for unpaid, above ₱0 and below ${formatMoney(total)} for partially paid, or ${cash ? 'at least ' : 'exactly '}${formatMoney(total)} for paid.` : null;
}

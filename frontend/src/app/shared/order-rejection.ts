import type { ActionDialogConfig } from './action-dialog.component';

export function orderRejectionDialog(trackingNumber: string): ActionDialogConfig {
  return {
    title: 'Reject order?',
    message: `The customer will see the reason for rejecting ${trackingNumber}.`,
    confirmLabel: 'Reject order',
    tone: 'danger',
    fields: [
      {
        key: 'reason', label: 'Reason', type: 'select', value: '', required: true,
        options: ['', 'Item unavailable', 'Unable to fulfil the order', 'Order details could not be verified', 'Other'],
      },
      {
        key: 'other', label: 'Enter a reason', type: 'text', value: '', required: true, maxLength: 500,
        visibleWhen: { key: 'reason', value: 'Other' },
        validate: (values) => String(values['other']).trim().length < 2 ? 'Enter at least 2 characters.' : null,
      },
    ],
  };
}

export function selectedRejectionReason(values: Record<string, string | number>): string {
  return String(values['reason'] === 'Other' ? values['other'] : values['reason']).trim();
}

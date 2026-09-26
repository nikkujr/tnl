export type DeliveryStatus = 'PREPARING' | 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

export const DELIVERY_STEPS: Array<{ value: DeliveryStatus; label: string; description: string }> = [
  { value: 'PREPARING', label: 'Preparing', description: 'Order approved and prepared for delivery' },
  { value: 'DISPATCHED', label: 'Dispatched', description: 'Handed off to the delivery courier' },
  { value: 'IN_TRANSIT', label: 'In transit', description: 'On the way to the delivery address' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery', description: 'With the courier for final drop-off' },
  { value: 'DELIVERED', label: 'Delivered', description: 'Received by the customer' }
];

export function nextDeliveryStep(current: DeliveryStatus | null): DeliveryStatus {
  const statuses = DELIVERY_STEPS.map((step) => step.value);
  const index = statuses.indexOf((current ?? 'PREPARING') as DeliveryStatus);
  return statuses[Math.min(index + 1, statuses.length - 1)];
}

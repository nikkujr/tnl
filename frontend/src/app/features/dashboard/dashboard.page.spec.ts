import { DashboardPage } from './dashboard.page';
import { Order } from '../../core/api.service';

describe('overview order amounts', () => {
  it('shows the saved package total independently of payment state', () => {
    for (const paymentStatus of ['UNPAID', 'PARTIALLY_PAID', 'PAID']) {
      const order = {items: [], packages: [{name: 'Student Laptop Starter', quantity: 2, sellingPrice: 28995}], total: 57990, paymentStatus} as unknown as Order;
      expect(DashboardPage.prototype.orderAmount(order)).toBe(57990);
    }
  });
});

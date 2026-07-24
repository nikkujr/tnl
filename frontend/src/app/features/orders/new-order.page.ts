import { CurrencyPipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Agent, ApiService, Customer, Product, SessionUser } from '../../core/api.service';
import { AppIconComponent } from '../../shared/app-icon.component';

@Component({
  selector: 'app-new-order-page',
  imports: [CurrencyPipe, FormsModule, AppIconComponent],
  templateUrl: './new-order.page.html',
  styleUrls: ['./new-order.page.scss', './new-order-accessibility.scss', './new-order-controls.scss', './new-order-pastel.scss', './new-order-lookups.scss'],
  styles: ['.line-quantity{width:72px;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;color:#101828;background:#fff;font:inherit}.icon-button{display:inline-flex;align-items:center;gap:7px}.icon-button app-icon{width:14px;height:14px}.empty-items>app-icon{width:30px;height:30px;margin:auto;color:#98a2b3}.picker header button app-icon{width:20px;height:20px}.search-box app-icon{width:16px;height:16px;color:#667085}']
})
export class NewOrderPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly customers = signal<Customer[]>([]);
  readonly products = signal<Product[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly itemModalOpen = signal(false);
  readonly customerModalOpen = signal(false);
  readonly agentModalOpen = signal(false);
  readonly session = signal<SessionUser>(JSON.parse(sessionStorage.getItem('tnl_user') ?? '{}'));
  readonly items = signal<Array<{ product: Product; quantity: number }>>([]);

  customerId = 0;
  agentId = 0;
  deliveryAddress = '';
  paymentMethod = 'Bank transfer';
  cashReceived = 0;
  productSearch = '';
  customerSearch = '';
  agentSearch = '';
  selectedProductId = 0;
  selectedQuantity = 1;
  pendingCustomerId = 0;
  pendingAgentId = 0;

  ngOnInit(): void {
    const requests: { customers: ReturnType<ApiService['getCustomers']>; products: ReturnType<ApiService['getProducts']>; agents?: ReturnType<ApiService['getAgents']> } = {
      customers: this.api.getCustomers(),
      products: this.api.getProducts()
    };
    if (this.session().role === 'ADMIN') requests.agents = this.api.getAgents(true);
    forkJoin(requests).subscribe({
      next: (result) => {
        this.customers.set(result.customers.data);
        this.products.set(result.products.data);
        if (result.agents) this.agents.set(result.agents.data);
        this.customerId = result.customers.data[0]?.id ?? 0;
        this.deliveryAddress = result.customers.data[0]?.address ?? '';
        this.agentId = result.agents?.data[0]?.id ?? this.session().id;
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error.error?.error?.message ?? 'Unable to load order resources.');
        this.loading.set(false);
      }
    });
  }

  availableProducts(): Product[] {
    const used = new Set(this.items().map((item) => item.product.id));
    const search = this.productSearch.toLowerCase();
    return this.products().filter((product) => !used.has(product.id) && `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search));
  }

  filteredCustomers(): Customer[] {
    const search = this.customerSearch.trim().toLowerCase();
    return this.customers().filter((customer) =>
      `${customer.fullName} ${customer.email} ${customer.phone} ${customer.address}`.toLowerCase().includes(search)
    );
  }

  filteredAgents(): Agent[] {
    const search = this.agentSearch.trim().toLowerCase();
    return this.agents().filter((agent) =>
      `${agent.fullName} ${agent.email} ${agent.phone}`.toLowerCase().includes(search)
    );
  }

  selectedCustomer(): Customer | undefined {
    return this.customers().find((customer) => customer.id === this.customerId);
  }

  selectedAgent(): Agent | undefined {
    return this.agents().find((agent) => agent.id === this.agentId);
  }

  openCustomerModal(): void {
    this.pendingCustomerId = this.customerId;
    this.customerSearch = '';
    this.customerModalOpen.set(true);
  }

  confirmCustomer(): void {
    if (!this.pendingCustomerId) return;
    this.customerId = this.pendingCustomerId;
    this.updateAddress();
    this.customerModalOpen.set(false);
  }

  openAgentModal(): void {
    this.pendingAgentId = this.agentId;
    this.agentSearch = '';
    this.agentModalOpen.set(true);
  }

  confirmAgent(): void {
    if (!this.pendingAgentId) return;
    this.agentId = this.pendingAgentId;
    this.agentModalOpen.set(false);
  }

  openItemModal(): void {
    const first = this.availableProducts()[0];
    this.selectedProductId = first?.id ?? 0;
    this.selectedQuantity = 1;
    this.productSearch = '';
    this.itemModalOpen.set(true);
  }

  addSelectedItem(): void {
    const product = this.products().find((item) => item.id === this.selectedProductId);
    if (!product || this.selectedQuantity < 1) return;
    if (this.selectedQuantity > product.stockOnHand - product.stockReserved) {
      this.error.set(`Only ${product.stockOnHand - product.stockReserved} units of ${product.name} are available.`);
      return;
    }
    this.items.update((items) => [...items, { product, quantity: this.selectedQuantity }]);
    this.itemModalOpen.set(false);
  }

  removeItem(productId: number): void {
    this.items.update((items) => items.filter((item) => item.product.id !== productId));
  }

  changeItemQuantity(productId: number, value: number): void {
    const product = this.products().find((item) => item.id === productId);
    const quantity = Math.max(1, Math.floor(Number(value) || 1));
    if (!product) return;
    const available = product.stockOnHand - product.stockReserved;
    if (quantity > available) {
      this.error.set(`Only ${available} units of ${product.name} are available.`);
      return;
    }
    this.error.set('');
    this.items.update((items) => items.map((item) => item.product.id === productId ? { ...item, quantity } : item));
  }

  updateAddress(): void {
    const customer = this.customers().find((item) => item.id === this.customerId);
    if (customer) this.deliveryAddress = customer.address;
  }

  total(): number {
    return this.items().reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }

  cashChange(): number {
    return Math.max(0, (Number(this.cashReceived) || 0) - this.total());
  }

  submit(): void {
    if (!this.customerId || (this.session().role === 'ADMIN' && !this.agentId)) {
      this.error.set('Select a customer and assigned agent before creating the order.');
      return;
    }
    if (!this.items().length) {
      this.error.set('Add at least one item before creating the order.');
      return;
    }
    if (this.paymentMethod === 'Cash' && (!Number.isFinite(Number(this.cashReceived)) || Number(this.cashReceived) < this.total())) {
      this.error.set(`Cash received must be at least ${this.total().toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}.`);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.api.createOrder({
      customerId: this.customerId,
      agentId: this.session().role === 'ADMIN' ? this.agentId : undefined,
      items: this.items().map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      deliveryAddress: this.deliveryAddress,
      paymentMethod: this.paymentMethod,
      cashReceived: this.paymentMethod === 'Cash' ? Number(this.cashReceived) : null
    }).subscribe({
      next: () => {sessionStorage.setItem('tnl_flash','Order created successfully.');this.router.navigateByUrl('/orders');},
      error: (error) => {
        this.loading.set(false);
        this.error.set(error.error?.error?.message ?? 'Unable to create order.');
      }
    });
  }

  cancel(): void { this.router.navigateByUrl('/orders'); }
}

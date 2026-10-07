import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { AppFormsModule } from '../../shared/app-forms.module';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, Product } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

const HEALTH_BATCH_LIMIT = 100;

@Component({
  selector: 'app-inventory-page',
  imports: [AppFormsModule, ActionDialogComponent, BreadcrumbComponent],
  templateUrl: './inventory.page.html',
  styleUrl: './inventory.page.scss'
})
export class InventoryPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly products = signal<Product[]>([]);
  readonly loading = signal(true);
  health = 'ALL';
  search = '';
  page = 1;
  readonly limit = 20;
  total = 0;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    const requestedHealth = this.route.snapshot.queryParamMap.get('health');
    if (requestedHealth && ['ALL', 'LOW', 'HEALTHY'].includes(requestedHealth)) {
      this.health = requestedHealth;
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private load(): void {
    this.loading.set(true);
    /** "All inventory" paginates server-side; the health filters are quick-glance views over a bounded batch. */
    const options = this.health === 'ALL'
      ? { search: this.search || undefined, page: this.page, limit: this.limit }
      : { search: this.search || undefined, limit: HEALTH_BATCH_LIMIT };
    this.api.getProducts(options).subscribe({
      next: ({ data, meta }) => {
        this.products.set(data);
        this.total = this.health === 'ALL' ? (meta?.total ?? data.length) : this.filterByHealth(data).length;
        this.loading.set(false);
      },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load inventory.'); }
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; this.load(); }, 350);
  }

  onHealthChange(): void {
    this.page = 1;
    this.load();
  }

  private filterByHealth(items: Product[]): Product[] {
    if (this.health === 'LOW') return items.filter((product) => product.stockOnHand <= product.lowStockThreshold);
    if (this.health === 'HEALTHY') return items.filter((product) => product.stockOnHand > product.lowStockThreshold);
    return items;
  }

  filtered(): Product[] { return this.filterByHealth(this.products()); }

  isPaginated(): boolean { return this.health === 'ALL'; }
  totalPages(): number { return Math.max(1, Math.ceil(this.total / this.limit)); }

  goToPage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || (next - 1) * this.limit >= this.total) return;
    this.page = next;
    this.load();
  }

  stockWidth(stock: number): number { return Math.min(100, stock * 4); }

  async adjust(product: Product): Promise<void> {
    const values = await this.confirmDialog.open({
      title: 'Adjust inventory', message: `Update available stock for ${product.name}.`, confirmLabel: 'Save adjustment', fields: [
        { key: 'operation', label: 'Operation', type: 'select', value: 'ADD', options: ['ADD', 'DEDUCT'], required: true },
        { key: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1, required: true },
        { key: 'note', label: 'Adjustment note (optional)', type: 'text', value: '' }
      ]
    });
    if (!values) return;
    const operation = String(values['operation']) as 'ADD' | 'DEDUCT';
    const quantity = Number(values['quantity']);
    const note = String(values['note'] || '') || undefined;
    if (!Number.isInteger(quantity) || quantity <= 0) { this.toast.fail('Inventory quantity must be a positive whole number.'); return; }
    this.loading.set(true);
    this.api.adjustInventory(product.id, operation, quantity, note).subscribe({
      next: () => { this.toast.success('Inventory adjusted.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to adjust inventory.'); }
    });
  }

  async editSettings(product: Product): Promise<void> {
    const values = await this.confirmDialog.open({
      title: 'Inventory settings', message: `Set stock alerts for ${product.name}.`, confirmLabel: 'Save settings', fields: [
        { key: 'threshold', label: 'Low-stock threshold', type: 'number', value: product.lowStockThreshold, min: 1, required: true },
        { key: 'reorder', label: 'Reorder level', type: 'number', value: product.reorderLevel, min: 1, required: true }
      ]
    });
    if (!values) return;
    const threshold = Number(values['threshold']);
    const reorder = Number(values['reorder']);
    if (!Number.isInteger(threshold) || threshold <= 0 || !Number.isInteger(reorder) || reorder <= 0) { this.toast.fail('Threshold and reorder level must be positive whole numbers.'); return; }
    this.loading.set(true);
    this.api.updateInventorySettings(product.id, threshold, reorder).subscribe({
      next: () => { this.toast.success('Inventory settings updated.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to update inventory settings.'); }
    });
  }
}

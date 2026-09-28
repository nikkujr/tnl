import { CurrencyPipe } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, Category, Product } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

@Component({
  selector: 'app-products-page',
  imports: [CurrencyPipe, FormsModule, ActionDialogComponent, AppIconComponent, BreadcrumbComponent],
  templateUrl: './products.page.html',
  styleUrl: './products.page.scss'
})
export class ProductsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly loading = signal(true);
  readonly showForm = signal(false);

  search = '';
  categoryFilter: number | null = null;
  page = 1;
  readonly limit = 20;
  total = 0;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  editingId: number | null = null;
  form = { categoryId: 0, name: '', sku: '', price: 0, description: '' };

  ngOnInit(): void {
    this.api.getCategories({ limit: 100 }).subscribe({ next: ({ data }) => this.categories.set(data) });
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private load(): void {
    this.loading.set(true);
    this.api.getProducts({ search: this.search || undefined, page: this.page, limit: this.limit, categoryId: this.categoryFilter ?? undefined }).subscribe({
      next: ({ data, meta }) => { this.products.set(data); this.total = meta?.total ?? data.length; this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load products.'); }
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; this.load(); }, 350);
  }

  onCategoryFilterChange(): void {
    this.page = 1;
    this.load();
  }

  totalPages(): number { return Math.max(1, Math.ceil(this.total / this.limit)); }

  goToPage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || (next - 1) * this.limit >= this.total) return;
    this.page = next;
    this.load();
  }

  openForm(product?: Product): void {
    this.editingId = product?.id ?? null;
    this.form = {
      categoryId: product?.categoryId ?? this.categories()[0]?.id ?? 0,
      name: product?.name ?? '', sku: product?.sku ?? '', price: product?.price ?? 0, description: product?.description ?? ''
    };
    this.showForm.set(true);
  }

  save(): void {
    const input = { ...this.form, description: this.form.description || null };
    const request = this.editingId ? this.api.updateProduct(this.editingId, input) : this.api.createProduct(input);
    this.loading.set(true);
    request.subscribe({
      next: () => { this.showForm.set(false); this.toast.success(this.editingId ? 'Product updated.' : 'Product created.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to save product.'); }
    });
  }

  async remove(product: Product): Promise<void> {
    const confirmed = await this.confirmDialog.open({ title: 'Delete product?', message: `"${product.name}" will be permanently removed.`, confirmLabel: 'Delete product', tone: 'danger' });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.deleteProduct(product.id).subscribe({
      next: () => { this.toast.success('Product deleted.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to delete product.'); }
    });
  }
}

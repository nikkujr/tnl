import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { AppFormsModule } from '../../shared/app-forms.module';
import { forkJoin } from 'rxjs';
import { BusinessApi, CatalogOffer, SalesPackage } from '../../core/business-api.service';
import { SessionService } from '../../core/session.service';
import { AppIconComponent } from '../../shared/app-icon.component';
@Component({
  selector: 'app-packages',
  imports: [AppFormsModule, CurrencyPipe, AppIconComponent],
  templateUrl: './packages.page.html',
  styleUrls: ['../../shared/business.scss', './packages.page.scss'],
})
export class PackagesPage {
  readonly api = inject(BusinessApi);
  readonly session = inject(SessionService).session;
  readonly packages = signal<SalesPackage[]>([]);
  readonly products = signal<CatalogOffer[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal(false);
  readonly catalogLoading = signal(true);
  readonly componentDialog = viewChild.required<ElementRef<HTMLDialogElement>>('componentDialog');
  readonly productSearch = signal('');
  readonly productPage = signal(1);
  readonly productPageSize = 20;
  readonly selectedProductId = signal(0);
  readonly pickerError = signal('');
  private readonly excludedProductIds = signal<number[]>([]);
  readonly filteredProducts = computed(() => {
    const search = this.productSearch().trim().toLowerCase();
    const excluded = new Set(this.excludedProductIds());
    return this.products().filter(
      (p) =>
        !excluded.has(p.id) &&
        `${p.name} ${p.category ?? ''} ${p.description ?? ''}`.toLowerCase().includes(search),
    );
  });
  readonly visibleProducts = computed(() =>
    this.filteredProducts().slice(
      (this.productPage() - 1) * this.productPageSize,
      this.productPage() * this.productPageSize,
    ),
  );
  readonly productPageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredProducts().length / this.productPageSize)),
  );
  readonly selectedProduct = computed(() =>
    this.products().find((p) => p.id === this.selectedProductId()),
  );
  componentIndex: number | null = null;
  componentQuantity = 1;
  editing: number | null = null;
  form = {
    name: '',
    description: '',
    sellingPrice: 0,
    commissionType: 'FIXED' as 'FIXED' | 'PERCENTAGE',
    commissionValue: 0,
    active: true,
    components: [] as Array<{ productId: number; quantity: number }>,
  };
  constructor() {
    this.load();
  }
  load() {
    forkJoin({
      packages: this.api.get<SalesPackage[]>('packages'),
      catalog: this.api.get<CatalogOffer[]>('catalog'),
    }).subscribe({
      next: (r) => {
        this.packages.set(r.packages.data);
        this.products.set(r.catalog.data.filter((p) => p.kind === 'PRODUCT'));
        this.catalogLoading.set(false);
      },
      error: (e) => {
        this.catalogLoading.set(false);
        this.error.set(e.error?.error?.message ?? 'Cannot load packages');
      },
    });
  }
  edit(p?: SalesPackage) {
    this.editing = p?.id ?? null;
    this.form = p
      ? {
          name: p.name,
          description: p.description,
          sellingPrice: p.sellingPrice,
          commissionType: p.commissionType,
          commissionValue: p.commissionValue,
          active: p.active,
          components: p.components.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }
      : {
          name: '',
          description: '',
          sellingPrice: 0,
          commissionType: 'FIXED',
          commissionValue: 0,
          active: true,
          components: [],
        };
  }
  productName(id: number) {
    return (
      this.products().find((p) => p.id === id)?.name ??
      this.packages()
        .flatMap((p) => p.components)
        .find((c) => c.productId === id)?.productName ??
      `Product #${id}`
    );
  }
  openComponentPicker(index: number | null = null) {
    this.componentIndex = index;
    const component = index === null ? null : this.form.components[index];
    this.selectedProductId.set(component?.productId ?? 0);
    this.componentQuantity = component?.quantity ?? 1;
    this.excludedProductIds.set(
      this.form.components.filter((_, i) => i !== index).map((c) => c.productId),
    );
    this.productSearch.set('');
    this.productPage.set(1);
    this.pickerError.set('');
    this.componentDialog().nativeElement.showModal();
  }
  searchProducts(search: string) {
    this.productSearch.set(search);
    this.productPage.set(1);
  }
  validQuantity(quantity: number) {
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 10000;
  }
  componentsValid() {
    return (
      this.form.components.length > 0 &&
      this.form.components.every((c) => this.validQuantity(c.quantity))
    );
  }
  applyComponent() {
    const product = this.selectedProduct();
    if (!product || !this.validQuantity(this.componentQuantity)) return;
    if (
      this.form.components.some((c, i) => c.productId === product.id && i !== this.componentIndex)
    ) {
      this.pickerError.set('This product is already in the package.');
      return;
    }
    const component = { productId: product.id, quantity: this.componentQuantity };
    if (this.componentIndex === null) {
      if (this.form.components.length >= 50) return;
      this.form.components.push(component);
    } else {
      this.form.components[this.componentIndex] = component;
    }
    this.componentDialog().nativeElement.close();
  }
  save() {
    this.error.set('');
    this.busy.set(true);
    (this.editing
      ? this.api.put(`packages/${this.editing}`, this.form)
      : this.api.post('packages', this.form)
    ).subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set('Package saved. Existing order terms are unchanged.');
        this.edit();
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(e.error?.error?.message ?? 'Cannot save package');
      },
    });
  }
  deactivate(p: SalesPackage) {
    this.api.delete(`packages/${p.id}`).subscribe({
      next: () => this.load(),
      error: (e) => this.error.set(e.error?.error?.message ?? 'Cannot deactivate package'),
    });
  }
}

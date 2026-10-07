import { LowerCasePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppFormsModule } from '../../shared/app-forms.module';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ActionDialogComponent, ActionDialogConfig } from '../../shared/action-dialog.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ApiService, Customer, ImportAgentOption, ImportBatch, ImportRow, Product } from '../../core/api.service';

const SECTION_LABELS: Record<string, string> = {
  STORE_SALES: 'Store sales',
  HOME_CREDIT: 'Home Credit',
  CI_AGENT: 'C.I / Agent',
  CI_PAYMENT: 'C.I payment'
};

@Component({
  selector: 'app-import-review-page',
  imports: [LowerCasePipe, AppFormsModule, ActionDialogComponent, BreadcrumbComponent],
  templateUrl: './import-review.page.html',
  styleUrls: ['./import-review.page.scss']
})
export class ImportReviewPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  batchId = 0;
  readonly batch = signal<ImportBatch | null>(null);
  readonly rows = signal<ImportRow[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly products = signal<Product[]>([]);
  readonly agentOptions = signal<ImportAgentOption[]>([]);
  readonly loading = signal(true);
  readonly confirming = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly actionDialog = signal<ActionDialogConfig | null>(null);
  private dialogAction: (() => void) | null = null;

  page = 1;
  readonly limit = 50;
  total = 0;
  sectionFilter = '';
  statusFilter = '';

  sectionLabel(section: string): string { return SECTION_LABELS[section] ?? section; }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.batchId = Number(params.get('id'));
      this.page = 1;
      this.loadAll();
    });
  }

  private loadAll(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      batch: this.api.getImportBatch(this.batchId),
      rows: this.api.getImportRows(this.batchId, { section: this.sectionFilter || undefined, status: this.statusFilter || undefined, page: this.page, limit: this.limit }),
      customers: this.api.getCustomers({ limit: 100 }),
      products: this.api.getProducts({ limit: 100 }),
      agents: this.api.getImportAgentOptions()
    }).subscribe({
      next: (result) => {
        this.batch.set(result.batch.data);
        this.rows.set(result.rows.data);
        this.total = result.rows.meta?.total ?? result.rows.data.length;
        this.customers.set(result.customers.data);
        this.products.set(result.products.data);
        this.agentOptions.set(result.agents.data);
        this.loading.set(false);
      },
      error: (error) => { this.loading.set(false); this.setError(error.error?.error?.message ?? 'Unable to load this import.'); }
    });
  }

  private reloadRows(): void {
    this.api.getImportRows(this.batchId, { section: this.sectionFilter || undefined, status: this.statusFilter || undefined, page: this.page, limit: this.limit }).subscribe({
      next: ({ data, meta }) => { this.rows.set(data); this.total = meta?.total ?? data.length; },
      error: (error) => this.setError(error.error?.error?.message ?? 'Unable to refresh rows.')
    });
    this.api.getImportBatch(this.batchId).subscribe({ next: ({ data }) => this.batch.set(data) });
  }

  onFilterChange(): void { this.page = 1; this.reloadRows(); }

  goToPage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || (next - 1) * this.limit >= this.total) return;
    this.page = next;
    this.reloadRows();
  }

  totalPages(): number { return Math.max(1, Math.ceil(this.total / this.limit)); }

  customerSelectValue(row: ImportRow): string { return row.customerId ? String(row.customerId) : '__new__'; }
  productSelectValue(row: ImportRow): string { return row.productId ? String(row.productId) : '__new__'; }

  onCustomerSelect(row: ImportRow, value: string): void {
    if (value === '__new__') {
      row.customerId = null;
      row.newCustomerName = row.newCustomerName || row.rawCustomerName || '';
      this.patch(row, { customerId: null, newCustomerName: row.newCustomerName });
    } else {
      const id = Number(value);
      row.customerId = id;
      row.customerName = this.customers().find((c) => c.id === id)?.fullName ?? null;
      row.newCustomerName = null;
      this.patch(row, { customerId: id });
    }
  }

  onNewCustomerNameBlur(row: ImportRow): void {
    if (row.customerId) return;
    this.patch(row, { newCustomerName: row.newCustomerName });
  }

  onProductSelect(row: ImportRow, value: string): void {
    if (value === '__new__') {
      row.productId = null;
      row.newProductName = row.newProductName || row.rawProductName || '';
      this.patch(row, { productId: null, newProductName: row.newProductName });
    } else {
      const id = Number(value);
      row.productId = id;
      row.productName = this.products().find((p) => p.id === id)?.name ?? null;
      row.newProductName = null;
      this.patch(row, { productId: id });
    }
  }

  onNewProductNameBlur(row: ImportRow): void {
    if (row.productId) return;
    this.patch(row, { newProductName: row.newProductName });
  }

  onAgentChange(row: ImportRow): void { this.patch(row, { agentId: row.agentId }); }
  onAmountBlur(row: ImportRow): void { this.patch(row, { unitPrice: Number(row.unitPrice) }); }
  onOrderDateBlur(row: ImportRow): void { this.patch(row, { orderDate: row.orderDate }); }

  toggleSkip(row: ImportRow, checked: boolean): void {
    this.patch(row, { skipped: checked });
  }

  private patch(row: ImportRow, body: Parameters<ApiService['patchImportRow']>[2]): void {
    this.api.patchImportRow(this.batchId, row.id, body).subscribe({
      next: ({ data }) => {
        row.status = data.status as ImportRow['status'];
        row.issue = data.issue;
        this.api.getImportBatch(this.batchId).subscribe({ next: ({ data: batch }) => this.batch.set(batch) });
      },
      error: (error) => this.setError(error.error?.error?.message ?? 'Unable to save that change.')
    });
  }

  confirm(): void {
    const batch = this.batch();
    if (!batch) return;
    this.openDialog({ title: 'Confirm import?', message: `${batch.readyRows} order(s) will be created from this file. This can't be undone.`, confirmLabel: 'Confirm import' }, () => {
      this.confirming.set(true);
      this.api.confirmImportBatch(this.batchId).subscribe({
        next: ({ data }) => {
          sessionStorage.setItem('tnl_flash', `Imported ${data.ordersCreated} order(s), created ${data.newCustomers} new customer(s) and ${data.newProducts} new product(s).`);
          this.router.navigateByUrl('/orders');
        },
        error: (error) => { this.confirming.set(false); this.setError(error.error?.error?.message ?? 'Unable to confirm this import.'); }
      });
    });
  }

  cancelBatch(): void {
    this.openDialog({ title: 'Discard this import?', message: 'All parsed rows will be deleted. Nothing has been written to orders yet.', confirmLabel: 'Discard import', tone: 'danger' }, () => {
      this.api.cancelImportBatch(this.batchId).subscribe({
        next: () => this.router.navigateByUrl('/imports'),
        error: (error) => this.setError(error.error?.error?.message ?? 'Unable to discard this import.')
      });
    });
  }

  private openDialog(config: ActionDialogConfig, action: () => void): void {
    this.dialogAction = action;
    this.actionDialog.set(config);
  }
  closeActionDialog(): void { this.actionDialog.set(null); this.dialogAction = null; }
  confirmActionDialog(): void {
    const action = this.dialogAction;
    this.closeActionDialog();
    action?.();
  }

  private setError(message: string): void { this.error.set(message); }
}

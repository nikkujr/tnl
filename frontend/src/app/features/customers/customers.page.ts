import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Agent, ApiService, Customer } from '../../core/api.service';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

@Component({
  selector: 'app-customers-page',
  imports: [FormsModule, ActionDialogComponent, AppIconComponent, BreadcrumbComponent],
  templateUrl: './customers.page.html',
  styleUrl: './customers.page.scss'
})
export class CustomersPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly session = inject(SessionService).session;
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly customers = signal<Customer[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly activeAgents = computed(() => this.agents().filter((agent) => agent.active));
  readonly loading = signal(true);
  readonly showForm = signal(false);

  search = '';
  agentFilter: number | null = null;
  page = 1;
  readonly limit = 20;
  total = 0;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  editingId: number | null = null;
  form = { fullName: '', email: '', phone: '', address: '', assignedAgentId: null as number | null };

  ngOnInit(): void {
    const focusName = this.route.snapshot.queryParamMap.get('focus');
    if (focusName) {
      this.search = focusName;
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
    this.loadAgents();
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private loadAgents(): void {
    if (this.session()?.role !== 'ADMIN') return;
    this.api.getAgents().subscribe({ next: ({ data }) => this.agents.set(data) });
  }

  private load(): void {
    this.loading.set(true);
    this.api.getCustomers({ search: this.search || undefined, page: this.page, limit: this.limit, agentId: this.agentFilter ?? undefined }).subscribe({
      next: ({ data, meta }) => { this.customers.set(data); this.total = meta?.total ?? data.length; this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load customers.'); }
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; this.load(); }, 350);
  }

  onAgentFilterChange(): void {
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

  openForm(customer?: Customer): void {
    this.editingId = customer?.id ?? null;
    this.form = {
      fullName: customer?.fullName ?? '', email: customer?.email ?? '', phone: customer?.phone ?? '', address: customer?.address ?? '',
      assignedAgentId: customer?.assignedAgentId ?? (this.session()?.role === 'AGENT' ? this.session()!.id : null)
    };
    this.showForm.set(true);
  }

  save(): void {
    const input = { ...this.form };
    const request = this.editingId ? this.api.updateCustomer(this.editingId, input) : this.api.createCustomer(input);
    this.loading.set(true);
    request.subscribe({
      next: () => { this.showForm.set(false); this.toast.success(this.editingId ? 'Customer updated.' : 'Customer created.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to save customer.'); }
    });
  }

  async remove(customer: Customer): Promise<void> {
    const confirmed = await this.confirmDialog.open({ title: 'Delete customer?', message: `"${customer.fullName}" will be permanently removed if no order history exists.`, confirmLabel: 'Delete customer', tone: 'danger' });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.deleteCustomer(customer.id).subscribe({
      next: () => { this.toast.success('Customer deleted.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to delete customer.'); }
    });
  }
}

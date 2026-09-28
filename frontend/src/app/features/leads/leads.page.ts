import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Agent, ApiService, Lead } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

@Component({
  selector: 'app-leads-page',
  imports: [FormsModule, ActionDialogComponent, AppIconComponent, BreadcrumbComponent],
  templateUrl: './leads.page.html',
  styleUrl: './leads.page.scss'
})
export class LeadsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly leads = signal<Lead[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly activeAgents = computed(() => this.agents().filter((agent) => agent.active));
  readonly loading = signal(true);
  readonly showForm = signal(false);

  search = '';
  status = 'ALL';
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  editingId: number | null = null;
  form = { fullName: '', email: '', phone: '', source: '', assignedAgentId: null as number | null, status: 'NEW' };

  filtered(): Lead[] {
    return this.status === 'ALL' ? this.leads() : this.leads().filter((lead) => lead.status === this.status);
  }

  ngOnInit(): void {
    this.api.getAgents().subscribe({ next: ({ data }) => this.agents.set(data) });
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private load(): void {
    this.loading.set(true);
    this.api.getLeads({ search: this.search || undefined }).subscribe({
      next: ({ data }) => { this.leads.set(data); this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load leads.'); }
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.load(), 350);
  }

  titleCase(value: string): string { return value.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '); }

  openForm(item?: Lead): void {
    this.editingId = item?.id ?? null;
    this.form = {
      fullName: item?.fullName ?? '', email: item?.email ?? '', phone: item?.phone ?? '', source: item?.source ?? '',
      assignedAgentId: item?.assignedAgentId ?? null, status: item?.status === 'CONVERTED' ? 'QUALIFIED' : item?.status ?? 'NEW'
    };
    this.showForm.set(true);
  }

  save(): void {
    const input = { ...this.form } as Omit<Lead, 'id' | 'assignedAgentName'>;
    const request = this.editingId ? this.api.updateLead(this.editingId, input) : this.api.createLead(input);
    this.loading.set(true);
    request.subscribe({
      next: () => { this.showForm.set(false); this.toast.success(this.editingId ? 'Lead updated.' : 'Lead created.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to save lead.'); }
    });
  }

  convertLead(lead: Lead): void {
    this.loading.set(true);
    this.api.convertLead(lead.id).subscribe({
      next: () => { this.toast.success('Lead converted to customer.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to convert lead.'); }
    });
  }

  async remove(lead: Lead): Promise<void> {
    const confirmed = await this.confirmDialog.open({ title: 'Delete lead?', message: `"${lead.fullName}" will be permanently removed.`, confirmLabel: 'Delete lead', tone: 'danger' });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.deleteLead(lead.id).subscribe({
      next: () => { this.toast.success('Lead deleted.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to delete lead.'); }
    });
  }
}

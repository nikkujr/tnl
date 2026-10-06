import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ApiService, Agent } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import {
  PasswordResetDialogComponent,
  PasswordResetTarget,
} from '../../shared/password-reset-dialog.component';

@Component({
  selector: 'app-agents-list-page',
  imports: [
    FormsModule,
    CurrencyPipe,
    DecimalPipe,
    RouterLink,
    ActionDialogComponent,
    AppIconComponent,
    BreadcrumbComponent,
    PasswordResetDialogComponent,
  ],
  templateUrl: './agents-list.page.html',
  styleUrl: './agents-list.page.scss',
})
export class AgentsListPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly agents = signal<Agent[]>([]);
  readonly loading = signal(true);
  readonly showForm = signal(false);
  readonly resetTarget = signal<PasswordResetTarget | null>(null);

  resetPassword(agent: Agent): void {
    this.resetTarget.set({
      id: agent.id,
      fullName: agent.fullName,
      email: agent.email,
      kind: 'agents',
    });
  }

  search = '';
  status = 'ALL';
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  editingId: number | null = null;
  form = { fullName: '', email: '', phone: '', password: '', commissionRate: 0 };

  filtered(): Agent[] {
    if (this.status === 'ACTIVE') return this.agents().filter((agent) => agent.active);
    if (this.status === 'INACTIVE') return this.agents().filter((agent) => !agent.active);
    return this.agents();
  }

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private load(): void {
    this.loading.set(true);
    this.api.getAgents({ search: this.search || undefined }).subscribe({
      next: ({ data }) => {
        this.agents.set(data);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.toast.fail(error.error?.error?.message ?? 'Unable to load agents.');
      },
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.load(), 350);
  }

  viewAgent(agent: Agent): void {
    this.router.navigateByUrl(`/agents/${agent.id}`);
  }

  openForm(item?: Agent): void {
    this.editingId = item?.id ?? null;
    this.form = {
      fullName: item?.fullName ?? '',
      email: item?.email ?? '',
      phone: item?.phone ?? '',
      password: '',
      commissionRate: item?.commissionRate ?? 0,
    };
    this.showForm.set(true);
  }

  save(): void {
    if (!this.editingId && !this.form.password) {
      this.toast.fail('A password is required for a new agent.');
      return;
    }
    const input = { ...this.form };
    const request = this.editingId
      ? this.api.updateAgent(this.editingId, { ...input, password: input.password || undefined })
      : this.api.createAgent(input);
    this.loading.set(true);
    request.subscribe({
      next: () => {
        this.showForm.set(false);
        this.toast.success(this.editingId ? 'Agent updated.' : 'Agent created.');
        this.load();
      },
      error: (error) => {
        this.loading.set(false);
        this.toast.fail(error.error?.error?.message ?? 'Unable to save agent.');
      },
    });
  }

  async deactivate(item: Agent): Promise<void> {
    if (!item.active) return;
    const confirmed = await this.confirmDialog.open({
      title: 'Deactivate agent?',
      message: `"${item.fullName}" will lose access and disappear from assignment lists.`,
      confirmLabel: 'Deactivate',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.deleteAgent(item.id).subscribe({
      next: () => {
        this.toast.success('Agent deactivated.');
        this.load();
      },
      error: (error) => {
        this.loading.set(false);
        this.toast.fail(error.error?.error?.message ?? 'Unable to deactivate agent.');
      },
    });
  }

  async activate(item: Agent): Promise<void> {
    if (item.active) return;
    const confirmed = await this.confirmDialog.open({
      title: 'Activate agent?',
      message: `"${item.fullName}" will regain login access and become available for assignments.`,
      confirmLabel: 'Activate agent',
    });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.activateAgent(item.id).subscribe({
      next: () => {
        this.toast.success('Agent activated.');
        this.load();
      },
      error: (error) => {
        this.loading.set(false);
        this.toast.fail(error.error?.error?.message ?? 'Unable to activate agent.');
      },
    });
  }
}

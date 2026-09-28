import { DatePipe } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, Campaign } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { RichTextEditorComponent } from '../../shared/rich-text-editor.component';

@Component({
  selector: 'app-campaigns-page',
  imports: [DatePipe, FormsModule, ActionDialogComponent, AppIconComponent, BreadcrumbComponent, RichTextEditorComponent],
  templateUrl: './campaigns.page.html',
  styleUrl: './campaigns.page.scss'
})
export class CampaignsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly campaigns = signal<Campaign[]>([]);
  readonly loading = signal(true);
  readonly showForm = signal(false);

  search = '';
  status = 'ALL';
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  editingId: number | null = null;
  form = { name: '', targetAudience: '', content: '', startDate: '', endDate: '', status: 'DRAFT' };

  filtered(): Campaign[] {
    return this.status === 'ALL' ? this.campaigns() : this.campaigns().filter((item) => item.status === this.status);
  }

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private load(): void {
    this.loading.set(true);
    this.api.getCampaigns(this.search).subscribe({
      next: ({ data }) => { this.campaigns.set(data); this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load campaigns.'); }
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.load(), 350);
  }

  titleCase(value: string): string { return value.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '); }

  openForm(item?: Campaign): void {
    this.editingId = item?.id ?? null;
    this.form = {
      name: item?.name ?? '', targetAudience: item?.targetAudience ?? '', content: item?.content ?? '',
      startDate: item?.startDate?.slice(0, 10) ?? '', endDate: item?.endDate?.slice(0, 10) ?? '', status: item?.status ?? 'DRAFT'
    };
    this.showForm.set(true);
  }

  save(): void {
    if (this.form.endDate <= this.form.startDate) { this.toast.fail('Campaign end date must be later than its start date.'); return; }
    const input = { ...this.form } as Omit<Campaign, 'id'>;
    const request = this.editingId ? this.api.updateCampaign(this.editingId, input) : this.api.createCampaign(input);
    this.loading.set(true);
    request.subscribe({
      next: () => { this.showForm.set(false); this.toast.success(this.editingId ? 'Campaign updated.' : 'Campaign created.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to save campaign.'); }
    });
  }

  async remove(item: Campaign): Promise<void> {
    const confirmed = await this.confirmDialog.open({ title: 'Delete campaign?', message: `"${item.name}" will be permanently removed.`, confirmLabel: 'Delete campaign', tone: 'danger' });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.deleteCampaign(item.id).subscribe({
      next: () => { this.toast.success('Campaign deleted.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to delete campaign.'); }
    });
  }

  async send(item: Campaign): Promise<void> {
    const confirmed = await this.confirmDialog.open({ title: 'Send campaign email?', message: `"${item.name}" will be sent to all customer email addresses using BCC.`, confirmLabel: 'Send campaign' });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.sendCampaign(item.id).subscribe({
      next: ({ data }) => { this.toast.success(`Campaign sent to ${data.recipientCount} customer${data.recipientCount === 1 ? '' : 's'}.`); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to send campaign email.'); }
    });
  }
}

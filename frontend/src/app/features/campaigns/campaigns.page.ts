import { DatePipe, JsonPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BusinessApi } from '../../core/business-api.service';
import { Campaign, Customer } from '../../core/api.service';
import { RichTextEditorComponent } from '../../shared/rich-text-editor.component';
import { AppIconComponent } from '../../shared/app-icon.component';
@Component({
  selector: 'app-campaigns-page',
  imports: [DatePipe, JsonPipe, FormsModule, RichTextEditorComponent, AppIconComponent],
  templateUrl: './campaigns.page.html',
  styleUrls: ['../../shared/business.scss', './campaigns.page.scss'],
})
export class CampaignsPage {
  readonly api = inject(BusinessApi);
  readonly campaigns = signal<Campaign[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly customerDialog = viewChild.required<ElementRef<HTMLDialogElement>>('customerDialog');
  readonly customerLoading = signal(false);
  readonly customerError = signal('');
  readonly customerTotal = signal(0);
  readonly pendingCustomerIds = signal<number[]>([]);
  readonly customerPageSize = 25;
  private readonly destroyRef = inject(DestroyRef);
  private customerRequest?: Subscription;
  customerSearch = '';
  customerPage = 1;
  readonly recipients = signal<any[]>([]);
  readonly outcomes = signal<any[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly showForm = signal(false);
  private readonly injector = inject(Injector);
  private readonly formHeading = viewChild<ElementRef<HTMLElement>>('formHeading');
  private readonly previewHeading = viewChild<ElementRef<HTMLElement>>('previewHeading');
  readonly previewName = signal('');
  editingId: number | null = null;
  previewId = 0;
  search = '';
  form = {
    name: '',
    content: '',
    startDate: '',
    endDate: '',
    status: 'DRAFT',
    audienceType: 'ALL',
    customerIds: [] as number[],
    scheduledAt: '',
  };
  constructor() {
    this.load();
  }
  load() {
    this.api
      .get<Campaign[]>('campaigns', { search: this.search })
      .subscribe({ next: (r) => this.campaigns.set(r.data), error: (e) => this.fail(e) });
  }
  dateOnly(value: string) {
    return value ? value.slice(0, 10) + 'T00:00:00Z' : null;
  }
  openForm(c?: Campaign) {
    this.editingId = c?.id ?? null;
    const date = c?.scheduledAt
      ? new Date(new Date(c.scheduledAt).getTime() + 8 * 3600000).toISOString().slice(0, 16)
      : '';
    this.form = {
      name: c?.name ?? '',
      content: c?.content ?? '',
      startDate: c?.startDate?.slice(0, 10) ?? '',
      endDate: c?.endDate?.slice(0, 10) ?? '',
      status: c?.status === 'SCHEDULED' ? 'SCHEDULED' : 'DRAFT',
      audienceType: c?.audienceType ?? 'ALL',
      customerIds: [...(c?.customerIds ?? [])],
      scheduledAt: date,
    };
    this.showForm.set(true);
    afterNextRender(
      () => {
        this.formHeading()?.nativeElement.focus({ preventScroll: true });
        this.formHeading()?.nativeElement.scrollIntoView({ block: 'start' });
      },
      { injector: this.injector },
    );
  }
  select(id: number, checked: boolean) {
    this.pendingCustomerIds.update((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((i) => i !== id),
    );
  }
  openCustomerPicker() {
    this.pendingCustomerIds.set([...this.form.customerIds]);
    this.customerSearch = '';
    this.findCustomers();
    this.customerDialog().nativeElement.showModal();
  }
  closeCustomerPicker(apply = false) {
    if (apply) this.form.customerIds = [...this.pendingCustomerIds()];
    this.customerDialog().nativeElement.close();
  }
  allCustomersOnPageSelected() {
    return (
      this.customers().length > 0 &&
      this.customers().every((c) => this.pendingCustomerIds().includes(c.id))
    );
  }
  someCustomersOnPageSelected() {
    return (
      this.customers().some((c) => this.pendingCustomerIds().includes(c.id)) &&
      !this.allCustomersOnPageSelected()
    );
  }
  selectCustomerPage(checked: boolean) {
    const pageIds = new Set(this.customers().map((c) => c.id));
    this.pendingCustomerIds.update((ids) =>
      checked ? [...new Set([...ids, ...pageIds])] : ids.filter((id) => !pageIds.has(id)),
    );
  }
  findCustomers(page = 1) {
    this.customerRequest?.unsubscribe();
    this.customerPage = page;
    this.customerLoading.set(true);
    this.customerError.set('');
    this.customers.set([]);
    this.customerRequest = this.api
      .get<Customer[]>('customers', {
        search: this.customerSearch,
        page,
        limit: this.customerPageSize,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.customers.set(r.data);
          this.customerTotal.set(r.meta?.total ?? r.data.length);
          this.customerLoading.set(false);
        },
        error: (e) => {
          this.customerError.set(e.error?.error?.message ?? 'Unable to load customers. Try again.');
          this.customerLoading.set(false);
        },
      });
  }
  save() {
    const input = {
      ...this.form,
      scheduledAt: this.form.scheduledAt ? this.form.scheduledAt + ':00+08:00' : null,
    };
    const request = this.editingId
      ? this.api.put('campaigns/' + this.editingId, input)
      : this.api.post('campaigns', input);
    request.subscribe({
      next: () => {
        this.showForm.set(false);
        this.notice.set('Campaign saved.');
        this.load();
      },
      error: (e) => this.fail(e),
    });
  }
  preview(c: Campaign) {
    this.previewId = c.id;
    this.previewName.set(c.name);
    afterNextRender(
      () => {
        this.previewHeading()?.nativeElement.focus({ preventScroll: true });
        this.previewHeading()?.nativeElement.scrollIntoView({ block: 'start' });
      },
      { injector: this.injector },
    );
    this.api
      .get<any[]>(`campaigns/${c.id}/recipients`)
      .subscribe({ next: (r) => this.recipients.set(r.data), error: (e) => this.fail(e) });
    this.results(c.id);
  }
  results(id: number) {
    this.api
      .get<any[]>(`campaigns/${id}/results`)
      .subscribe({ next: (r) => this.outcomes.set(r.data), error: (e) => this.fail(e) });
  }
  send() {
    this.api.post(`campaigns/${this.previewId}/send`).subscribe({
      next: (r) => {
        this.notice.set(
          `${r.data.recipientCount} recipient actions queued. Repeated sends reuse this run.`,
        );
        this.results(this.previewId);
        this.load();
      },
      error: (e) => this.fail(e),
    });
  }
  private fail(e: any) {
    this.error.set(e.error?.error?.message ?? 'Unable to complete this action.');
  }
}

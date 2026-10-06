import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BusinessApi } from '../../core/business-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

type HistoryView = 'orders' | 'requests' | 'reviews' | 'followups';

@Component({
  selector: 'app-customer-detail',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, RouterLink, BreadcrumbComponent],
  templateUrl: './customer-detail.page.html',
  styleUrls: ['../../shared/business.scss', './customer-detail.page.scss'],
})
export class CustomerDetailPage implements OnInit {
  private readonly api = inject(BusinessApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly data = signal<any>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly views: Array<{ value: HistoryView; label: string; count: string }> = [
    { value: 'orders', label: 'Orders', count: 'orderCount' },
    { value: 'requests', label: 'Requests', count: 'requestCount' },
    { value: 'reviews', label: 'Reviews', count: 'reviewCount' },
    { value: 'followups', label: 'Follow-ups', count: 'followupCount' },
  ];
  view: HistoryView = 'orders';
  page = 1;
  readonly limit = 20;
  total = 0;
  private id = 0;
  private requestNumber = 0;

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.id = Number(params.get('id'));
      this.view = 'orders';
      this.page = 1;
      this.data.set(null);
      this.load();
    });
  }
  load() {
    const request = ++this.requestNumber;
    this.loading.set(true);
    this.error.set('');
    this.api
      .get(`customers/${this.id}`, { view: this.view, page: this.page, limit: this.limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (request !== this.requestNumber) return;
          this.data.set(response.data);
          this.total = response.meta?.total ?? response.data.records.length;
          this.loading.set(false);
        },
        error: (e) => {
          if (request !== this.requestNumber) return;
          this.loading.set(false);
          this.error.set(e.error?.error?.message ?? 'Unable to load customer details.');
        },
      });
  }
  selectView(view: HistoryView) {
    this.view = view;
    this.page = 1;
    this.load();
  }
  changePage(delta: number) {
    const page = this.page + delta;
    if (page < 1 || (page - 1) * this.limit >= this.total) return;
    this.page = page;
    this.load();
  }
  titleCase(value: string | null) {
    return value
      ? value
          .toLowerCase()
          .replaceAll('_', ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Not started';
  }
}

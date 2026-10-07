import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppFormsModule } from '../../shared/app-forms.module';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';
import { BusinessApi } from '../../core/business-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { downloadCsv, printReport } from '../../shared/report-output';
import { ProductRankingComponent } from './product-ranking.component';
import { BusinessReport, fillTrend, ReportPeriod } from './reports.model';

@Component({
  selector: 'app-reports-page',
  imports: [
    AppFormsModule,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    BreadcrumbComponent,
    ProductRankingComponent,
  ],
  templateUrl: './reports.page.html',
  styleUrl: './reports.page.scss',
})
export class ReportsPage implements OnInit {
  private readonly api = inject(BusinessApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private requestNumber = 0;
  readonly period = signal<ReportPeriod>('daily');
  readonly report = signal<BusinessReport | null>(null);
  readonly loadedAt = signal('');
  readonly print = printReport;
  readonly loading = signal(false);
  readonly error = signal('');
  readonly periods: ReportPeriod[] = ['daily', 'monthly', 'overall'];
  readonly today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  date = this.today;
  month = this.today.slice(0, 7);
  readonly trend = computed(() => (this.report() ? fillTrend(this.report()!) : []));
  readonly maximumRevenue = computed(() =>
    Math.max(1, ...this.trend().map((r) => Number(r.revenue))),
  );
  ngOnInit() {
    combineLatest([this.route.data, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([data, params]) => {
        this.period.set(data['period']);
        this.date = params.get('date') ?? this.today;
        this.month = params.get('month') ?? this.today.slice(0, 7);
        this.load();
      });
  }
  apply() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.period() === 'daily' ? { date: this.date } : { month: this.month },
    });
  }
  load() {
    const request = ++this.requestNumber;
    this.error.set('');
    this.report.set(null);
    const period = this.period();
    if (
      (period === 'daily' &&
        (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])-\d{2}$/.test(this.date) ||
          Number.isNaN(Date.parse(this.date)) ||
          new Date(this.date).toISOString().slice(0, 10) !== this.date)) ||
      (period === 'monthly' && !/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(this.month))
    ) {
      this.loading.set(false);
      this.error.set('Choose a valid date or month between 2000 and 2100.');
      return;
    }
    this.loading.set(true);
    const query: Record<string, string> = { period };
    if (period === 'daily') query['date'] = this.date;
    if (period === 'monthly') query['month'] = this.month;
    this.api
      .get<BusinessReport>('reports', query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          if (request === this.requestNumber) {
            this.report.set(data);
            this.loadedAt.set(new Date().toISOString());
            this.loading.set(false);
          }
        },
        error: (e) => {
          if (request === this.requestNumber) {
            this.error.set(e.error?.error?.message ?? 'Unable to load reports. Please try again.');
            this.loading.set(false);
          }
        },
      });
  }
  label(value: string) {
    return value[0].toUpperCase() + value.slice(1).toLowerCase().replaceAll('_', ' ');
  }
  exportCsv() {
    const data = this.report();
    if (!data || this.loading()) return;
    const rows = [
      { section: 'Sales summary', ...data.totals },
      ...fillTrend(data).map((row) => ({ section: 'Sales trend', ...row })),
      ...data.fastProducts.map((row, index) => ({
        section: 'Fast-selling products',
        rank: index + 1,
        ...row,
      })),
      ...data.slowProducts.map((row, index) => ({
        section: 'Slow-moving products',
        rank: index + 1,
        ...row,
      })),
      ...data.customers.map((row) => ({ section: 'Top customers', ...row })),
      ...data.packages.map((row) => ({ section: 'Top packages', ...row })),
      ...data.statuses.map((row) => ({ section: 'Order status', ...row })),
      ...data.payments.map((row) => ({ section: 'Payment status', ...row })),
      { section: 'Current stock summary', ...data.stock },
      ...data.stockAlerts.map((row) => ({ section: 'Current low stock', ...row })),
    ];
    downloadCsv(
      `tnl-${data.period}${data.period === 'overall' ? '' : '-' + data.selection}.csv`,
      rows.map((row) => ({
        period: data.period,
        selection: data.selection,
        timeZone: data.timeZone,
        currency: 'PHP',
        loadedAt: this.loadedAt(),
        ...row,
      })),
    );
  }
  trendLabel(value: string) {
    return this.period() === 'daily'
      ? value.slice(11)
      : this.period() === 'monthly'
        ? value.slice(8)
        : value;
  }
}

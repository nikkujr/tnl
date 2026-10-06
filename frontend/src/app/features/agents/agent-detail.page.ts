import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AgentDetail, AgentOrder, AgentReview, ApiService } from '../../core/api.service';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { AgentRewardsComponent } from '../../shared/agent-rewards.component';

type SectionKey = 'customers' | 'orders' | 'commissions';

@Component({
  selector: 'app-agent-detail-page',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, RouterLink, AppIconComponent, BreadcrumbComponent, AgentRewardsComponent],
  templateUrl: './agent-detail.page.html',
  styleUrls: ['./agent-detail.page.scss'],
})
export class AgentDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly today = new Date();

  readonly agent = signal<AgentDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly collapsedSections = signal<Set<SectionKey>>(new Set());
  readonly chartsAnimated = signal(false);
  readonly reviews = signal<AgentReview[]>([]);
  readonly reviewsLoading = signal(false);
  readonly reviewsError = signal('');
  reviewPage = 1;
  reviewTotal = 0;
  readonly reviewLimit = 20;
  private requestNumber = 0;
  private reviewRequest = 0;

  readonly commissionTrend = computed(() => {
    const data = this.agent();
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const item of data.commissions) {
      const key = item.createdAt.slice(0, 7);
      totals.set(key, (totals.get(key) ?? 0) + Number(item.amount));
    }
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(this.today.getFullYear(), this.today.getMonth() - 5 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return {
        key,
        label: date.toLocaleString('en', { month: 'short' }),
        amount: totals.get(key) ?? 0,
      };
    });
    const maximum = Math.max(...months.map((item) => item.amount), 1);
    return months.map((item) => ({
      ...item,
      height: item.amount === 0 ? 0 : Math.max(6, (item.amount / maximum) * 100),
    }));
  });

  readonly orderStatusBreakdown = computed(() => {
    const data = this.agent();
    if (!data || !data.orders.length) return [];
    const counts = new Map<string, number>();
    for (const order of data.orders) {
      const label = this.titleCase(order.deliveryStatus || order.orderStatus);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const total = data.orders.length;
    return Array.from(counts.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / total) * 100),
        statusClass: this.statusClass(label),
      }))
      .sort((a, b) => b.count - a.count);
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      this.load(id);
    });
  }

  private load(id: number): void {
    const request = ++this.requestNumber;
    ++this.reviewRequest;
    this.reviewPage = 1;
    this.reviewTotal = 0;
    this.reviews.set([]);
    this.reviewsLoading.set(false);
    this.reviewsError.set('');
    this.agent.set(null);
    this.loading.set(true);
    this.error.set('');
    this.chartsAnimated.set(false);
    this.api.getAgent(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ data }) => {
        if (request !== this.requestNumber) return;
        this.agent.set(data);
        this.loading.set(false);
        this.loadReviews();
        window.setTimeout(() => this.chartsAnimated.set(true), 30);
      },
      error: (error) => {
        if (request !== this.requestNumber) return;
        this.loading.set(false);
        this.error.set(error.error?.error?.message ?? 'Unable to load this agent.');
      },
    });
  }

  loadReviews(): void {
    const agent = this.agent();
    if (!agent) return;
    const request = ++this.reviewRequest;
    this.reviewsLoading.set(true);
    this.reviewsError.set('');
    this.api.getAgentReviews(agent.id, this.reviewPage, this.reviewLimit)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ data, meta }) => {
          if (request !== this.reviewRequest) return;
          this.reviews.set(data);
          this.reviewTotal = meta?.total ?? data.length;
          this.reviewsLoading.set(false);
        },
        error: e => {
          if (request !== this.reviewRequest) return;
          this.reviewsLoading.set(false);
          this.reviewsError.set(e.error?.error?.message ?? 'Unable to load customer feedback.');
        },
      });
  }
  changeReviewPage(delta: number): void {
    const page = this.reviewPage + delta;
    if (page < 1 || (page - 1) * this.reviewLimit >= this.reviewTotal || this.reviewsLoading()) return;
    this.reviewPage = page;
    this.loadReviews();
  }

  back(): void {
    this.router.navigateByUrl('/agents');
  }

  viewCustomer(customerName: string): void {
    this.router.navigateByUrl(`/customers?focus=${encodeURIComponent(customerName)}`);
  }

  toggleSection(key: SectionKey): void {
    this.collapsedSections.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  isCollapsed(key: SectionKey): boolean {
    return this.collapsedSections().has(key);
  }
  commissionExplanation(order: AgentOrder): string {
    const labels: Record<AgentOrder['commissionStatus'], string> = {
      EARNED: 'Package commission earned',
      STANDALONE: 'No commission — standalone products',
      CANCELLED: 'No commission — order cancelled or rejected',
      LEGACY_REVIEW: 'Historical terms — review existing records',
      OTHER_AGENT: 'Commission credited to another agent',
      POSTING_REVIEW: 'Commission posting needs review',
      AWAITING_APPROVAL: 'Commission awaits order approval',
      AWAITING_PAYMENT: 'Commission awaits full payment',
      AWAITING_DELIVERY: 'Commission awaits delivery',
      AWAITING_COMPLETION: 'Commission awaits delivery and full payment',
    };
    return labels[order.commissionStatus] ?? 'Commission status unavailable';
  }

  statusClass(status: string): string {
    return status.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  }
  titleCase(value: string | null): string {
    return value
      ? value
          .toLowerCase()
          .split('_')
          .map((part) => part[0]?.toUpperCase() + part.slice(1))
          .join(' ')
      : 'Not started';
  }
}

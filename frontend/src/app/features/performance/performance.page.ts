import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  inject,
  Injector,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApi } from '../../core/business-api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { downloadCsv, printReport } from '../../shared/report-output';

interface PerformanceAgent {
  id: number;
  fullName: string;
  active: boolean;
  rank: number;
  sales: number;
  deals: number;
  pipeline: number;
  pending: number;
  commission: number;
  reviewCount: number;
  averageRating: number | null;
  targetId: number | null;
  salesTarget: number | null;
  incentiveAmount: number | null;
  incentives: number;
  bonuses: number;
  progress: number | null;
  incentiveStatus: 'NONE' | 'IN_PROGRESS' | 'ELIGIBLE' | 'APPROVED';
}
interface PerformanceReport {
  period: string;
  timeZone: string;
  agents: PerformanceAgent[];
  reviews: Array<{ orderId: number; trackingNumber: string; customerName: string; agentId: number | null; agentName: string | null; rating: number; review: string; createdAt: string }>;
  trend: Array<{ day: string; sales: number; deals: number }>;
  totals: {
    sales: number;
    deals: number;
    commission: number;
    incentives: number;
    bonuses: number;
    targetsMet: number;
    targetsSet: number;
  };
  rewards: Array<{
    id: number;
    agentId: number;
    agentName: string;
    kind: 'BONUS' | 'INCENTIVE';
    amount: number;
    reason: string;
    approvedBy: string;
    createdAt: string;
  }>;
}

@Component({
  selector: 'app-performance-page',
  imports: [FormsModule, CurrencyPipe, DatePipe, DecimalPipe, RouterLink, BreadcrumbComponent],
  templateUrl: './performance.page.html',
  styleUrl: './performance.page.scss',
})
export class PerformancePage implements OnInit {
  private readonly api = inject(BusinessApi);
  private readonly injector = inject(Injector);
  month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
  readonly report = signal<PerformanceReport | null>(null);
  readonly loadedAt = signal('');
  readonly print = printReport;
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly tab = signal<'overview' | 'targets' | 'rewards' | 'feedback'>('overview');
  readonly feedbackAgent = signal('all');
  readonly agentReviews = computed(() => (this.report()?.reviews ?? []).filter(review => review.agentId !== null));
  readonly visibleReviews = computed(() => this.agentReviews().filter((review) =>
    this.feedbackAgent() === 'all' || String(review.agentId) === this.feedbackAgent(),
  ));
  readonly editing = signal<PerformanceAgent | null>(null);
  readonly bonusOpen = signal(false);
  salesTarget = 0;
  incentiveAmount = 0;
  bonusAgentId = 0;
  bonusAmount = 0;
  bonusReason = '';
  private bonusKey = '';
  private readonly incentiveKeys = new Map<number, string>();
  private requestNumber = 0;
  readonly topAgents = computed(
    () =>
      this.report()
        ?.agents.filter((a) => a.sales > 0)
        .slice(0, 5) ?? [],
  );
  readonly maximumSales = computed(() =>
    Math.max(...this.topAgents().map((a) => Number(a.sales)), 1),
  );
  readonly maximumDaily = computed(() =>
    Math.max(...(this.report()?.trend.map((d) => Number(d.sales)) ?? []), 1),
  );
  readonly trendPoints = computed(() => {
    const days = this.report()?.trend ?? [];
    return days
      .map(
        (d, i) =>
          `${20 + (i / Math.max(days.length - 1, 1)) * 660},${170 - (Number(d.sales) / this.maximumDaily()) * 140}`,
      )
      .join(' ');
  });
  ngOnInit() {
    this.load();
  }
  load() {
    if (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(this.month)) {
      this.error.set('Choose a month between 2000 and 2100.');
      return;
    }
    const request = ++this.requestNumber;
    this.loading.set(true);
    this.error.set('');
    this.report.set(null);
    this.feedbackAgent.set('all');
    this.editing.set(null);
    this.bonusOpen.set(false);
    this.api.get<PerformanceReport>('performance', { month: this.month }).subscribe({
      next: ({ data }) => {
        if (request === this.requestNumber) {
          this.report.set(data);
          this.loadedAt.set(new Date().toISOString());
          this.loading.set(false);
        }
      },
      error: (e) => {
        if (request === this.requestNumber) {
          this.error.set(e.error?.error?.message ?? 'Unable to load agent performance.');
          this.loading.set(false);
        }
      },
    });
  }
  editTarget(agent: PerformanceAgent) {
    this.editing.set(agent);
    this.salesTarget = Number(agent.salesTarget ?? 0);
    this.incentiveAmount = Number(agent.incentiveAmount ?? 0);
    this.error.set('');
    this.success.set('');
    this.focusEditor();
  }
  saveTarget() {
    const agent = this.editing();
    if (!agent || this.saving()) return;
    this.mutate(
      this.api.put(`performance/targets/${agent.id}/${this.report()!.period}`, {
        salesTarget: this.salesTarget,
        incentiveAmount: this.incentiveAmount,
      }),
      'Monthly target saved.',
    );
  }
  approveIncentive(agent: PerformanceAgent) {
    if (!agent.targetId || this.saving()) return;
    const key = this.incentiveKeys.get(agent.targetId) ?? crypto.randomUUID();
    this.incentiveKeys.set(agent.targetId, key);
    this.mutate(
      this.api.post(`performance/incentives/${agent.targetId}/approve`, { idempotencyKey: key }),
      'Incentive approved and recorded.',
    );
  }
  openBonus() {
    this.bonusKey = crypto.randomUUID();
    this.bonusAgentId =
      this.report()?.agents.find((a) => a.active)?.id ?? this.report()?.agents[0]?.id ?? 0;
    this.bonusAmount = 0;
    this.bonusReason = '';
    this.bonusOpen.set(true);
    this.error.set('');
    this.success.set('');
    this.focusEditor();
  }
  private focusEditor() {
    afterNextRender(
      () => {
        const editor = document.querySelector<HTMLElement>('app-performance-page .editor');
        editor?.scrollIntoView({ block: 'center' });
        editor?.querySelector<HTMLElement>('input,select')?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
  saveBonus() {
    if (this.saving()) return;
    this.mutate(
      this.api.post('performance/bonuses', {
        agentId: this.bonusAgentId,
        period: this.report()!.period,
        amount: this.bonusAmount,
        reason: this.bonusReason,
        idempotencyKey: this.bonusKey,
      }),
      'Bonus approved and recorded.',
    );
  }
  private mutate(request: ReturnType<BusinessApi['post']>, message: string) {
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set(message);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(
          e.error?.error?.message ?? 'Unable to save. Check the details and try again.',
        );
      },
    });
  }
  progressWidth(agent: PerformanceAgent) {
    return Math.min(Number(agent.progress ?? 0), 100);
  }
  exportCsv() {
    const data = this.report();
    if (!data || this.loading() || this.saving()) return;
    const rows = [
      { section: 'Performance summary', ...data.totals },
      ...data.agents.map((row) => ({ section: 'Agents and targets', ...row })),
      ...data.trend.map((row) => ({ section: 'Daily completed sales', ...row })),
      ...data.rewards.map((row) => ({ section: 'Approved rewards (not payouts)', ...row })),
      ...this.agentReviews().map((row) => ({ section: 'Customer feedback', ...row })),
    ];
    downloadCsv(
      `tnl-performance-${data.period}.csv`,
      rows.map((row) => ({
        period: data.period,
        timeZone: data.timeZone,
        currency: 'PHP',
        loadedAt: this.loadedAt(),
        ...row,
      })),
    );
  }
  incentiveLabel(agent: PerformanceAgent) {
    return {
      NONE: 'No incentive set',
      IN_PROGRESS: 'Target in progress',
      ELIGIBLE: 'Ready to approve',
      APPROVED: 'Approved',
    }[agent.incentiveStatus];
  }
}

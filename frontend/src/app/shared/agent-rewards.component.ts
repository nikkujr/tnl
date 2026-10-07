import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { AppFormsModule } from './app-forms.module';
import { RouterLink } from '@angular/router';
import { BusinessApi } from '../core/business-api.service';

interface AgentRewards {
  period: string;
  sales: number;
  target: {
    salesTarget: number;
    incentiveAmount: number;
    progress: number;
    status: 'NONE' | 'IN_PROGRESS' | 'ELIGIBLE' | 'APPROVED';
  } | null;
  totals: { incentives: number; bonuses: number };
  rewards: Array<{
    id: number;
    kind: 'INCENTIVE' | 'BONUS';
    amount: number;
    reason: string;
    approvedBy: string;
    createdAt: string;
  }>;
}

@Component({
  selector: 'app-agent-rewards',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, AppFormsModule, RouterLink],
  templateUrl: './agent-rewards.component.html',
  styleUrl: './agent-rewards.component.scss',
})
export class AgentRewardsComponent {
  private readonly api = inject(BusinessApi);
  readonly agentId = input.required<number>();
  readonly showManagementLink = input(false);
  readonly month = signal(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date()),
  );
  readonly report = signal<AgentRewards | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly refresh = signal(0);
  readonly progressWidth = computed(() =>
    Math.min(100, Math.max(0, this.report()?.target?.progress ?? 0)),
  );

  constructor() {
    effect((onCleanup) => {
      const agentId = this.agentId(),
        month = this.month();
      this.refresh();
      this.loading.set(true);
      this.error.set('');
      this.report.set(null);
      const subscription = this.api
        .get<AgentRewards>(`performance/agents/${agentId}/rewards`, { month })
        .subscribe({
          next: ({ data }) => {
            this.report.set(data);
            this.loading.set(false);
          },
          error: (error) => {
            this.error.set(error.error?.error?.message ?? 'Unable to load incentives and bonuses.');
            this.loading.set(false);
          },
        });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  selectMonth(value: string): void {
    if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value)) this.month.set(value);
  }
  retry(): void {
    this.refresh.update((value) => value + 1);
  }
  targetStatus(status: NonNullable<AgentRewards['target']>['status']): string {
    return {
      NONE: 'No incentive set',
      IN_PROGRESS: 'In progress',
      ELIGIBLE: 'Target reached · awaiting approval',
      APPROVED: 'Incentive approved',
    }[status];
  }
}

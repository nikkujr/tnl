import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApi } from '../../core/business-api.service';
import { EmailPreviewComponent } from './email-preview.component';
import { AppIconComponent, AppIconName } from '../../shared/app-icon.component';

interface WorkflowSetting {
  workflow: string;
  enabled: boolean;
  config: { hours?: number; delayDays?: number; subject?: string; template?: string };
}
interface WorkflowInfo {
  title: string;
  description: string;
  recipient: string;
  group: string;
  icon: AppIconName;
  timing: string;
  delayHelp?: string;
  help?: string;
  link?: string;
  linkLabel?: string;
}
const WORKFLOWS: Record<string, WorkflowInfo> = {
  ORDER_UPDATES: {
    title: 'Order update emails',
    group: 'Orders & inventory',
    icon: 'email',
    description:
      'Keep customers informed when an order is approved, rejected, or moves to a new delivery stage.',
    recipient: 'Customer email',
    timing: 'When an order status changes',
  },
  PENDING_APPROVAL: {
    title: 'Approval reminder',
    group: 'Orders & inventory',
    icon: 'orders',
    description: 'Remind admins about orders still waiting for approval.',
    recipient: 'Admin notification',
    timing: 'After {hours} hours awaiting approval',
    delayHelp: 'Time since the pending order was created.',
  },
  OUTSTANDING_PAYMENT: {
    title: 'Unpaid order reminder',
    group: 'Orders & inventory',
    icon: 'commissions',
    description:
      'Notify the assigned agent and admins when an approved order is not fully paid, including delivered orders.',
    recipient: 'Agent & admin notification',
    timing: 'After {hours} hours from approval',
    delayHelp: 'Time since approval. The order must still have an outstanding payment.',
  },
  STALLED_DELIVERY: {
    title: 'Delivery delay reminder',
    group: 'Orders & inventory',
    icon: 'tracking',
    description: 'Flag approved orders whose delivery has not progressed.',
    recipient: 'Agent & admin notification',
    timing: 'After {hours} hours without progress',
    delayHelp:
      'Time since the last delivery stage change, or approval if delivery has not started.',
  },
  LOW_STOCK: {
    title: 'Low stock alert',
    group: 'Orders & inventory',
    icon: 'inventory',
    description: 'Alert admins when available stock reaches a product’s low stock threshold.',
    recipient: 'Admin notification',
    timing: 'When available stock reaches its threshold',
    help: 'Set a threshold for each product in Inventory. An alert fires once, then becomes ready again after stock recovers.',
    link: '/inventory',
    linkLabel: 'Manage stock thresholds',
  },
  WELCOME: {
    title: 'Welcome email',
    group: 'Customer engagement',
    icon: 'customers',
    description: 'Welcome newly added customers who have agreed to receive marketing emails.',
    recipient: 'Opted-in customer email',
    timing: 'When an opted-in customer is added',
    help: 'Only new live customer records qualify. Imported contacts and customers who have not opted in are excluded.',
  },
  PURCHASE_FOLLOWUP: {
    title: 'Purchase follow-up',
    group: 'Customer engagement',
    icon: 'bell',
    description:
      'Send a thank-you and offer help after the entire order is delivered and fully paid.',
    recipient: 'Opted-in customer email',
    timing: '{delayDays} days after a completed sale',
    delayHelp:
      'The delay starts when both delivery and full payment are complete. Standalone-product orders also qualify.',
    help: 'Customer marketing preferences are checked again before sending.',
  },
  SCHEDULED_CAMPAIGN: {
    title: 'Scheduled campaigns',
    group: 'Customer engagement',
    icon: 'campaigns',
    description: 'Send each campaign once at its chosen date and time to eligible customers.',
    recipient: 'Opted-in customer email',
    timing: 'At the time chosen in Campaigns',
    help: 'Create the message, choose recipients, and set its send time in Campaigns. This switch enables scheduled sends; campaigns already queued continue to be processed.',
    link: '/campaigns',
    linkLabel: 'Open campaigns',
  },
};
const STATES: Record<string, string> = {
  PENDING: 'Waiting',
  PROCESSING: 'Processing',
  ACCEPTED: 'Email accepted',
  SUCCEEDED: 'Completed',
  FAILED: 'Failed',
  UNKNOWN: 'Delivery uncertain',
  SKIPPED: 'Skipped',
};
@Component({
  selector: 'app-automations',
  imports: [FormsModule, DatePipe, RouterLink, AppIconComponent, EmailPreviewComponent],
  templateUrl: './automations.page.html',
  styleUrls: ['../../shared/business.scss', './automations.page.scss'],
})
export class AutomationsPage {
  readonly api = inject(BusinessApi);
  readonly settings = signal<WorkflowSetting[]>([]);
  readonly workers = signal<any[]>([]);
  readonly backlog = signal<any[]>([]);
  readonly runs = signal<any[]>([]);
  readonly legacy = signal<any[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly loading = signal(true);
  readonly runsLoading = signal(true);
  readonly saving = signal('');
  readonly retrying = signal<number | null>(null);
  readonly activeCount = computed(() => this.settings().filter((s) => s.enabled).length);
  readonly queuedCount = computed(() => this.count('PENDING') + this.count('PROCESSING'));
  readonly reviewCount = computed(() => this.count('FAILED') + this.count('UNKNOWN'));
  readonly serviceOnline = computed(() => this.workers().some((w) => this.healthy(w)));
  readonly groups = ['Orders & inventory', 'Customer engagement'];
  tab: 'workflows' | 'activity' | 'previous' = 'workflows';
  draft: WorkflowSetting | null = null;
  editorError = '';
  reviewRun: number | null = null;
  state = '';
  acknowledgeUnknown = false;
  private historyRequest = 0;
  private readonly drafts = new Map<string, WorkflowSetting>();
  constructor() {
    this.load();
  }
  info(workflow: string): WorkflowInfo {
    return (
      WORKFLOWS[workflow] ?? {
        title: this.runTitle(workflow),
        description: 'Review settings for this workflow.',
        recipient: 'Business notification',
        group: 'Orders & inventory',
        icon: 'bell',
        timing: 'When its condition is met',
      }
    );
  }
  groupSettings(group: string) {
    return this.settings()
      .filter((s) => this.info(s.workflow).group === group)
      .sort(
        (a, b) =>
          Object.keys(WORKFLOWS).indexOf(a.workflow) - Object.keys(WORKFLOWS).indexOf(b.workflow),
      );
  }
  timing(s: WorkflowSetting) {
    return this.info(s.workflow)
      .timing.replace('{hours}', String(s.config.hours ?? '—'))
      .replace('{delayDays}', String(s.config.delayDays ?? '—'));
  }
  count(state: string) {
    return Number(this.backlog().find((b) => b.state === state)?.count ?? 0);
  }
  runTitle(workflow: string) {
    return (
      WORKFLOWS[workflow]?.title ??
      {
        CAMPAIGN_SEND: 'Campaign email',
        ACCOUNT_EMAIL: 'Account email',
        FOLLOWUP_REPLY: 'Agent reply email',
      }[workflow] ??
      workflow.toLowerCase().replaceAll('_', ' ')
    );
  }
  stateLabel(state: string) {
    return STATES[state] ?? state;
  }
  outcome(r: any) {
    if (r.state === 'ACCEPTED')
      return 'The mail service accepted this email. Inbox delivery is not confirmed.';
    if (r.state === 'SUCCEEDED') return 'The notification was created successfully.';
    if (r.state === 'UNKNOWN') return 'An email may have been sent. Review before trying again.';
    if (r.state === 'FAILED')
      return /SMTP.*(?:not configured|configured)/i.test(r.lastError ?? '')
        ? 'Email sending is not configured. Ask your administrator to check email settings, then retry.'
        : 'This action could not be completed. Review the details before retrying.';
    if (r.state === 'PENDING')
      return r.attempts
        ? 'Waiting for the next automatic retry.'
        : 'Waiting for its scheduled time or the automation service.';
    if (r.state === 'PROCESSING') return 'The automation service is handling this action.';
    const reasons: Record<string, string> = {
      'Workflow disabled': 'This workflow was turned off before the action ran.',
      'Condition resolved': 'The order changed; this reminder is no longer needed.',
      'Payment episode resolved': 'This unpaid reminder is no longer needed.',
      'Stock recovered': 'Stock recovered; no alert was needed.',
      'Stock episode resolved': 'This stock alert is no longer needed.',
      'Recipient ineligible': 'The recipient no longer qualifies for this email.',
      'Account link expired or already used': 'The account link expired or was already used.',
      'Order removed': 'The order was removed before this action ran.',
    };
    return reasons[r.result?.reason] ?? 'The action was no longer needed.';
  }
  showActivity(reviewOnly = false) {
    this.tab = 'activity';
    if (reviewOnly) {
      this.state = 'REVIEW';
      this.loadRuns();
    }
  }
  loadRuns() {
    const request = ++this.historyRequest;
    this.runsLoading.set(true);
    this.reviewRun = null;
    this.acknowledgeUnknown = false;
    const states = this.state === 'REVIEW' ? ['FAILED', 'UNKNOWN'] : [this.state];
    const rows: any[] = [];
    let remaining = states.length;
    let failed = false;
    for (const state of states) {
      this.api.get<any[]>('automations/runs', state ? { state } : {}).subscribe({
        next: (r) => {
          if (request !== this.historyRequest || failed) return;
          rows.push(...r.data);
          if (--remaining === 0) {
            this.runs.set(rows.sort((a, b) => b.id - a.id));
            this.runsLoading.set(false);
          }
        },
        error: (e) => {
          if (request === this.historyRequest) {
            failed = true;
            this.runs.set([]);
            this.runsLoading.set(false);
            this.fail(e);
          }
        },
      });
    }
  }
  load() {
    this.error.set('');
    this.loading.set(true);
    this.api.get('automations').subscribe({
      next: (r) => {
        this.settings.set(r.data.settings);
        this.workers.set(r.data.workers);
        this.backlog.set(r.data.backlog);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.fail(e);
      },
    });
    this.loadRuns();
    this.api
      .get<any[]>('automations/legacy-review')
      .subscribe({ next: (r) => this.legacy.set(r.data), error: (e) => this.fail(e) });
  }
  edit(s: WorkflowSetting) {
    this.editorError = '';
    if (this.draft?.workflow === s.workflow) {
      this.draft = null;
      return;
    }
    const draft = this.drafts.get(s.workflow) ?? { ...s, config: { ...s.config } };
    this.drafts.set(s.workflow, draft);
    this.draft = draft;
  }
  cancelEdit() {
    if (this.draft) this.drafts.delete(this.draft.workflow);
    this.draft = null;
    this.editorError = '';
  }
  toggle(s: WorkflowSetting) {
    if (this.saving()) return;
    this.saving.set(s.workflow);
    this.error.set('');
    this.api.put(`automations/${s.workflow}`, { enabled: !s.enabled, config: s.config }).subscribe({
      next: () => {
        this.settings.update((rows) =>
          rows.map((row) => (row.workflow === s.workflow ? { ...row, enabled: !s.enabled } : row)),
        );
        this.saving.set('');
        this.notice.set(`${this.info(s.workflow).title} turned ${s.enabled ? 'off' : 'on'}.`);
      },
      error: (e) => {
        this.saving.set('');
        this.fail(e);
      },
    });
  }
  save() {
    if (!this.draft || this.saving()) return;
    const s = this.draft;
    const enabled =
      this.settings().find((row) => row.workflow === s.workflow)?.enabled ?? s.enabled;
    this.editorError = '';
    this.saving.set(s.workflow);
    this.api.put(`automations/${s.workflow}`, { enabled, config: s.config }).subscribe({
      next: () => {
        this.settings.update((rows) =>
          rows.map((row) =>
            row.workflow === s.workflow ? { ...row, config: { ...s.config } } : row,
          ),
        );
        this.saving.set('');
        this.cancelEdit();
        this.notice.set(`${this.info(s.workflow).title} settings saved.`);
      },
      error: (e) => {
        this.saving.set('');
        this.editorError =
          e.error?.error?.message ?? 'Settings could not be saved. Please try again.';
      },
    });
  }
  tokens(workflow: string) {
    const tokens = [{ key: 'customerName', label: 'Customer name' }];
    if (workflow !== 'WELCOME') tokens.push({ key: 'trackingNumber', label: 'Order number' });
    if (workflow === 'ORDER_UPDATES') tokens.push({ key: 'status', label: 'Order status' });
    return tokens;
  }
  insertToken(key: string) {
    if (this.draft) this.draft.config.template = `${this.draft.config.template ?? ''} {{${key}}}`;
  }
  preview(value?: string) {
    const examples: Record<string, string> = {
      customerName: 'Maria Santos',
      trackingNumber: 'TNL-1042',
      status: 'IN_TRANSIT',
    };
    return (value ?? '').replace(/\{\{(\w+)\}\}/g, (token, key) => examples[key] ?? token);
  }
  review(r: any) {
    this.reviewRun = this.reviewRun === r.id ? null : r.id;
    this.acknowledgeUnknown = false;
  }
  retry(r: any) {
    if (
      this.retrying() ||
      (r.state === 'UNKNOWN' && (this.reviewRun !== r.id || !this.acknowledgeUnknown))
    )
      return;
    this.retrying.set(r.id);
    this.error.set('');
    this.api
      .post(`automations/runs/${r.id}/retry`, {
        acknowledgeDuplicateRisk: r.state === 'UNKNOWN' && this.acknowledgeUnknown,
      })
      .subscribe({
        next: () => {
          this.retrying.set(null);
          this.notice.set('The action is queued to try again. Check Activity for its result.');
          this.load();
        },
        error: (e) => {
          this.retrying.set(null);
          this.fail(e);
        },
      });
  }
  healthy(w: any) {
    return Date.now() - new Date(w.lastSeenAt).getTime() < 180000;
  }
  private fail(e: any) {
    this.error.set(e.error?.error?.message ?? 'Cannot load automation data.');
  }
}

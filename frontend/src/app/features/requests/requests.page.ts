import { Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BusinessApi } from '../../core/business-api.service';
import { SessionService } from '../../core/session.service';
@Component({
  selector: 'app-requests',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './requests.page.html',
  styleUrl: '../../shared/business.scss',
})
export class RequestsPage {
  readonly api = inject(BusinessApi);
  readonly router = inject(Router);
  readonly session = inject(SessionService).session;
  readonly requests = signal<any[]>([]);
  readonly followups = signal<any[]>([]);
  readonly agents = signal<any[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal(false);
  assignments: Record<number, number> = {};
  replies: Record<number, string> = {};
  reasons: Record<number, string> = {};
  inviteId = 0;
  constructor() {
    this.load();
  }
  load() {
    this.api
      .get<any[]>('requests')
      .subscribe({ next: (r) => this.requests.set(r.data), error: (e) => this.fail(e) });
    this.api
      .get<any[]>('requests/followups/open')
      .subscribe({ next: (r) => this.followups.set(r.data), error: (e) => this.fail(e) });
    if (this.session()?.role === 'ADMIN')
      this.api
        .get<any[]>('agents', { activeOnly: 'true' })
        .subscribe({ next: (r) => this.agents.set(r.data), error: (e) => this.fail(e) });
  }
  total(r: any) {
    return (
      r.snapshot.items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0) +
      r.snapshot.packages.reduce((s: number, p: any) => s + p.quantity * p.sellingPrice, 0)
    );
  }
  assign(id: number) {
    this.action(
      this.api.patch(`requests/${id}/assignment`, { agentId: this.assignments[id] }),
      'Request assigned.',
    );
  }
  convert(id: number) {
    this.busy.set(true);
    this.api.post(`requests/${id}/convert`).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.router.navigateByUrl(`/orders/${r.data.id}`);
      },
      error: (e) => {
        this.busy.set(false);
        this.fail(e);
      },
    });
  }
  decline(id: number) {
    this.action(
      this.api.post(`requests/${id}/decline`, { reason: this.reasons[id] ?? '' }),
      'Request declined.',
    );
  }
  reply(id: number) {
    this.action(
      this.api.post(`requests/followups/${id}/reply`, { reply: this.replies[id] ?? '' }),
      'Reply saved; customer email queued.',
    );
  }
  invite() {
    this.action(
      this.api.post('customer-auth/invite', { customerId: Number(this.inviteId) }),
      'Invitation queued for an eligible customer.',
    );
  }
  private action(request: ReturnType<BusinessApi['post']>, message: string) {
    this.busy.set(true);
    this.error.set('');
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set(message);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.fail(e);
      },
    });
  }
  private fail(e: any) {
    this.error.set(e.error?.error?.message ?? 'Unable to load or update the queue.');
  }
}

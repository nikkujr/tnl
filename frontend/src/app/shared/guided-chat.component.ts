import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  Output,
  ViewChild,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AppFormsModule } from './app-forms.module';
import { Router } from '@angular/router';
import { BusinessApi, CatalogOffer } from '../core/business-api.service';
import { SessionService } from '../core/session.service';
import { AppIconComponent, AppIconName } from './app-icon.component';
let nextAssistantId = 0;
@Component({
  selector: 'app-guided-chat',
  imports: [AppFormsModule, CurrencyPipe, DatePipe, AppIconComponent],
  templateUrl: './guided-chat.component.html',
  styleUrls: ['./business.scss', './guided-chat.component.scss'],
})
export class GuidedChatComponent {
  @ViewChild('launcher') private launcher?: ElementRef<HTMLButtonElement>;
  @ViewChild('chatPanel') private panel?: ElementRef<HTMLElement>;
  @Output() offerSelected = new EventEmitter<CatalogOffer>();
  private readonly injector = inject(Injector);
  readonly popupId = `tnl-assistant-${++nextAssistantId}`;
  readonly api = inject(BusinessApi);
  readonly session = inject(SessionService).session;
  readonly router = inject(Router);
  readonly open = signal(false);
  readonly topic = signal('');
  readonly offers = signal<CatalogOffer[]>([]);
  readonly orders = signal<any[]>([]);
  readonly categories = signal<any[]>([]);
  readonly result = signal<any>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal(false);
  readonly topics: { id: string; label: string; description: string; icon: AppIconName }[] = [
    {
      id: 'catalog',
      label: 'Products and packages',
      description: 'Explore the current catalog',
      icon: 'catalog',
    },
    {
      id: 'recommend',
      label: 'Recommend an offer',
      description: 'Find options within your budget',
      icon: 'packageSearch',
    },
    {
      id: 'track',
      label: 'Track an order',
      description: 'Check a tracking number',
      icon: 'tracking',
    },
    {
      id: 'orders',
      label: 'My orders',
      description: 'View your orders and their status',
      icon: 'orders',
    },
    {
      id: 'request',
      label: 'Request an order',
      description: 'Choose an offer for your agent',
      icon: 'plus',
    },
    {
      id: 'followup',
      label: 'Ask my agent for an update',
      description: 'Send an order follow-up request',
      icon: 'bell',
    },
  ];
  search = '';
  budget = 10000;
  categoryId = 0;
  trackingNumber = '';
  orderId = 0;
  message = 'Please provide an update on my order.';
  constructor() {
    this.api
      .get<any[]>('catalog/categories')
      .subscribe({ next: (r) => this.categories.set(r.data), error: () => {} });
  }
  toggle() {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    afterNextRender(() => this.panel?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }
  close() {
    this.open.set(false);
    this.launcher?.nativeElement.focus({ preventScroll: true });
  }
  @HostListener('keydown.escape', ['$event'])
  onEscape(event: Event) {
    if (!this.open()) return;
    event.stopPropagation();
    this.close();
  }
  choose(topic: string) {
    this.topic.set(topic);
    this.error.set('');
    this.notice.set('');
    this.result.set(null);
    this.offers.set([]);
    if (['orders', 'followup', 'request'].includes(topic) && this.session()?.role !== 'CUSTOMER') {
      this.notice.set('Sign in or register to use personal order actions.');
      return;
    }
    if (topic === 'catalog' || topic === 'request') this.browse();
    if (topic === 'orders' || topic === 'followup')
      this.api.get<any[]>('customer/orders').subscribe({
        next: (r) => {
          this.orders.set(r.data);
          this.orderId = r.data[0]?.id ?? 0;
          if (topic === 'followup' && this.orderId) this.viewOrder(this.orderId);
        },
        error: (e) => this.fail(e),
      });
  }
  browse() {
    this.busy.set(true);
    this.api.get<CatalogOffer[]>('catalog', { search: this.search }).subscribe({
      next: (r) => {
        this.offers.set(r.data);
        this.busy.set(false);
      },
      error: (e) => this.fail(e),
    });
  }
  recommend() {
    this.busy.set(true);
    this.api
      .get<CatalogOffer[]>('catalog/recommendations', {
        budget: this.budget,
        ...(this.categoryId ? { categoryId: this.categoryId } : {}),
      })
      .subscribe({
        next: (r) => {
          this.offers.set(r.data);
          this.busy.set(false);
          if (!r.data.length)
            this.notice.set(
              'No available offers match that category and budget. Try another category or budget.',
            );
        },
        error: (e) => this.fail(e),
      });
  }
  track() {
    this.busy.set(true);
    this.api.get('tracking/' + encodeURIComponent(this.trackingNumber.trim())).subscribe({
      next: (r) => {
        this.result.set(r.data);
        this.busy.set(false);
      },
      error: (e) => this.fail(e),
    });
  }
  select(offer: CatalogOffer) {
    if (this.session()?.role !== 'CUSTOMER') {
      this.router.navigate(['/portal'], {
        queryParams: { offerKind: offer.kind, offerId: offer.id },
      });
      return;
    }
    this.offerSelected.emit(offer);
    this.notice.set(`${offer.name} selected. Review your request before submitting.`);
  }
  viewOrder(id: number) {
    this.api
      .get('customer/orders/' + id)
      .subscribe({ next: (r) => this.result.set(r.data), error: (e) => this.fail(e) });
  }
  followup() {
    this.busy.set(true);
    this.api
      .post(`customer/orders/${this.orderId}/followups`, { message: this.message })
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          this.notice.set(
            r.data.reused
              ? 'Your existing update request is still open.'
              : 'Your agent has been notified. Their reply will appear in your order details.',
          );
        },
        error: (e) => this.fail(e),
      });
  }
  private fail(e: any) {
    this.busy.set(false);
    this.error.set(e.error?.error?.message ?? 'Unable to load the requested information.');
  }
}

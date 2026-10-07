import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { BusinessApi } from '../../core/business-api.service';
import { SessionService } from '../../core/session.service';
import { DeliveryPanelComponent } from '../delivery/delivery-panel.component';

@Component({
  selector: 'app-customer-order-detail',
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink, DeliveryPanelComponent],
  templateUrl: './customer-order-detail.page.html',
  styleUrls: ['../../shared/business.scss', './portal.page.scss'],
})
export class CustomerOrderDetailPage {
  readonly api = inject(BusinessApi);
  readonly session = inject(SessionService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly detail = signal<any>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly loading = signal(false);
  readonly reviewSaving = signal(false);
  readonly reviewError = signal('');
  readonly reviewNotice = signal('');
  readonly ratingChoices = [1, 2, 3, 4, 5];
  readonly ratingDescriptions = ['Select a rating', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  orderRating = 0;
  orderReview = '';
  followupMessage = 'Please provide an update on my order.';
  private request?: Subscription;
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.detail.set(null);
      this.orderRating = 0;
      this.orderReview = '';
      this.reviewError.set('');
      this.reviewNotice.set('');
      this.notice.set('');
      window.scrollTo(0, 0);
      this.load();
    });
  }
  load() {
    this.request?.unsubscribe();
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isSafeInteger(id) || id < 1) { this.error.set('Order not found.'); return; }
    this.loading.set(!this.detail());
    this.error.set('');
    this.request = this.api.get('customer/orders/' + id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => { this.detail.set(r.data); this.loading.set(false); },
      error: e => { this.loading.set(false); this.fail(e); },
    });
  }
  followup() {
    const order = this.detail();
    if (!order) return;
    this.api
      .post(`customer/orders/${order.id}/followups`, { message: this.followupMessage })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.notice.set(
            r.data.reused ? 'An update request is already open.' : 'Your agent has been notified.',
          );
          this.load();
        },
        error: (e) => this.fail(e),
      });
  }
  submitReview() {
    const order = this.detail();
    if (!order?.canReview || this.reviewSaving() || this.orderRating < 1 || this.orderReview.trim().length < 2) return;
    this.reviewSaving.set(true);
    this.reviewError.set('');
    this.reviewNotice.set('');
    this.api.post(`customer/orders/${order.id}/review`, { rating: this.orderRating, review: this.orderReview.trim() }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        this.reviewSaving.set(false);
        if (this.detail()?.id !== order.id) return;
        this.detail.update((current) => ({ ...current, review: r.data, canReview: false }));
        this.reviewNotice.set('Thank you. Your review has been submitted.');
      },
      error: (e) => {
        this.reviewSaving.set(false);
        if (e.status === 401) this.fail(e);
        else if (this.detail()?.id === order.id) this.reviewError.set(e.error?.error?.message ?? 'Unable to submit your review. Please try again.');
      },
    });
  }

  private fail(e: any) {
    if (e.status === 401) { this.session.logout(); void this.router.navigateByUrl('/portal'); }
    if ([401, 403, 404].includes(e.status)) this.detail.set(null);
    this.error.set(e.error?.error?.message ?? 'Unable to load this order. Please try again.');
  }
}

import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, TrackingResult } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { DeliverySlaComponent } from '../delivery/delivery-sla.component';

@Component({
  selector: 'app-tracking-page',
  imports: [DatePipe, FormsModule, BreadcrumbComponent, DeliverySlaComponent],
  templateUrl: './tracking.page.html',
  styleUrl: './tracking.page.scss'
})
export class TrackingPage {
  private readonly api = inject(ApiService);
  readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly result = signal<TrackingResult | null>(null);
  trackingNumber = '';

  track(): void {
    const value = this.trackingNumber.trim().toUpperCase();
    if (!value) return;
    this.loading.set(true);
    this.toast.dismissError();
    this.api.track(value).subscribe({
      next: ({ data }) => { this.result.set(data); this.trackingNumber = data.trackingNumber; this.loading.set(false); },
      error: (error) => { this.result.set(null); this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Tracking number not found.'); }
    });
  }

  statusClass(status: string): string { return status.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-'); }
  titleCase(value: string | null): string { return value ? value.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') : 'Not started'; }
}

import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { DeliveryApi, DeliveryJob } from './delivery-api.service';
import { DeliveryPanelComponent } from './delivery-panel.component';
import { DeliveryMapComponent, MapPoint } from './delivery-map.component';
import { DatePipe } from '@angular/common';
import { DeliverySlaComponent } from './delivery-sla.component';
@Component({
  selector: 'app-delivery-page',
  imports: [RouterLink, DeliveryPanelComponent, DeliveryMapComponent, DatePipe, DeliverySlaComponent],
  styleUrl: './delivery.scss',
  template: ` <header class="delivery-heading">
      <span class="eyebrow">TNL Track</span>
      <h2>{{ admin ? 'Dispatch and deliveries' : 'My deliveries' }}</h2>
      <p>
        {{
          admin
            ? 'Assign orders, resolve delivery issues, and monitor active handoffs.'
            : 'Start one assigned job, keep its customer updated, and record the handoff.'
        }}
      </p>
    </header>
    @if (orderId) {
      <p><a routerLink="/delivery">← All deliveries</a></p>
      <app-delivery-panel [orderId]="orderId" />
    } @else {
      @if (error()) {
        <p class="error" role="alert">{{ error() }} <button (click)="load()">Retry</button></p>
      }
      @if (admin) {
        <app-delivery-map [points]="points()" [follow]="false" />
      }
      <nav class="filter-bar" aria-label="Delivery filters">
        @for (t of tabs; track t) {
          <button [class.active]="filter() === t" (click)="filter.set(t)">{{ t }}</button>
        }
        <button (click)="load()" [disabled]="loading()">Refresh</button>
      </nav>
      @if (loading() && !jobs().length) {
        <p role="status">Loading deliveries…</p>
      }
      <div class="job-grid">
        @for (j of visible(); track j.id) {
          <article class="delivery-card">
            <span class="job-status"
              >{{ j.attemptId ? 'ACTIVE · ' : '' }}{{ j.deliveryStatus }}</span
            >
            <h3>{{ j.trackingNumber }}</h3>
            <p>{{ j.recipientName }}</p>
            <p>{{ j.address }}</p>
            <app-delivery-sla [sla]="j.sla" [compact]="true" />
            @if (j.deliveryStatus !== 'DELIVERED') {
              <p>Estimated arrival: {{ j.estimatedDeliveryAt ? (j.estimatedDeliveryAt | date: 'MMM d, h:mm a' : '+0800') + ' (Philippine time)' : 'Awaiting schedule' }}</p>
            }
            @if (admin) {
              <p>Employee: {{ j.employeeName || 'Unassigned' }}</p>
            }
            @if (j.issueCount) {
              <p class="error">{{ j.issueCount }} unresolved issue(s)</p>
            }
            @if (j.tracking?.position) {
              <small>{{ j.tracking!.state }} · {{ j.tracking!.position!.observedAt }}</small>
            }
            <p>
              <a [routerLink]="admin ? '/orders/' + j.id : '/delivery/' + j.id">{{
                admin
                  ? j.deliveryStatus === 'DELIVERED'
                    ? 'View proof of delivery'
                    : 'Open order and dispatch'
                  : 'Open delivery'
              }}</a>
            </p>
          </article>
        } @empty {
          <p class="muted">No deliveries in this view.</p>
        }
      </div>
      <div class="actions">
        <button [disabled]="page === 1 || loading()" (click)="page = page - 1; load()">
          Previous</button
        ><span>Page {{ page }}</span
        ><button [disabled]="jobs().length < 100 || loading()" (click)="page = page + 1; load()">
          Next
        </button>
      </div>
    }`,
})
export class DeliveryPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DeliveryApi);
  readonly admin = this.route.snapshot.data['admin'] === true;
  orderId = 0;
  page = 1;
  readonly jobs = signal<DeliveryJob[]>([]);
  readonly filter = signal('All');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly tabs = this.admin
    ? ['All', 'Unassigned', 'Active', 'Overdue', 'Delivered late', 'Issues', 'Completed']
    : ['All', 'Active', 'Queued', 'Overdue', 'Delivered late', 'Issues', 'Completed'];
  readonly visible = computed(() =>
    this.jobs().filter(
      (j) =>
        this.filter() === 'All' ||
        (this.filter() === 'Unassigned' && !j.employeeId && j.deliveryStatus !== 'DELIVERED') ||
        (this.filter() === 'Active' && j.attemptId) ||
        (this.filter() === 'Queued' &&
          !j.attemptId &&
          !j.issueCount &&
          j.deliveryStatus !== 'DELIVERED') ||
        (this.filter() === 'Issues' && j.issueCount > 0) ||
        (this.filter() === 'Overdue' && j.sla?.state === 'OVERDUE') ||
        (this.filter() === 'Delivered late' && j.sla?.state === 'BREACHED') ||
        (this.filter() === 'Completed' && j.deliveryStatus === 'DELIVERED'),
    ),
  );
  readonly points = computed(
    () =>
      this.jobs().flatMap((j) =>
        j.tracking?.position && ['LIVE', 'STALE'].includes(j.tracking.state)
          ? [
              {
                ...j.tracking.position,
                label: `${j.employeeName} · ${j.trackingNumber} · ${j.tracking.state.toLowerCase()}`,
                kind: 'employee' as const,
              },
            ]
          : [],
      ) as MapPoint[],
  );
  private request?: Subscription;
  private params?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private refreshVisible = () => {
    if (!this.orderId && document.visibilityState === 'visible') this.load();
  };
  ngOnInit() {
    this.params = this.route.paramMap.subscribe((p) => {
      this.orderId = Number(p.get('id'));
      if (!this.orderId) this.load();
    });
    this.timer = setInterval(this.refreshVisible, 10000);
    document.addEventListener('visibilitychange', this.refreshVisible);
    window.addEventListener('online', this.refreshVisible);
  }
  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.request = this.api
      .get<DeliveryJob[]>(`delivery/${this.admin ? 'dispatch' : 'orders'}?page=${this.page}`)
      .subscribe({
        next: (r) => {
          this.jobs.set(r.data);
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(
            e.error?.error?.message ?? 'Unable to load deliveries. Check connectivity and retry.',
          );
          this.loading.set(false);
          this.jobs.update((j) => j.map((x) => ({ ...x, tracking: undefined })));
        },
      });
  }
  ngOnDestroy() {
    this.request?.unsubscribe();
    this.params?.unsubscribe();
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.refreshVisible);
    window.removeEventListener('online', this.refreshVisible);
  }
}

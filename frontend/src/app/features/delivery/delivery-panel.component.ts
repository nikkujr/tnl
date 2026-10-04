import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, firstValueFrom, timeout } from 'rxjs';
import { SessionService } from '../../core/session.service';
import {
  DeliveryApi,
  DeliveryDetail,
  DeliveryEmployee,
  DeliveryTracking,
  Coordinate,
} from './delivery-api.service';
import { DeliveryMapComponent, MapPoint } from './delivery-map.component';
@Component({
  selector: 'app-delivery-panel',
  imports: [DatePipe, TitleCasePipe, FormsModule, DeliveryMapComponent],
  templateUrl: './delivery-panel.component.html',
  styleUrl: './delivery.scss',
})
export class DeliveryPanelComponent implements OnChanges, OnDestroy {
  readonly unresolved = (issue: { resolvedAt: string | null }) => !issue.resolvedAt;
  readonly isDestination = (point: MapPoint) => point.kind === 'destination';
  @Input({ required: true }) orderId = 0;
  @Input() customer = false;
  @Output() changed = new EventEmitter<void>();
  readonly api = inject(DeliveryApi);
  readonly session = inject(SessionService).session;
  readonly detail = signal<DeliveryDetail | null>(null);
  readonly track = signal<DeliveryTracking | null>(null);
  readonly error = signal('');
  readonly gpsError = signal('');
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly employees = signal<DeliveryEmployee[]>([]);
  readonly photoUrl = signal('');
  readonly preview = signal('');
  readonly sharing = signal(false);
  readonly draftDestination = signal<Coordinate | null>(null);
  readonly clock = signal(Date.now());
  readonly isEmployee = computed(() => this.session()?.role === 'DELIVERY');
  readonly isAdmin = computed(() => this.session()?.role === 'ADMIN');
  private offset = 0;
  private generation = 0;
  private alive = true;
  private sessionId = '';
  private sequence = 0;
  private gpsGeneration = 0;
  private gpsTimer?: ReturnType<typeof setTimeout>;
  private samplerBusy = false;
  private subscriptions: Subscription[] = [];
  private pollTimer = setInterval(() => {
    this.clock.set(Date.now());
    if (
      document.visibilityState === 'visible' &&
      this.orderId &&
      Date.now() - this.lastPoll >= 10000
    )
      this.poll();
  }, 1000);
  private lastPoll = 0;
  private polling = false;
  employeeId: number | null = null;
  latitude: number | null = null;
  longitude: number | null = null;
  recipientName = '';
  exceptionReason = '';
  issueText = '';
  resolution = '';
  file?: File;
  private uploadedPhotoId = '';
  private loadedPhotoOrder = 0;
  readonly state = computed(() => {
    const t = this.track();
    if (!t) return 'UNAVAILABLE';
    const p = t.position;
    if (!p) return t.state;
    const age = Math.max(
      this.clock() + this.offset - new Date(p.observedAt).getTime(),
      this.clock() + this.offset - new Date(p.receivedAt).getTime(),
    );
    return age > 600000 ? 'UNAVAILABLE' : age > 60000 ? 'STALE' : t.state;
  });
  readonly points = computed(() => {
    const t = this.track(),
      points: MapPoint[] = [];
    const destination =
      this.draftDestination() ?? (t ? t.destination : this.detail()?.tracking.destination);
    if (destination)
      points.push({
        ...destination,
        label: this.draftDestination() ? 'Unsaved destination' : 'Delivery destination',
        kind: 'destination',
      });
    if (t?.position && ['LIVE', 'STALE'].includes(this.state()))
      points.push({
        ...t.position,
        label: `${t.employeeName ?? 'Delivery employee'} · ${this.state().toLowerCase()}`,
        kind: 'employee',
      });
    return points;
  });
  private visibility = () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(this.gpsTimer);
      this.gpsGeneration++;
    } else {
      this.poll();
      if (this.sharing()) this.sample();
    }
  };
  private reconnect = () => {
    this.poll();
    if (this.sharing()) this.sample();
  };
  constructor() {
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('online', this.reconnect);
  }
  ngOnChanges() {
    this.generation++;
    this.stopLocal();
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions = [];
    this.polling = false;
    this.detail.set(null);
    this.track.set(null);
    this.draftDestination.set(null);
    this.error.set('');
    this.notice.set('');
    this.clearPhoto();
    this.clearDraft();
    this.loadedPhotoOrder = 0;
    this.refresh();
    if (this.isAdmin())
      this.watch(
        this.api.get<DeliveryEmployee[]>('delivery-employees').subscribe({
          next: (r) => this.employees.set(r.data.filter((e) => e.active)),
          error: (e) => this.fail(e),
        }),
      );
  }
  private watch(s: Subscription) {
    this.subscriptions.push(s);
    s.add(() => {
      this.subscriptions = this.subscriptions.filter((x) => x !== s);
    });
  }
  private base() {
    return this.customer ? `customer/orders/${this.orderId}` : `delivery/orders/${this.orderId}`;
  }
  refresh() {
    const gen = this.generation;
    this.watch(
      this.api
        .get<DeliveryDetail>(this.customer ? `${this.base()}/delivery` : this.base())
        .subscribe({
          next: (r) => {
            if (gen !== this.generation) return;
            this.detail.set(r.data);
            this.setTracking(r.data.tracking);
            this.employeeId = r.data.employeeId ?? null;
            if (!this.draftDestination()) this.resetPin();
            if (
              r.data.completion?.photoState === 'AVAILABLE' &&
              this.loadedPhotoOrder !== this.orderId
            ) {
              this.loadedPhotoOrder = this.orderId;
              this.loadPhoto();
            }
            if (!r.data.attemptId || r.data.deliveryStatus === 'DELIVERED') this.stopLocal();
          },
          error: (e) => {
            if (gen === this.generation) {
              this.fail(e);
              if ([401, 403, 404].includes(e.status)) {
                this.detail.set(null);
                this.track.set(null);
                this.clearPhoto();
                this.clearDraft();
                this.stopLocal();
              }
            }
          },
        }),
    );
    this.lastPoll = Date.now();
  }
  poll() {
    if (this.polling || !this.alive || document.visibilityState !== 'visible') return;
    const gen = this.generation;
    this.polling = true;
    this.lastPoll = Date.now();
    this.watch(
      this.api
        .get<DeliveryTracking>(`${this.base()}/${this.customer ? 'delivery-tracking' : 'tracking'}`)
        .subscribe({
          next: (r) => {
            if (gen !== this.generation) return;
            this.polling = false;
            this.setTracking(r.data);
            if (this.detail() && r.data.deliveryStatus !== this.detail()!.deliveryStatus) {
              this.refresh();
              this.changed.emit();
            }
          },
          error: (e) => {
            if (gen !== this.generation) return;
            this.polling = false;
            this.error.set(
              'Live updates unavailable. The last position keeps its original timestamp.',
            );
            if (e.status === 401 || e.status === 403 || e.status === 404) {
              this.detail.set(null);
              this.track.set(null);
              this.clearPhoto();
              this.stopLocal();
            }
          },
        }),
    );
  }
  private setTracking(t: DeliveryTracking) {
    this.offset = new Date(t.serverTime).getTime() - Date.now();
    this.track.set(t);
    this.clock.set(Date.now());
  }
  private fence() {
    return {
      assignmentVersion: this.detail()!.assignmentVersion,
      ...(this.detail()!.attemptId ? { attemptId: this.detail()!.attemptId } : {}),
    };
  }
  private async act(work: () => Promise<unknown>, message: string) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await work();
      if (!this.alive) return;
      this.notice.set(message);
      this.refresh();
      this.changed.emit();
    } catch (e) {
      if (this.alive) {
        this.fail(e);
        this.refresh();
      }
    } finally {
      if (this.alive) this.busy.set(false);
    }
  }
  start() {
    void this.act(async () => {
      await firstValueFrom(
        this.api.post(`${this.base()}/start`, {
          assignmentVersion: this.detail()!.assignmentVersion,
        }),
      );
    }, 'Delivery started. You can enable live location sharing.');
  }
  pause() {
    void this.act(async () => {
      await firstValueFrom(this.api.post(`${this.base()}/pause`, this.fence()));
      this.stopLocal();
    }, 'Delivery paused. Reserved stock is unchanged.');
  }
  advance(status: string) {
    void this.act(async () => {
      await firstValueFrom(
        this.isAdmin()
          ? this.api.patch(`orders/${this.orderId}/delivery-status`, {
              assignmentVersion: this.detail()!.assignmentVersion,
              deliveryStatus: status,
            })
          : this.api.patch(`${this.base()}/status`, { ...this.fence(), deliveryStatus: status }),
      );
    }, 'Delivery milestone saved.');
  }
  report() {
    void this.act(async () => {
      await firstValueFrom(
        this.api.post(`${this.base()}/issues`, { ...this.fence(), explanation: this.issueText }),
      );
      this.stopLocal();
      this.issueText = '';
    }, 'Issue sent to the admin. Another attempt needs their resolution.');
  }
  assign() {
    void this.act(async () => {
      await firstValueFrom(
        this.api.patch(`orders/${this.orderId}/delivery-assignment`, {
          employeeId: this.employeeId,
          assignmentVersion: this.detail()!.assignmentVersion,
        }),
      );
    }, 'Dispatch assignment saved.');
  }
  pin(p: Coordinate) {
    this.latitude = p.latitude;
    this.longitude = p.longitude;
    this.draftDestination.set(p);
  }
  pinValid() {
    return (
      this.latitude !== null &&
      this.longitude !== null &&
      Number.isFinite(this.latitude) &&
      Number.isFinite(this.longitude) &&
      Math.abs(this.latitude) <= 90 &&
      Math.abs(this.longitude) <= 180
    );
  }
  editCoordinates() {
    if (this.pinValid()) this.pin({ latitude: this.latitude!, longitude: this.longitude! });
  }
  resetPin() {
    this.draftDestination.set(null);
    this.latitude = this.track()?.destination?.latitude ?? null;
    this.longitude = this.track()?.destination?.longitude ?? null;
  }
  showCompletion() {
    const form = document.getElementById(`delivery-completion-${this.orderId}`);
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form?.querySelector('input')?.focus({ preventScroll: true });
  }
  showProof() {
    const proof = document.getElementById(`delivery-proof-${this.orderId}`);
    proof?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    proof?.focus({ preventScroll: true });
  }
  savePin(clear = false) {
    if (!clear && !this.pinValid()) return;
    void this.act(
      async () => {
        await firstValueFrom(
          this.api.patch(`orders/${this.orderId}/delivery-destination`, {
            latitude: clear ? null : this.latitude,
            longitude: clear ? null : this.longitude,
            assignmentVersion: this.detail()!.assignmentVersion,
          }),
        );
        this.draftDestination.set(null);
      },
      clear ? 'Destination pin cleared.' : 'Destination pin saved.',
    );
  }
  resolve(issueId: number) {
    void this.act(async () => {
      await firstValueFrom(
        this.api.post(`orders/${this.orderId}/delivery-issues/${issueId}/resolve`, {
          resolution: this.resolution,
        }),
      );
      this.resolution = '';
    }, 'Delivery issue resolved.');
  }
  choosePhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    this.clearDraft();
    const file = input.files?.[0];
    if (!file) return;
    if (
      file.size > 10 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      this.error.set('Choose a JPEG, PNG or WebP photo up to 10 MiB.');
      input.value = '';
      return;
    }
    this.file = file;
    this.preview.set(URL.createObjectURL(file));
  }
  complete() {
    void this.act(async () => {
      if (this.file && !this.uploadedPhotoId) {
        const r = await firstValueFrom(
          this.api.upload(
            this.orderId,
            this.file,
            this.detail()!.assignmentVersion,
            this.isEmployee() ? this.detail()!.attemptId : null,
          ),
        );
        this.uploadedPhotoId = r.data.id;
      }
      const proof = {
        recipientName: this.recipientName,
        ...(this.uploadedPhotoId
          ? { photoId: this.uploadedPhotoId }
          : { exceptionReason: this.exceptionReason }),
      };
      await firstValueFrom(
        this.isAdmin()
          ? this.api.patch(`orders/${this.orderId}/delivery-status`, {
              assignmentVersion: this.detail()!.assignmentVersion,
              deliveryStatus: 'DELIVERED',
              ...proof,
            })
          : this.api.patch(`${this.base()}/status`, {
              ...this.fence(),
              deliveryStatus: 'DELIVERED',
              ...proof,
            }),
      );
      this.stopLocal();
      this.clearDraft();
    }, 'Delivery completed. Payment remains managed by the admin.');
  }
  async enableSharing() {
    if (this.sharing() || this.busy()) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      this.gpsError.set(
        'Live location needs a secure HTTPS page and device GPS. Delivery actions remain available.',
      );
      return;
    }
    const gen = this.generation;
    this.busy.set(true);
    try {
      const r = await firstValueFrom(
        this.api.post<{ sessionId: string }>(`${this.base()}/tracking/start`, this.fence()),
      );
      if (!this.alive || gen !== this.generation) return;
      this.sessionId = r.data.sessionId;
      this.sequence = 0;
      this.sharing.set(true);
      this.gpsError.set('');
      this.sample();
    } catch (e) {
      this.fail(e);
    } finally {
      if (this.alive) this.busy.set(false);
    }
  }
  async disableSharing() {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    this.stopLocal();
    try {
      await firstValueFrom(
        this.api.post(`${this.base()}/tracking/stop`, { ...this.fence(), sessionId }),
      );
      this.poll();
    } catch (e) {
      this.fail(e);
    }
  }
  private async sample() {
    if (
      this.samplerBusy ||
      !this.sharing() ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine ||
      !this.alive
    )
      return;
    clearTimeout(this.gpsTimer);
    const gen = this.gpsGeneration,
      order = this.orderId,
      sessionId = this.sessionId;
    this.samplerBusy = true;
    try {
      const p = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000,
        }),
      );
      if (
        !this.alive ||
        gen !== this.gpsGeneration ||
        !this.sharing() ||
        document.visibilityState !== 'visible' ||
        order !== this.orderId
      )
        return;
      await firstValueFrom(
        this.api
          .post(`${this.base()}/positions`, {
            ...this.fence(),
            sessionId,
            sequence: ++this.sequence,
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            observedAt: new Date(p.timestamp).toISOString(),
          })
          .pipe(timeout(15000)),
      );
      this.gpsError.set('');
      this.poll();
    } catch (e: any) {
      if (this.alive && gen === this.gpsGeneration) {
        this.gpsError.set(
          e.code === 1
            ? 'Location permission denied. Status updates still work.'
            : 'No fresh location could be sent. Keep the page open and retry.',
        );
        if (e.code === 1) {
          void this.disableSharing();
        }
        if ([401, 403, 404, 409].includes(e.status)) this.stopLocal();
      }
    } finally {
      this.samplerBusy = false;
      if (this.alive && this.sharing() && document.visibilityState === 'visible')
        this.gpsTimer = setTimeout(() => this.sample(), 10000);
    }
  }
  private stopLocal() {
    this.gpsGeneration++;
    this.sharing.set(false);
    this.sessionId = '';
    clearTimeout(this.gpsTimer);
  }
  loadPhoto() {
    const gen = this.generation;
    this.watch(
      this.api.photo(`${this.base()}/proof-photo`).subscribe({
        next: (blob) => {
          if (gen !== this.generation) return;
          this.clearPhoto();
          this.photoUrl.set(URL.createObjectURL(blob));
        },
        error: () => {
          this.loadedPhotoOrder = 0;
          this.error.set('Proof photo is unavailable. Retry to load it.');
        },
      }),
    );
  }
  private clearPhoto() {
    if (this.photoUrl()) URL.revokeObjectURL(this.photoUrl());
    this.photoUrl.set('');
  }
  private clearDraft() {
    if (this.preview()) URL.revokeObjectURL(this.preview());
    this.preview.set('');
    this.file = undefined;
    this.uploadedPhotoId = '';
  }
  private fail(e: any) {
    this.error.set(
      e.error?.error?.message ?? 'This action was not saved. Check connectivity and retry.',
    );
    if (e.status === 409) this.uploadedPhotoId = '';
  }
  ngOnDestroy() {
    this.alive = false;
    this.generation++;
    this.stopLocal();
    clearInterval(this.pollTimer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('online', this.reconnect);
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.clearPhoto();
    this.clearDraft();
  }
}

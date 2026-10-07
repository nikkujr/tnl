import { Component, inject, signal, OnInit } from '@angular/core';
import { AppFormsModule } from '../../shared/app-forms.module';
import { DeliveryApi, DeliveryEmployee } from './delivery-api.service';
@Component({
  selector: 'app-delivery-employees',
  imports: [AppFormsModule],
  styleUrl: './delivery.scss',
  template: ` <header class="delivery-heading">
      <span class="eyebrow">Administration</span>
      <h2>Delivery employees</h2>
      <p>Manage delivery-only accounts and dispatch responsibility.</p>
      <button class="primary" (click)="edit()">New delivery employee</button>
    </header>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (notice()) {
      <p class="notice" role="status">{{ notice() }}</p>
    }
    @if (open) {
      <form class="employee-form" #form="ngForm" (ngSubmit)="save()">
        <h3>{{ editingId ? 'Edit employee' : 'Create employee' }}</h3>
        <div class="form-grid">
          <label
            >Full name<input data-validation-field="fullName"
              name="name"
              [(ngModel)]="fullName"
              required
              minlength="2"
              maxlength="160" /></label
          ><label>Email<input data-validation-field="email" name="email" type="email" [(ngModel)]="email" required /></label
          ><label
            >PH mobile number<input data-validation-field="phone"
              name="phone"
              [(ngModel)]="phone"
              required
              placeholder="09171234567"
          /></label>
          @if (!editingId) {
            <label
              >Initial password<input data-validation-field="password"
                name="password"
                type="password"
                [(ngModel)]="password"
                required
                minlength="8"
                maxlength="72"
                autocomplete="new-password"
            /></label>
          } @else {
            <label
              ><span>Account active</span><input data-validation-field="active" name="active" type="checkbox" [(ngModel)]="active"
            /></label>
          }
        </div>
        <p class="muted">Reassign unfinished deliveries before deactivating an employee.</p>
        <div class="actions">
          <button class="primary" [disabled]="busy()">Save employee</button
          ><button type="button" (click)="close()" [disabled]="busy()">Cancel</button>
        </div>
      </form>
    }
    @if (resetTarget) {
      <form class="employee-form" #resetForm="ngForm" (ngSubmit)="reset()">
        <h3>Reset password for {{ resetTarget.fullName }}</h3>
        <p>{{ resetTarget.email }} · Existing sessions and live sharing will be invalidated.</p>
        <label
          >New password<input data-validation-field="password"
            name="newPassword"
            type="password"
            [(ngModel)]="password"
            required
            minlength="8"
            maxlength="72"
            autocomplete="new-password" /></label
        ><label
          >Confirm password<input data-validation-field="confirmation" [attr.data-validation-error]="password !== confirmation ? 'Passwords do not match.' : null"
            name="confirmation"
            type="password"
            [(ngModel)]="confirmation"
            required
            autocomplete="new-password"
        /></label>
        <div class="actions">
          <button
            class="primary"
            [disabled]="busy()"
          >
            Confirm password reset</button
          ><button type="button" (click)="close()" [disabled]="busy()">Cancel</button>
        </div>
      </form>
    }
    <section class="delivery-card">
      @for (e of employees(); track e.id) {
        <article class="employee-row">
          <div>
            <strong>{{ e.fullName }}</strong
            ><small>{{ e.email }} · {{ e.phone }}</small
            ><small>{{ e.active ? 'Active' : 'Inactive' }}</small>
          </div>
          <div class="actions">
            <button (click)="edit(e)" [disabled]="busy()">Edit</button>
            @if (e.active) {
              <button (click)="beginReset(e)" [disabled]="busy()">Reset password</button>
            }
          </div>
        </article>
      } @empty {
        <p>{{ busy() ? 'Loading employees…' : 'No delivery employees yet.' }}</p>
      }
      <button (click)="load()" [disabled]="busy()">Refresh</button>
    </section>`,
})
export class DeliveryEmployeesPage implements OnInit {
  readonly api = inject(DeliveryApi);
  readonly employees = signal<DeliveryEmployee[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  open = false;
  editingId = 0;
  fullName = '';
  email = '';
  phone = '';
  password = '';
  confirmation = '';
  active = true;
  resetTarget: DeliveryEmployee | null = null;
  ngOnInit() {
    this.load();
  }
  load() {
    this.busy.set(true);
    this.api.get<DeliveryEmployee[]>('delivery-employees').subscribe({
      next: (r) => {
        this.employees.set(r.data);
        this.busy.set(false);
      },
      error: (e) => this.fail(e),
    });
  }
  close() {
    this.open = false;
    this.resetTarget = null;
    this.password = '';
    this.confirmation = '';
  }
  edit(e?: DeliveryEmployee) {
    this.close();
    this.open = true;
    this.editingId = e?.id ?? 0;
    this.fullName = e?.fullName ?? '';
    this.email = e?.email ?? '';
    this.phone = e?.phone ?? '';
    this.active = e ? Boolean(e.active) : true;
  }
  beginReset(e: DeliveryEmployee) {
    this.close();
    this.resetTarget = e;
  }
  save() {
    this.busy.set(true);
    this.error.set('');
    const profile = { fullName: this.fullName.trim(), email: this.email.trim(), phone: this.phone };
    const request = this.editingId
      ? this.api.put(`delivery-employees/${this.editingId}`, { ...profile, active: this.active })
      : this.api.post('delivery-employees', { ...profile, password: this.password });
    request.subscribe({
      next: () => {
        this.close();
        this.notice.set('Employee saved.');
        this.load();
      },
      error: (e) => this.fail(e),
    });
  }
  reset() {
    if (!this.resetTarget || this.password !== this.confirmation) return;
    this.busy.set(true);
    this.api
      .post(`delivery-employees/${this.resetTarget.id}/reset-password`, {
        newPassword: this.password,
      })
      .subscribe({
        next: () => {
          this.close();
          this.notice.set('Password reset. Old sessions and live sharing stopped.');
          this.load();
        },
        error: (e) => this.fail(e),
      });
  }
  private fail(e: any) {
    this.busy.set(false);
    this.error.set(e.error?.error?.message ?? 'Unable to save. Check the details and retry.');
  }
}

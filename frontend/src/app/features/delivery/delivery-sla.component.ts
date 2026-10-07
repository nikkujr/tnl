import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeliverySla } from './delivery-api.service';

@Component({
  selector: 'app-delivery-sla',
  imports: [DatePipe],
  styleUrl: './delivery.scss',
  template: `@if (sla(); as s) {
    <section class="delivery-sla" aria-label="Delivery SLA">
      <span class="eyebrow">{{ customer() ? 'Delivery promise' : 'Delivery SLA' }}</span>
      <span [class]="'sla-status ' + s.state.toLowerCase()">{{ labels[s.state] }}</span>
      @if (s.dueAt) {
        <strong>Deliver by {{ s.dueAt | date: 'MMM d, y, h:mm a' : '+0800' }}</strong>
        <small>Philippine time · {{ customer() ? 'original delivery promise' : 'deadline saved at dispatch' }}</small>
      }
      @switch (s.state) {
        @case ('ON_TRACK') { <p>{{ duration(s.minutes!) }} remaining to meet the deadline.</p> }
        @case ('OVERDUE') { <p>{{ duration(s.minutes!) }} overdue. {{ customer() ? 'Please contact us for an update.' : 'Follow up on this delivery.' }}</p> }
        @case ('MET') { <p>Delivered within the promised deadline.</p> }
        @case ('BREACHED') { <p>Delivered {{ duration(s.minutes!) }} after the promised deadline.</p> }
        @case ('NOT_SET') { <p>No delivery promise recorded.</p> }
      }
    </section>
  }`,
})
export class DeliverySlaComponent {
  readonly sla = input<DeliverySla | null>(null);
  readonly customer = input(false);
  readonly labels = { NOT_SET: 'Not measured', ON_TRACK: 'On track', OVERDUE: 'Overdue', MET: 'Delivered on time', BREACHED: 'Delivered late' };
  duration(minutes: number) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  }
}

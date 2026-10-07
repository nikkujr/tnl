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
      <span [class]="'sla-status ' + s.state.toLowerCase()">{{ s.state === 'NOT_SET' && s.policy && !s.policy.completed ? 'Awaiting dispatch' : labels[s.state] }}</span>
      @if (s.policy; as policy) {
        @if (policy.fromAt && policy.toAt) {
          <strong>{{ policy.projected ? 'Expected delivery' : 'Delivery window' }}: {{ policy.fromAt | date: 'MMM d' : '+0800' }} – {{ policy.toAt | date: 'MMM d, y' : '+0800' }}</strong>
          <small>{{ policy.projected ? 'Provisional until dispatch' : 'Original promise saved at dispatch' }} · {{ regions[policy.region!] }}{{ policy.remoteDays ? ' · +' + policy.remoteDays + ' remote-area business day(s)' : '' }}</small>
        } @else { <p>{{ policy.completed ? 'No courier delivery window was recorded.' : 'The delivery region will be confirmed by our team.' }}</p> }
        @if (!compact()) {
        <ol class="sla-stages">
          @for (stage of policy.stages; track stage.name) {
            <li [class]="stage.state.toLowerCase()">
              <div><strong>{{ stage.name }}</strong><span [class]="'sla-status ' + stage.state.toLowerCase()">{{ stage.state === 'NOT_SET' ? (policy.completed ? 'Not recorded' : 'Awaiting start') : stage.state === 'MET' ? 'Completed on time' : stage.state === 'BREACHED' ? 'Completed late' : labels[stage.state] }}</span></div>
              <p>{{ stage.rule }}</p>
              @if (stage.dueAt) { <small>Due {{ stage.dueAt | date: 'MMM d, y, h:mm a' : '+0800' }}</small> }
              @if (stage.completedAt) { <small>Completed {{ stage.completedAt | date: 'MMM d, y, h:mm a' : '+0800' }}</small> }
            </li>
          }
        </ol>
        <small>Business days: Monday–Friday · Philippine time. Delayed after the maximum delivery date.</small>
        }
      } @else if (s.dueAt) {
        <strong>Deliver by {{ s.dueAt | date: 'MMM d, y, h:mm a' : '+0800' }}</strong>
        <small>Philippine time · {{ customer() ? 'original delivery promise' : 'deadline saved at dispatch' }}</small>
      }
      @switch (s.state) {
        @case ('ON_TRACK') { <p>{{ duration(s.minutes!) }} remaining to meet the deadline.</p> }
        @case ('OVERDUE') { <p>{{ duration(s.minutes!) }} overdue. {{ customer() ? 'Please contact us for an update.' : 'Follow up on this delivery.' }}</p> }
        @case ('MET') { <p>Delivered within the promised deadline.</p> }
        @case ('BREACHED') { <p>Delivered {{ duration(s.minutes!) }} after the promised deadline.</p> }
        @case ('NOT_SET') { @if (!s.policy) { <p>No delivery promise recorded.</p> } }
      }
    </section>
  }`,
})
export class DeliverySlaComponent {
  readonly sla = input<DeliverySla | null>(null);
  readonly customer = input(false);
  readonly compact = input(false);
  readonly labels = { NOT_SET: 'Not measured', ON_TRACK: 'On track', OVERDUE: 'Delayed', MET: 'Delivered on time', BREACHED: 'Delivered late' };
  readonly regions = { BICOL: 'Bicol', LUZON: 'Other Luzon', VISAYAS: 'Visayas', MINDANAO: 'Mindanao' };
  duration(minutes: number) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  }
}

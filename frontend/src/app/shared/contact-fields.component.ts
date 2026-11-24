import { Component, DestroyRef, inject, input, OnChanges, signal, SimpleChanges } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { BusinessApi } from '../core/business-api.service';
import { AppFormsModule } from './app-forms.module';

export type SavedContactParts = Record<string, string> | string | null;
export interface ContactEntry {
  legacy: string;
  parts: Record<string, string> | null;
}
interface AddressMatch {
  label: string;
  parts: Record<string, string>;
}

const fields = {
  name: [
    { key: 'firstName', label: 'First name', max: 60, required: true, autocomplete: 'given-name' },
    { key: 'middleName', label: 'Middle name or initial', max: 38, required: false, autocomplete: 'additional-name' },
    { key: 'lastName', label: 'Last name', max: 60, required: true, autocomplete: 'family-name' },
  ],
  address: [
    { key: 'street', label: 'House number and street', max: 180, required: true, autocomplete: 'address-line1' },
    { key: 'barangay', label: 'Barangay (optional)', max: 90, required: false, autocomplete: 'address-line2' },
    { key: 'city', label: 'City or municipality', max: 90, required: true, autocomplete: 'address-level2' },
    { key: 'province', label: 'Province or region', max: 90, required: true, autocomplete: 'address-level1' },
    { key: 'postalCode', label: 'Postal code (optional)', max: 10, required: false, autocomplete: 'postal-code' },
  ],
};

export function contactEntry(legacy = '', saved?: SavedContactParts): ContactEntry {
  const parts = typeof saved === 'string' ? JSON.parse(saved) as Record<string, string> : saved;
  return { legacy: parts ? "" : legacy, parts: parts ? { ...parts } : legacy ? null : {} };
}

export function contactText(entry: ContactEntry, kind: keyof typeof fields): string {
  return entry.parts
    ? fields[kind].map(({ key }) => entry.parts?.[key]?.trim()).filter(Boolean).join(kind === 'name' ? ' ' : ', ')
    : entry.legacy;
}

@Component({
  selector: 'app-contact-fields',
  imports: [AppFormsModule],
  template: `
    <fieldset [class.name-fields]="kind() === 'name'" [class.address-fields]="kind() === 'address'">
      <legend>{{ label() }}</legend>
      @if (entry().legacy) {
        <p>Saved {{ kind() }}: {{ entry().legacy }}</p>
      }
      @if (entry().parts; as parts) {
        @if (kind() === 'address') {
          <div class="address-search">
            <label>Find an address
              <input type="search" [ngModel]="query" (ngModelChange)="changeQuery($event)"
                [ngModelOptions]="{ standalone: true }" maxlength="200" autocomplete="off"
                placeholder="Street, barangay, or city"
                (keydown.enter)="$event.preventDefault(); searchAddress()" />
            </label>
            <button class="secondary" type="button" [disabled]="query.trim().length < 3 || searching()" (click)="searchAddress()">
              {{ searching() ? 'Searching…' : 'Search' }}
            </button>
          </div>
          @if (matches().length) {
            <ul class="matches" aria-label="Matching addresses">
              @for (match of matches(); track $index) {
                <li><button type="button" (click)="selectAddress(match)">{{ match.label }}</button></li>
              }
            </ul>
            <small class="provider">Address results by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a></small>
          }
          @if (searchStatus()) { <p class="search-status" role="status">{{ searchStatus() }}</p> }
        }
        <div class="parts">
          @for (field of fields[kind()]; track field.key) {
            <label [class.street]="field.key === 'street'">{{ field.label }}
              <input [name]="prefix() + '.' + field.key" [attr.data-validation-field]="prefix() + '.' + field.key"
                [(ngModel)]="parts[field.key]" [ngModelOptions]="{ standalone: true }"
                [attr.data-validation-error]="field.required && parts[field.key] && !parts[field.key].trim() ? 'This field is required.' : null"
                [required]="field.required" [attr.maxlength]="field.max" [autocomplete]="field.autocomplete" />
            </label>
          }
        </div>
        @if (entry().legacy) {
          <button class="secondary" type="button" (click)="changeQuery(''); entry().parts = null">Use saved {{ kind() }}</button>
        }
      } @else {
        <button class="secondary" type="button" (click)="entry().parts = {}">Enter separate {{ kind() }} fields</button>
      }
    </fieldset>
  `,
  styleUrl: './contact-fields.component.scss',
})
export class ContactFieldsComponent implements OnChanges {
  readonly kind = input.required<keyof typeof fields>();
  readonly entry = input.required<ContactEntry>();
  readonly label = input.required<string>();
  readonly prefix = input.required<string>();
  readonly fields = fields;
  private readonly api = inject(BusinessApi);
  private readonly destroyRef = inject(DestroyRef);
  private lookup?: Subscription;
  query = '';
  readonly matches = signal<AddressMatch[]>([]);
  readonly searching = signal(false);
  readonly searchStatus = signal('');

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entry']) this.changeQuery('');
  }

  changeQuery(value: string) {
    this.lookup?.unsubscribe();
    this.query = value;
    this.matches.set([]);
    this.searchStatus.set('');
    this.searching.set(false);
  }

  searchAddress() {
    const query = this.query.trim();
    if (query.length < 3 || this.searching()) return;
    this.changeQuery(query);
    this.searching.set(true);
    this.lookup = this.api.post<AddressMatch[]>('catalog/address-search', { query })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ data }) => {
          this.searching.set(false);
          this.matches.set(data);
          if (!data.length) this.searchStatus.set('No matches. Try another search or enter the address below.');
        },
        error: () => {
          this.searching.set(false);
          this.searchStatus.set('Address search is unavailable. Enter the address below or try again.');
        },
      });
  }

  selectAddress(match: AddressMatch) {
    const parts = this.entry().parts;
    if (!parts) return;
    Object.assign(parts, match.parts);
    this.changeQuery(match.label);
    this.searchStatus.set('Address selected. Check the fields and fill in any missing details.');
  }
}

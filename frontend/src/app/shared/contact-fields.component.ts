import { Component, input } from '@angular/core';
import { AppFormsModule } from './app-forms.module';

export type SavedContactParts = Record<string, string> | string | null;
export interface ContactEntry {
  legacy: string;
  parts: Record<string, string> | null;
}

const fields = {
  name: [
    { key: 'firstName', label: 'First name', max: 60, required: true },
    { key: 'middleName', label: 'Middle name or initial (optional)', max: 38, required: false },
    { key: 'lastName', label: 'Last name', max: 60, required: true },
  ],
  address: [
    { key: 'street', label: 'House number and street', max: 180, required: true },
    { key: 'barangay', label: 'Barangay (optional)', max: 90, required: false },
    { key: 'city', label: 'City or municipality', max: 90, required: true },
    { key: 'province', label: 'Province or region', max: 90, required: true },
    { key: 'postalCode', label: 'Postal code (optional)', max: 10, required: false },
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
    <fieldset>
      <legend>{{ label() }}</legend>
      @if (entry().legacy) {
        <p>Saved {{ kind() }}: {{ entry().legacy }}</p>
      }
      @if (entry().parts; as parts) {
        <div class="parts">
          @for (field of fields[kind()]; track field.key) {
            <label>{{ field.label }}
              <input [name]="prefix() + '.' + field.key" [attr.data-validation-field]="prefix() + '.' + field.key"
                [(ngModel)]="parts[field.key]" [ngModelOptions]="{ standalone: true }"
                [attr.data-validation-error]="field.required && parts[field.key] && !parts[field.key].trim() ? 'This field is required.' : null"
                [required]="field.required" [attr.maxlength]="field.max" />
            </label>
          }
        </div>
        @if (entry().legacy) {
          <button type="button" (click)="entry().parts = null">Use saved {{ kind() }}</button>
        }
      } @else {
        <button type="button" (click)="entry().parts = {}">Enter separate {{ kind() }} fields</button>
      }
    </fieldset>
  `,
  styles: [`
    :host { display: block; grid-column: 1 / -1; width: 100%; min-width: 0; }
    fieldset { margin: 0; padding: .75rem; border: 1px solid var(--color-border, #d8d4e4); border-radius: .6rem; min-width: 0; }
    legend, label { font-weight: 600; font-size: .85rem; }
    p { margin: 0 0 .5rem; overflow-wrap: anywhere; }
    .parts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: .65rem; }
    input { width: 100%; margin-top: .25rem; }
    button { margin-top: .4rem; }
  `],
})
export class ContactFieldsComponent {
  readonly kind = input.required<keyof typeof fields>();
  readonly entry = input.required<ContactEntry>();
  readonly label = input.required<string>();
  readonly prefix = input.required<string>();
  readonly fields = fields;
}

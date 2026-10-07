import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AppFormsModule } from './app-forms.module';
import { AppIconComponent } from './app-icon.component';

export interface ActionDialogStep {
  value: string;
  label: string;
  description?: string;
}

export interface ActionDialogField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'steps';
  value: string | number;
  options?: string[];
  steps?: ActionDialogStep[];
  /** For type 'steps': the value already reached on the record, used to mark steps as complete. */
  currentValue?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number;
  validate?: (values: Record<string, string | number>) => string | null;
  required?: boolean;
  visibleWhen?: { key: string; value: string | number | Array<string | number> };
}

export interface ActionDialogConfig {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  fields?: ActionDialogField[];
}

@Component({
  selector: 'app-action-dialog',
  imports: [AppFormsModule, AppIconComponent],
  templateUrl: './action-dialog.component.html',
  styleUrl: './action-dialog.component.scss',
  styles: ['h2{font-size:22px;font-weight:750}p{font-size:13px}label{font-size:11px}input,select{width:100%;min-height:44px;padding:10px 12px;border-color:var(--line, #d8d4e4);color:var(--ink, #1d2939);font-size:13px;background:var(--color-surface, #fff);box-shadow:0 1px 2px rgba(16,24,40,.04);outline:0}select{appearance:none;-webkit-appearance:none;padding-right:38px;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%236d6a82\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}input:hover,select:hover{border-color:var(--green, #aaa3bd)}input:focus,select:focus{border-color:var(--green, #8b82db);box-shadow:0 0 0 3px rgba(139,130,219,.16)}footer button{min-height:40px;font-size:12px}.confirm{background:var(--green, #7167c9)}.confirm:hover{background:var(--color-accent-hover, #6258b8)}']
})
export class ActionDialogComponent {
  @Input({ required: true }) config!: ActionDialogConfig;
  @Output() readonly cancelled = new EventEmitter<void>();
  @Output() readonly confirmed = new EventEmitter<Record<string, string | number>>();

  fieldError(field: ActionDialogField): string | null {
    return field.validate?.(Object.fromEntries((this.config.fields ?? []).map(field => [field.key, field.value]))) ?? null;
  }

  submit(): void {
    const values = Object.fromEntries((this.config.fields ?? []).map((field) => [field.key, field.value]));
    this.confirmed.emit(values);
  }

  isVisible(field: ActionDialogField): boolean {
    if (!field.visibleWhen) return true;
    const selected = this.config.fields?.find((candidate) => candidate.key === field.visibleWhen!.key)?.value;
    return Array.isArray(field.visibleWhen.value) ? field.visibleWhen.value.includes(selected!) : selected === field.visibleWhen.value;
  }

  selectStep(field: ActionDialogField, value: string): void {
    field.value = value;
  }

  isStepComplete(field: ActionDialogField, value: string): boolean {
    const values = (field.steps ?? []).map((step) => step.value);
    if (field.currentValue === undefined) return false;
    return values.indexOf(value) <= values.indexOf(field.currentValue);
  }
}

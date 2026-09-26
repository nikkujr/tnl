import { AfterViewInit, Component, ElementRef, forwardRef, inject, Input, SecurityContext, ViewChild } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'app-rich-text-editor',
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RichTextEditorComponent), multi: true }]
})
export class RichTextEditorComponent implements ControlValueAccessor, AfterViewInit {
  private readonly sanitizer = inject(DomSanitizer);
  @Input() placeholder = 'Write the campaign email content…';
  @ViewChild('editor', { static: true }) private editorRef!: ElementRef<HTMLDivElement>;

  disabled = false;
  private pendingValue = '';
  private viewReady = false;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.editorRef.nativeElement.innerHTML = this.pendingValue;
  }

  writeValue(value: string): void {
    const safe = this.sanitizer.sanitize(SecurityContext.HTML, value ?? '') ?? '';
    this.pendingValue = safe;
    if (this.viewReady) this.editorRef.nativeElement.innerHTML = safe;
  }
  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(isDisabled: boolean): void { this.disabled = isDisabled; }

  exec(command: string, value?: string): void {
    this.editorRef.nativeElement.focus();
    document.execCommand(command, false, value);
    this.emitChange();
  }

  insertLink(): void {
    const url = window.prompt('Link URL (https://…)');
    if (url) this.exec('createLink', url);
  }

  onInput(): void { this.emitChange(); }
  onBlur(): void { this.onTouched(); }

  private emitChange(): void {
    this.onChange(this.editorRef.nativeElement.innerHTML);
  }
}

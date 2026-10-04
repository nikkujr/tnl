import { Component, DestroyRef, inject, Input, OnChanges, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { catchError, debounceTime, of, Subject, switchMap } from 'rxjs';
import { BusinessApi } from '../../core/business-api.service';

@Component({
  selector: 'app-email-preview',
  template: `
    @if (loading()) {
      <p class="status" role="status">Updating preview…</p>
    }
    @if (error()) {
      <p class="status" role="alert">
        {{ error() }} <button type="button" (click)="refresh()">Retry preview</button>
      </p>
    }
    @if (html(); as content) {
      <iframe
        title="Branded email preview with sample customer details"
        sandbox=""
        referrerpolicy="no-referrer"
        [srcdoc]="content"
      ></iframe>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      iframe {
        display: block;
        width: 100%;
        height: 570px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #f6f4fc;
        box-sizing: border-box;
      }
      .status {
        font-size: 12px;
        color: var(--muted);
        line-height: 1.5;
        margin: 10px 0;
      }
      .status button {
        font: inherit;
        cursor: pointer;
        color: var(--green);
        border: 0;
        background: transparent;
        text-decoration: underline;
      }
    `,
  ],
})
export class EmailPreviewComponent implements OnInit, OnChanges {
  private readonly api = inject(BusinessApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changes = new Subject<{ workflow: string; subject: string; template: string }>();
  @Input({ required: true }) workflow = '';
  @Input() subject = '';
  @Input() template = '';
  readonly html = signal<SafeHtml | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  ngOnInit() {
    this.changes
      .pipe(
        debounceTime(200),
        switchMap((body) => {
          this.loading.set(true);
          this.error.set('');
          this.html.set(null);
          return this.api
            .post<{ html: string }>('automations/email-preview', body)
            .pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.loading.set(false);
        if (response) {
          // The admin-only endpoint renders escaped text through the outgoing email
          // template. Links are inert and the iframe has an opaque sandbox origin.
          this.html.set(this.sanitizer.bypassSecurityTrustHtml(response.data.html));
        } else this.error.set('Email preview could not be loaded.');
      });
    this.refresh();
  }
  ngOnChanges() {
    this.refresh();
  }
  refresh() {
    this.changes.next({ workflow: this.workflow, subject: this.subject, template: this.template });
  }
}

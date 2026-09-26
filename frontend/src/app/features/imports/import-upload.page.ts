import { DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, ImportBatch } from '../../core/api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

@Component({
  selector: 'app-import-upload-page',
  imports: [DatePipe, BreadcrumbComponent],
  templateUrl: './import-upload.page.html',
  styleUrls: ['./import-upload.page.scss']
})
export class ImportUploadPage implements OnInit {
  readonly batches = signal<ImportBatch[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly error = signal('');
  selectedFile: File | null = null;

  constructor(private readonly api: ApiService, private readonly router: Router) {}

  ngOnInit(): void {
    this.loadBatches();
  }

  loadBatches(): void {
    this.loading.set(true);
    this.api.getImportBatches().subscribe({
      next: ({ data }) => { this.batches.set(data); this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.error.set(error.error?.error?.message ?? 'Unable to load past imports.'); }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.error.set('');
  }

  upload(): void {
    if (!this.selectedFile) { this.error.set('Choose a .xlsx file first.'); return; }
    this.uploading.set(true);
    this.error.set('');
    this.api.uploadSalesReport(this.selectedFile).subscribe({
      next: ({ data }) => { this.uploading.set(false); this.router.navigateByUrl(`/imports/${data.batchId}`); },
      error: (error) => { this.uploading.set(false); this.error.set(error.error?.error?.message ?? 'Unable to parse this file.'); }
    });
  }

  resume(batch: ImportBatch): void {
    this.router.navigateByUrl(`/imports/${batch.id}`);
  }

  statusLabel(status: string): string {
    return status.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  }
  statusClass(status: string): string { return status.toLowerCase().replaceAll('_', '-'); }
}

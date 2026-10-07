import { CurrencyPipe } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { AppFormsModule } from '../../shared/app-forms.module';
import { ApiService, Commission } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

@Component({
  selector: 'app-commissions-page',
  imports: [CurrencyPipe, AppFormsModule, BreadcrumbComponent],
  templateUrl: './commissions.page.html',
  styleUrl: './commissions.page.scss'
})
export class CommissionsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly toast = inject(ToastService);

  readonly commissions = signal<Commission[]>([]);
  readonly loading = signal(true);

  search = '';
  from = '';
  to = '';
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private load(): void {
    this.loading.set(true);
    this.api.getCommissions({ search: this.search || undefined, from: this.from || undefined, to: this.to || undefined }).subscribe({
      next: ({ data }) => { this.commissions.set(data); this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load commissions.'); }
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.load(), 350);
  }

  onDateRangeChange(): void {
    this.load();
  }
}

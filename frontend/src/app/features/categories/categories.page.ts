import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { AppFormsModule } from '../../shared/app-forms.module';
import { ApiService, Category } from '../../core/api.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { ActionDialogComponent } from '../../shared/action-dialog.component';
import { AppIconComponent } from '../../shared/app-icon.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';

@Component({
  selector: 'app-categories-page',
  imports: [AppFormsModule, ActionDialogComponent, AppIconComponent, BreadcrumbComponent],
  templateUrl: './categories.page.html',
  styleUrl: './categories.page.scss'
})
export class CategoriesPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly toast = inject(ToastService);
  readonly confirmDialog = inject(ConfirmDialogService);

  readonly categories = signal<Category[]>([]);
  readonly loading = signal(true);
  readonly showForm = signal(false);

  search = '';
  page = 1;
  readonly limit = 20;
  total = 0;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  editingId: number | null = null;
  form = { name: '', description: '' };

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  private load(): void {
    this.loading.set(true);
    this.api.getCategories({ search: this.search || undefined, page: this.page, limit: this.limit }).subscribe({
      next: ({ data, meta }) => { this.categories.set(data); this.total = meta?.total ?? data.length; this.loading.set(false); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to load categories.'); }
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; this.load(); }, 350);
  }

  totalPages(): number { return Math.max(1, Math.ceil(this.total / this.limit)); }

  goToPage(delta: number): void {
    const next = this.page + delta;
    if (next < 1 || (next - 1) * this.limit >= this.total) return;
    this.page = next;
    this.load();
  }

  openForm(category?: Category): void {
    this.editingId = category?.id ?? null;
    this.form = { name: category?.name ?? '', description: category?.description ?? '' };
    this.showForm.set(true);
  }

  save(): void {
    const input = { name: this.form.name, description: this.form.description || null };
    const request = this.editingId ? this.api.updateCategory(this.editingId, input) : this.api.createCategory(input);
    this.loading.set(true);
    request.subscribe({
      next: () => { this.showForm.set(false); this.toast.success(this.editingId ? 'Category updated.' : 'Category created.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to save category.'); }
    });
  }

  async remove(category: Category): Promise<void> {
    const confirmed = await this.confirmDialog.open({ title: 'Delete category?', message: `"${category.name}" will be permanently removed.`, confirmLabel: 'Delete category', tone: 'danger' });
    if (!confirmed) return;
    this.loading.set(true);
    this.api.deleteCategory(category.id).subscribe({
      next: () => { this.toast.success('Category deleted.'); this.load(); },
      error: (error) => { this.loading.set(false); this.toast.fail(error.error?.error?.message ?? 'Unable to delete category.'); }
    });
  }
}

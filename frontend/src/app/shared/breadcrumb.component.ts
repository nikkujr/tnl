import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface BreadcrumbItem { label: string; link?: string }

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="app-breadcrumb" aria-label="Breadcrumb">
      @for (item of items; track item.label; let last = $last) {
        @if (item.link && !last) {
          <a [routerLink]="item.link">{{ item.label }}</a>
          <span class="sep" aria-hidden="true">/</span>
        } @else {
          <span class="current">{{ item.label }}</span>
        }
      }
    </nav>
  `,
  styles: [`
    .app-breadcrumb { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
    .app-breadcrumb a { color: #465fff; font-size: 12px; font-weight: 600; text-decoration: none; }
    .app-breadcrumb a:hover { text-decoration: underline; }
    .app-breadcrumb .sep { color: #d0d5dd; font-size: 12px; }
    .app-breadcrumb .current { color: #667085; font-size: 12px; font-weight: 600; }
  `]
})
export class BreadcrumbComponent {
  @Input({ required: true }) items: BreadcrumbItem[] = [];
}

import { Component, inject } from '@angular/core';
import { AppIconComponent, AppIconName } from './app-icon.component';
import { ToastService, ToastType } from './toast.service';

const ICONS: Record<ToastType, AppIconName> = {
  success: 'checkCircle', error: 'alertCircle', warning: 'alert', info: 'info'
};

@Component({
  selector: 'app-toast-container',
  imports: [AppIconComponent],
  template: `
    <div class="toast-stack" role="region" aria-label="Notifications">
      @for (toast of toastService.toasts(); track toast.id) {
        <div [class]="'toast toast-' + toast.type" role="status">
          <span class="toast-icon"><app-icon [name]="icon(toast.type)" /></span>
          <div class="toast-body">
            <p class="toast-message">{{ toast.message }}</p>
          </div>
          <button type="button" class="toast-close" aria-label="Dismiss notification" (click)="toastService.dismiss(toast.id)"><app-icon name="close" /></button>
          @if (toast.duration !== null) {
            <i class="toast-progress" [style.animation-duration.ms]="toast.duration"></i>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-stack { position: fixed; z-index: 200; top: 22px; right: 24px; width: min(320px, calc(100vw - 32px)); display: grid; gap: 8px; }
    .toast { position: relative; overflow: hidden; display: grid; grid-template-columns: 18px 1fr 28px; gap: 9px; align-items: center; padding: 10px 10px 10px 12px; border: 1px solid var(--line, var(--color-border, #e4e7ec)); border-left: 3px solid var(--toast-accent); border-radius: 8px; background: var(--color-surface, #fff); box-shadow: 0 4px 16px rgba(16, 24, 40, .1); animation: toast-in .18s ease-out both; }
    .toast-icon { display: grid; place-items: center; color: var(--toast-accent); }
    .toast-icon app-icon { width: 18px; height: 18px; }
    .toast-body { min-width: 0; }
    .toast-message { margin: 0; color: var(--ink, #1d2939); font-size: 13px; font-weight: 500; line-height: 1.5; }
    .toast-close { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 4px; color: var(--muted, #667085); background: transparent; cursor: pointer; }
    .toast-close:focus-visible { outline: 2px solid var(--toast-accent); outline-offset: 2px; }
    .toast-close app-icon { width: 14px; height: 14px; }
    .toast-progress { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--toast-accent); opacity: .4; animation-name: toast-progress; animation-timing-function: linear; animation-fill-mode: forwards; }

    .toast-success { --toast-accent: var(--status-success-text, #28786b); }
    .toast-error { --toast-accent: var(--status-danger-text, #a44355); }
    .toast-warning { --toast-accent: var(--status-warning-text, #a85a2a); }
    .toast-info { --toast-accent: var(--status-info-text, #4f6eaa); }

    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }

    @keyframes toast-in { from { opacity: 0; transform: translateX(28px) scale(.98); } to { opacity: 1; transform: none; } }
    @keyframes toast-progress { from { width: 100%; } to { width: 0%; } }

    @media (max-width: 680px) {
      .toast-stack { top: 14px; right: 16px; width: min(320px, calc(100vw - 32px)); }
    }
  `]
})
export class ToastContainerComponent {
  readonly toastService = inject(ToastService);

  icon(type: ToastType): AppIconName { return ICONS[type]; }
}

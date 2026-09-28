import { Component, inject } from '@angular/core';
import { AppIconComponent, AppIconName } from './app-icon.component';
import { ToastService, ToastType } from './toast.service';

const ICONS: Record<ToastType, AppIconName> = {
  success: 'checkCircle', error: 'alertCircle', warning: 'alert', info: 'info'
};
const LABELS: Record<ToastType, string> = {
  success: 'Success', error: 'Error', warning: 'Warning', info: 'Info'
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
            <strong class="toast-kicker">{{ label(toast.type) }}</strong>
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
    .toast-stack { position: fixed; z-index: 200; top: 22px; right: 24px; width: min(400px, calc(100vw - 32px)); display: grid; gap: 12px; }
    .toast { position: relative; overflow: hidden; display: grid; grid-template-columns: 34px 1fr auto; gap: 13px; align-items: start; padding: 16px 16px 18px; border: 1px solid var(--toast-accent, var(--line)); border-left-width: 5px; border-radius: 14px; background: var(--toast-bg, var(--color-surface)); box-shadow: 0 20px 50px rgba(16, 24, 40, .22); animation: toast-in .28s cubic-bezier(.22, 1, .36, 1) both; }
    .toast-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; color: var(--toast-accent); background: var(--color-surface, #fff); box-shadow: 0 0 0 1px var(--toast-accent); }
    .toast-icon app-icon { width: 18px; height: 18px; }
    .toast-body { min-width: 0; padding-top: 2px; }
    .toast-kicker { display: block; margin-bottom: 3px; color: var(--toast-accent); font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .toast-message { margin: 0; color: var(--ink, #1d2939); font-size: 13px; font-weight: 500; line-height: 1.5; }
    .toast-close { align-self: start; margin-top: 4px; padding: 2px; border: 0; color: var(--muted, #667085); background: transparent; }
    .toast-close app-icon { width: 14px; height: 14px; }
    .toast-progress { position: absolute; left: 0; bottom: 0; height: 4px; background: var(--toast-accent); opacity: .7; animation-name: toast-progress; animation-timing-function: linear; animation-fill-mode: forwards; }

    .toast-success { --toast-accent: var(--status-success-text, #28786b); --toast-bg: var(--status-success-bg, #eaf8f5); }
    .toast-error { --toast-accent: var(--status-danger-text, #a44355); --toast-bg: var(--status-danger-bg, #fff0f3); }
    .toast-warning { --toast-accent: var(--status-warning-text, #a85a2a); --toast-bg: var(--status-warning-bg, #fff1e8); }
    .toast-info { --toast-accent: var(--status-info-text, #4f6eaa); --toast-bg: var(--status-info-bg, #edf3ff); }

    @keyframes toast-in { from { opacity: 0; transform: translateX(28px) scale(.98); } to { opacity: 1; transform: none; } }
    @keyframes toast-progress { from { width: 100%; } to { width: 0%; } }

    @media (max-width: 680px) {
      .toast-stack { top: 14px; right: 16px; left: 16px; width: auto; }
    }
  `]
})
export class ToastContainerComponent {
  readonly toastService = inject(ToastService);

  icon(type: ToastType): AppIconName { return ICONS[type]; }
  label(type: ToastType): string { return LABELS[type]; }
}

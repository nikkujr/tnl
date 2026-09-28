import { Injectable, computed, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
export type ThemeMode = Theme | 'system';

const STORAGE_KEY = 'tnl_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemPrefersDark = signal(this.media.matches);

  /** 'system' follows the OS preference; 'light'/'dark' is an explicit user override. */
  readonly mode = signal<ThemeMode>(this.restore());
  readonly theme = computed<Theme>(() => {
    const mode = this.mode();
    return mode === 'system' ? (this.systemPrefersDark() ? 'dark' : 'light') : mode;
  });
  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    this.media.addEventListener('change', (event) => this.systemPrefersDark.set(event.matches));
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.theme());
    });
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }

  private restore(): ThemeMode {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  }
}

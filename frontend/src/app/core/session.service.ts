import { Injectable, computed, inject, signal } from '@angular/core';
import { map, Observable, tap } from 'rxjs';
import { ApiService, SessionUser } from './api.service';

function restoreSession(): SessionUser | null {
  try {
    const token = sessionStorage.getItem('tnl_access_token');
    const stored = sessionStorage.getItem('tnl_user');
    if (!token || !stored) return null;
    return JSON.parse(stored) as SessionUser;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);

  readonly session = signal<SessionUser | null>(restoreSession());
  readonly isAdmin = computed(() => this.session()?.role === 'ADMIN');

  login(email: string, password: string): Observable<{ token: string; user: SessionUser }> {
    return this.api.login(email, password).pipe(
      tap(({ data }) => {
        sessionStorage.setItem('tnl_access_token', data.token);
        sessionStorage.setItem('tnl_user', JSON.stringify(data.user));
        this.session.set(data.user);
      }),
      map(({ data }) => data),
    );
  }

  setSession(data: { token: string; user: SessionUser }): void {
    sessionStorage.setItem('tnl_access_token', data.token);
    sessionStorage.setItem('tnl_user', JSON.stringify(data.user));
    this.session.set(data.user);
  }
  logout(): void {
    if (this.session()?.role === 'DELIVERY') this.api.logout().subscribe({ error: () => {} });
    sessionStorage.removeItem('tnl_access_token');
    sessionStorage.removeItem('tnl_user');
    this.session.set(null);
  }
}

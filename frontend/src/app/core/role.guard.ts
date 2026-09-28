import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { Role } from './api.service';
import { SessionService } from './session.service';

export function roleGuard(allowed: Role[]): CanMatchFn {
  return () => {
    const session = inject(SessionService).session();
    const router = inject(Router);
    if (!session) return router.parseUrl('/');
    if (!allowed.includes(session.role)) return router.parseUrl('/dashboard');
    return true;
  };
}

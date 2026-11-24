import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { DashboardPage } from './dashboard.page';
import { ApiService, Order } from '../../core/api.service';
import { SessionService } from '../../core/session.service';

describe('overview order amounts', () => {
  it('shows the saved package total independently of payment state', () => {
    for (const paymentStatus of ['UNPAID', 'PARTIALLY_PAID', 'PAID']) {
      const order = {items: [], packages: [{name: 'Student Laptop Starter', quantity: 2, sellingPrice: 28995}], total: 57990, paymentStatus} as unknown as Order;
      expect(DashboardPage.prototype.orderAmount(order)).toBe(57990);
    }
  });
});

it('keeps the previous data labeled correctly and retries a failed Manila month rollover', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-31T15:59:30Z'));
  const getDashboard = vi.fn()
    .mockReturnValueOnce(of({ data: { revenue: 100, revenueTrend: [] } }))
    .mockReturnValueOnce(throwError(() => new Error('Temporary failure')))
    .mockReturnValueOnce(of({ data: { revenue: 200, revenueTrend: [] } }));
  TestBed.configureTestingModule({ providers: [
    { provide: ApiService, useValue: { getDashboard, getOrders: () => of({ data: [] }), getProducts: () => of({ data: [] }) } },
    { provide: SessionService, useValue: { session: signal({ role: 'ADMIN' }) } },
    { provide: Router, useValue: {} },
  ] });
  try {
    const page = TestBed.runInInjectionContext(() => new DashboardPage());
    page.ngOnInit();
    expect(page.currentMonth()).toBe('2026-01');
    expect(page.summary().revenue).toBe(100);

    vi.advanceTimersByTime(60_000);
    expect(getDashboard).toHaveBeenLastCalledWith({ period: 'monthly', month: '2026-02' });
    expect(page.currentMonth()).toBe('2026-01');
    expect(page.summary().revenue).toBe(100);

    vi.advanceTimersByTime(60_000);
    expect(getDashboard).toHaveBeenCalledTimes(3);
    expect(page.currentMonth()).toBe('2026-02');
    expect(page.summary().revenue).toBe(200);
  } finally {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  }
});

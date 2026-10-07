import { Routes } from '@angular/router';
import { WorkspaceRouteComponent } from './shared/workspace-route.component';
import { roleGuard } from './core/role.guard';

export const routes: Routes = [
  { path: 'delivery', canMatch: [roleGuard(['DELIVERY'])], loadComponent: () => import('./features/delivery/delivery.page').then(m => m.DeliveryPage) },
  { path: 'delivery/:id', canMatch: [roleGuard(['DELIVERY'])], loadComponent: () => import('./features/delivery/delivery.page').then(m => m.DeliveryPage) },
  { path: 'dispatch', data: {admin:true}, canMatch: [roleGuard(['ADMIN'])], loadComponent: () => import('./features/delivery/delivery.page').then(m => m.DeliveryPage) },
  { path: 'delivery-employees', canMatch: [roleGuard(['ADMIN'])], loadComponent: () => import('./features/delivery/employees.page').then(m => m.DeliveryEmployeesPage) },
  {
    path: 'account',
    canMatch: [roleGuard(['ADMIN', 'AGENT', 'CUSTOMER', 'DELIVERY'])],
    loadComponent: () => import('./features/account/account.page').then((m) => m.AccountPage),
  },
  ...(['daily', 'monthly', 'overall'] as const).map((period) => ({
    path: `reports/${period}`,
    data: { period },
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () => import('./features/reports/reports.page').then((m) => m.ReportsPage),
  })),
  { path: 'reports', pathMatch: 'full', redirectTo: 'reports/daily' },
  {
    path: 'portal/orders/:id',
    canMatch: [roleGuard(['CUSTOMER'])],
    loadComponent: () => import('./features/portal/customer-order-detail.page').then(m => m.CustomerOrderDetailPage),
  },
  {
    path: 'portal',
    loadComponent: () => import('./features/portal/portal.page').then((m) => m.PortalPage),
  },
  {
    path: 'packages',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () => import('./features/packages/packages.page').then((m) => m.PackagesPage),
  },
  {
    path: 'requests',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () => import('./features/requests/requests.page').then((m) => m.RequestsPage),
  },
  {
    path: 'automations',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/automations/automations.page').then((m) => m.AutomationsPage),
  },
  {
    path: 'orders/new',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () =>
      import('./features/orders/new-order.page').then((module) => module.NewOrderPage),
  },
  {
    path: 'orders/:id',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () =>
      import('./features/orders/order-detail.page').then((module) => module.OrderDetailPage),
  },
  {
    path: 'agents/:id',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/agents/agent-detail.page').then((module) => module.AgentDetailPage),
  },
  {
    path: 'performance',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/performance/performance.page').then((m) => m.PerformancePage),
  },
  {
    path: 'imports',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/imports/import-upload.page').then((module) => module.ImportUploadPage),
  },
  {
    path: 'imports/:id',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/imports/import-review.page').then((module) => module.ImportReviewPage),
  },
  {
    path: 'dashboard',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () =>
      import('./features/dashboard/dashboard.page').then((module) => module.DashboardPage),
  },
  {
    path: 'orders',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () =>
      import('./features/orders/orders-list.page').then((module) => module.OrdersListPage),
  },
  {
    path: 'customers/:id',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () => import('./features/customers/customer-detail.page').then(m => m.CustomerDetailPage),
  },
  {
    path: 'customers',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () =>
      import('./features/customers/customers.page').then((module) => module.CustomersPage),
  },
  {
    path: 'categories',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/categories/categories.page').then((module) => module.CategoriesPage),
  },
  {
    path: 'products',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/products/products.page').then((module) => module.ProductsPage),
  },
  {
    path: 'inventory',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/inventory/inventory.page').then((module) => module.InventoryPage),
  },
  {
    path: 'tracking',
    canMatch: [roleGuard(['ADMIN', 'AGENT'])],
    loadComponent: () =>
      import('./features/tracking/tracking.page').then((module) => module.TrackingPage),
  },
  {
    path: 'leads',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () => import('./features/leads/leads.page').then((module) => module.LeadsPage),
  },
  {
    path: 'campaigns',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/campaigns/campaigns.page').then((module) => module.CampaignsPage),
  },
  {
    path: 'agents',
    canMatch: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./features/agents/agents-list.page').then((module) => module.AgentsListPage),
  },
  {
    path: 'commissions',
    canMatch: [roleGuard(['AGENT'])],
    loadComponent: () =>
      import('./features/commissions/commissions.page').then((module) => module.CommissionsPage),
  },
  { path: '', pathMatch: 'full', component: WorkspaceRouteComponent },
  { path: '**', redirectTo: '' },
];

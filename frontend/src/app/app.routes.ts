import { Routes } from '@angular/router';
import { WorkspaceRouteComponent } from './shared/workspace-route.component';
import { roleGuard } from './core/role.guard';

export const routes: Routes = [
  {
    path: 'account',
    canMatch: [roleGuard(['ADMIN', 'AGENT', 'CUSTOMER'])],
    loadComponent: () => import('./features/account/account.page').then((m) => m.AccountPage),
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

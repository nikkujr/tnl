import { Routes } from '@angular/router';
import { WorkspaceRouteComponent } from './shared/workspace-route.component';

export const routes: Routes = [
  {
    path: 'orders/new',
    loadComponent: () => import('./features/orders/new-order.page').then((module) => module.NewOrderPage)
  },
  {
    path: 'orders/:id',
    loadComponent: () => import('./features/orders/order-detail.page').then((module) => module.OrderDetailPage)
  },
  {
    path: 'agents/:id',
    loadComponent: () => import('./features/agents/agent-detail.page').then((module) => module.AgentDetailPage)
  },
  {
    path: 'imports',
    loadComponent: () => import('./features/imports/import-upload.page').then((module) => module.ImportUploadPage)
  },
  {
    path: 'imports/:id',
    loadComponent: () => import('./features/imports/import-review.page').then((module) => module.ImportReviewPage)
  },
  { path: 'dashboard', component: WorkspaceRouteComponent },
  {
    path: 'orders',
    loadComponent: () => import('./features/orders/orders-list.page').then((module) => module.OrdersListPage)
  },
  { path: 'customers', component: WorkspaceRouteComponent },
  { path: 'categories', component: WorkspaceRouteComponent },
  { path: 'products', component: WorkspaceRouteComponent },
  { path: 'inventory', component: WorkspaceRouteComponent },
  { path: 'tracking', component: WorkspaceRouteComponent },
  { path: 'leads', component: WorkspaceRouteComponent },
  { path: 'campaigns', component: WorkspaceRouteComponent },
  { path: 'agents', component: WorkspaceRouteComponent },
  { path: 'commissions', component: WorkspaceRouteComponent },
  { path: '', pathMatch: 'full', component: WorkspaceRouteComponent },
  { path: '**', redirectTo: '' }
];

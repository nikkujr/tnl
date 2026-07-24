import { Routes } from '@angular/router';
import { WorkspaceRouteComponent } from './shared/workspace-route.component';

export const routes: Routes = [
  {
    path: 'orders/new',
    loadComponent: () => import('./features/orders/new-order.page').then((module) => module.NewOrderPage)
  },
  { path: 'dashboard', component: WorkspaceRouteComponent },
  { path: 'orders', component: WorkspaceRouteComponent },
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

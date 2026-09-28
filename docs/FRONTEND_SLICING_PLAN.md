# Slice the frontend into vertical feature modules

## Context

The backend already follows vertical-slice architecture cleanly: one `route.ts` per feature under `backend/src/features/<feature>/`, each 20–120 lines, self-contained. The frontend never got the same treatment. `frontend/src/app/app.ts` (648 lines) and `app.html` (273 lines) are a single root component doing *everything*: session/auth, sidebar nav, notifications, and the full CRUD logic + templates for eleven separate feature areas (Dashboard, Orders, Customers, Categories, Products, Inventory, Tracking, Leads, Campaigns, Agents, Commissions), fanned out across 8 more flat, uncolocated `.scss` files. Finding "the code for Categories" today means reading a third of a 900-line file pair. This is the "god file" the user flagged.

We already have three real precedents for what a slice should look like — `features/orders/new-order.page.ts`, `order-detail.page.ts`, and `features/agents/agent-detail.page.ts` — each a self-contained, routed, lazy-loaded standalone component owning its own data fetch, loading/error/notice state, and styles. The goal is to bring the other eleven areas up to that same shape, and turn `app.ts`/`app.html` into a thin shell (session, sidebar, topbar, notifications, router-outlet) — nothing else.

Two things already went wrong from *not* having a shared layer, and both are proof this refactor needs one before, not after, slicing further:
- `order-detail.page.scss` and `agent-detail.page.scss` already independently redefine near-identical `.status` pills, `.surface` cards, and buttons.
- The confirm-dialog open/close/resolve boilerplate (`actionDialog` signal + `openDialog`/`closeActionDialog`/`confirmActionDialog`) and the toast pattern (`error`/`notice` signals + `showSuccess`/`setError`, the one that had a real cross-contamination bug fixed earlier this session) are each hand-duplicated three times already (`App`, `NewOrderPage`, `OrderDetailPage`). Slicing eleven more features without fixing this first would duplicate that bug surface eleven more times.

So: build the shared layer first, prove it in the shell, then migrate one feature at a time, simplest/most-isolated first, verifying after each.

## Target structure

```
frontend/src/app/
  app.ts / app.html / app.scss        — thin shell only: landing page gate, sidebar, topbar,
                                         notifications, mobile nav, <router-outlet/> for everything else
  app.routes.ts                       — every workspace view becomes a real lazy-loaded route
                                         (no more WorkspaceRouteComponent passthrough)
  core/
    api.service.ts                    — unchanged
    auth.interceptor.ts               — unchanged
    session.service.ts        (NEW)   — session signal, login/logout, sessionStorage, role checks
    role.guard.ts              (NEW)  — CanMatchFn reading SessionService, used per-route
  shared/
    toast.service.ts           (NEW)  — replaces per-component error/notice signal pairs
    confirm-dialog.service.ts  (NEW)  — replaces per-component actionDialog boilerplate
    styles/_tokens.scss        (NEW)  — .status, .surface, .management-table, buttons, form-grid
    action-dialog.component.*         — unchanged (still the dumb presentational dialog)
    app-icon.component.*, rich-text-editor.component.*, delivery-steps.ts,
    order-payment.ts, money.ts        — unchanged
  features/
    dashboard/dashboard.page.*                     (NEW)
    orders/
      orders-list.page.*                           (NEW — list + the existing quick-order modal, moved as-is)
      order-row.component.*                        (NEW — shared row markup, used by both Orders list and Dashboard's "recent orders")
      new-order.page.*, order-detail.page.*         (existing, untouched)
    customers/customers.page.*                     (NEW)
    categories/categories.page.*                   (NEW)
    products/products.page.*                       (NEW)
    inventory/inventory.page.*                     (NEW)
    tracking/tracking.page.*                       (NEW — the authenticated workspace tracking view)
    leads/leads.page.*                             (NEW)
    campaigns/campaigns.page.*                     (NEW)
    agents/
      agents-list.page.*                           (NEW)
      agent-detail.page.*                          (existing, untouched)
    commissions/commissions.page.*                 (NEW)
```

## Key design decisions

**Real routing, not signal-faked routing.** Today, `app.routes.ts` maps every workspace path to a blank `WorkspaceRouteComponent`; the actual view is chosen by a `view()` signal and a giant `@if` chain in `app.html`, manually kept in sync with the URL via `applyWorkspaceRoute()`/`selectView()`. Since each feature becomes a real routed component, the router-outlet becomes the one true rendering mechanism for the whole authenticated shell — `app.html`'s content area collapses to just `<router-outlet />`. Sidebar nav switches from `(click)="selectView(item)"` + manual active-class comparison to `[routerLink]` + `routerLinkActive`. Role-based access (today: `isViewAllowed()` + manual redirect) becomes a `canMatch` guard per route.

**Each page owns its own data fetch and toast/loading state**, exactly like `order-detail.page.ts` already does — no shared `loadWorkspace()` fan-out. Where a page genuinely needs data from more than one endpoint (e.g. Products needs Categories for its dropdown), it does its own small `forkJoin`, same as `new-order.page.ts` already does for customers+products+agents.

**Dashboard's cross-feature bits become query-param handoffs**, following the pattern already established for `/orders?edit=`  and `/customers?focus=` in `app.ts`. Dashboard's metric cards and "needs attention" panel currently call `openMetric()`/`openAttentionItem()`, which set a filter signal on `App` *before* navigating — that shared-signal trick disappears once Inventory/Orders are separate components. Instead: navigating to `/inventory?health=LOW` or `/orders?status=Open` and having that page read the query param on init to preset its own filter.

**ToastService and ConfirmDialogService are rendered once in the shell**, injected by any feature that needs them. `ToastService` exposes `success(message)` / `error(message)` methods and `notice`/`error` signals (with the existing cross-clear-the-other-one behavior already fixed once, now correct by construction everywhere). `ConfirmDialogService` exposes `confirm(config): Promise<Record<string,string|number> | null>` wrapping `ActionDialogComponent`, replacing the `openDialog`/`dialogAction`/`closeActionDialog` triplication.

**The three existing detail pages (`new-order`, `order-detail`, `agent-detail`) are left as-is** for this pass — they already work correctly with their own local copies of this boilerplate. Retrofitting them to the new shared services is a nice-to-have, called out as optional follow-up, not required.

**The admin "quick order" modal stays exactly as it is today**, just physically moved into `orders-list.page.ts`/`.html` — per your call, no behavior consolidation with `new-order.page.ts` in this pass.

## Migration order (one slice at a time, verify after each)

Ordered by data-dependency complexity — each step's page depends only on things already migrated or on `ApiService` directly:

0. **Shared layer + shell migration** — build `session.service.ts`, `role.guard.ts`, `toast.service.ts`, `confirm-dialog.service.ts`, `shared/styles/_tokens.scss`; migrate `App` itself to use them (login/logout via the service, toasts/confirm-dialog rendered via the new services). Verify: login, logout, one delete action (confirm dialog fires), one success and one induced-error toast (each still clears the other).
1. **Tracking** — zero dependencies, no data load at all, simplest possible first slice.
2. **Categories** — single dependency (its own data), standard CRUD template every later slice follows.
3. **Commissions** — single dependency, read-only, agent-only view.
4. **Campaigns** — single dependency; exercises the rich-text editor + send-email confirm dialog.
5. **Agents list** — single dependency; establishes the `activeAgents()` shape reused by Leads/Customers/Orders.
6. **Leads** — needs Agents' active-agent list for the assignment dropdown.
7. **Products** — needs Categories' list for its category dropdown.
8. **Inventory** — needs Products' data shape (adjust-stock / settings dialogs operate on products).
9. **Customers** — needs active agents for assignment; also the target of the `/customers?focus=` handoff.
10. **Orders list** — the largest slice: orders + customers + products + agents, plus the quick-order modal and the new shared `order-row.component`.
11. **Dashboard** — last, since it aggregates across everything (`getDashboard()` + a light `getOrders()`/`getProducts()` fetch for "recent orders" and "needs attention", mirroring a subset of today's `loadWorkspace()`) and is the default landing route — safest to touch once everything else is stable.
12. **Cleanup** — delete `WorkspaceRouteComponent`, remove the now-dead giant `@if` chain and CRUD methods from `app.ts`/`app.html`, delete the old flat `.scss` files once their rules have all been redistributed into feature folders + `shared/styles/_tokens.scss`.

## Verification

No automated test suite exists (per project convention — manual acceptance testing only, see `docs/MANUAL_ACCEPTANCE.md`). After each numbered step:
- `cd frontend && npm run build` must stay clean (catches wiring/type mistakes immediately).
- Spin up the real app (`npm run dev` backend + `npm start` frontend, or a throwaway MySQL container the way this session has been verifying backend changes) and manually exercise that slice's page: load, search/filter, create, edit, delete, and any confirm-dialog/toast paths — confirming behavior is byte-for-byte the same as before migration, since this pass is pure restructuring, not a behavior change.
- After step 0 specifically, also confirm a role-gated route (e.g. an agent hitting `/categories`) is correctly redirected by the new guard, matching today's `isViewAllowed` behavior.
